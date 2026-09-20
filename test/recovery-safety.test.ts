import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AgentAdapter, AgentRunOutcome } from '../src/agent/agent-adapter.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { PipelineController } from '../src/controller/pipeline-controller.js';
import { FileEvidenceCollector } from '../src/evidence/evidence-collector.js';
import { createLogger } from '../src/logging/logger.js';
import { TaskRunner } from '../src/execution/task-runner.js';
import { MockAgentAdapter } from '../src/agent/mock-adapter.js';
import { minimalTask } from './helpers/minimal-task.js';
import { ArtifactPresenceValidator } from '../src/validator/validator.js';
import type { Validator, ValidatorDecision, ValidatorInput } from '../src/validator/validator.js';

function configFor(root: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    mode: 'acceptance',
    artifactsDir: join(root, 'runs'),
    workspaceDir: join(root, 'workspace'),
    maxIdenticalRetries: 3,
    maxTotalAttempts: 5,
    allowNetwork: false,
    logLevel: 'error',
    writeAllowlist: ['src'],
    agentMode: 'mock',
    agentTimeoutMs: 60_000,
    openhandsCommand: 'openhands',
    mockAgentBehavior: 'success',
    ...overrides,
  };
}

test('controller stops unsafe failures immediately without exhausting retry budget', async () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-unsafe-'));
  let calls = 0;
  const agent: AgentAdapter = {
    name: 'unsafe-agent',
    async run(): Promise<AgentRunOutcome> {
      calls += 1;
      return {
        claimedSuccess: false,
        summary: 'secret leaked: api_key=abcdefghijklmnop',
        stdout: 'api_key=abcdefghijklmnop',
        stderr: '',
        failureClass: 'recoverable',
        failureCode: 'MOCK_RETRYABLE',
        changedFiles: [],
        diff: '',
      };
    },
  };

  try {
    const controller = new PipelineController({
      config: configFor(root, { runId: 'unsafe-run' }),
      agent,
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 0,
    });
    const result = await controller.run(minimalTask());
    assert.equal(result.status, 'BLOCK');
    assert.equal(calls, 1);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.failureKind, 'unsafe_unknown');
    assert.ok(result.validatorNotes.some((note) => /Safe-stop|unsafe/i.test(note)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('controller retries transient failures then stops when identical budget is hit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-transient-'));
  let calls = 0;
  const agent: AgentAdapter = {
    name: 'transient-agent',
    async run(): Promise<AgentRunOutcome> {
      calls += 1;
      return {
        claimedSuccess: false,
        summary: 'temporary tool crash',
        stdout: '',
        stderr: 'crash',
        failureClass: 'recoverable',
        failureCode: 'TOOL_CRASH',
        changedFiles: [],
        diff: '',
      };
    },
  };

  try {
    const controller = new PipelineController({
      config: configFor(root, {
        runId: 'transient-run',
        maxIdenticalRetries: 3,
        maxTotalAttempts: 5,
      }),
      agent,
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });
    const result = await controller.run(minimalTask());
    assert.equal(result.status, 'BLOCK');
    assert.equal(calls, 3);
    assert.equal(result.attempts.length, 3);
    assert.ok(
      result.attempts.every(
        (attempt) =>
          attempt.failureKind === 'transient_infrastructure' || attempt.failureKind === 'repeated',
      ),
    );
    assert.equal(result.attempts.at(-1)?.failureKind, 'repeated');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('timeout failures retry within limit then stop', async () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-timeout-'));
  let calls = 0;
  const agent: AgentAdapter = {
    name: 'timeout-agent',
    async run(): Promise<AgentRunOutcome> {
      calls += 1;
      return {
        claimedSuccess: false,
        summary: 'agent timed out',
        stdout: '',
        stderr: 'timeout',
        failureClass: 'recoverable',
        failureCode: 'AGENT_TIMEOUT',
        changedFiles: [],
        diff: '',
      };
    },
  };

  try {
    const controller = new PipelineController({
      config: configFor(root, {
        runId: 'timeout-run',
        maxIdenticalRetries: 2,
        maxTotalAttempts: 5,
      }),
      agent,
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });
    const result = await controller.run(minimalTask());
    assert.equal(calls, 2);
    assert.equal(result.status, 'BLOCK');
    assert.ok(
      result.attempts.some(
        (attempt) => attempt.failureKind === 'timeout' || attempt.failureKind === 'repeated',
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validation failure provides evidence and never grants PASS from agent claim', async () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-validation-'));
  let agentCalls = 0;
  let validatorCalls = 0;

  const agent: AgentAdapter = {
    name: 'claim-success',
    async run(): Promise<AgentRunOutcome> {
      agentCalls += 1;
      return {
        claimedSuccess: true,
        summary: 'I am done',
        stdout: 'done',
        stderr: '',
        failureClass: 'recoverable',
        failureCode: 'MOCK_SUCCESS',
        changedFiles: [],
        diff: '',
      };
    },
  };

  const blockingValidator: Validator = {
    name: 'always-block',
    async validate(input: ValidatorInput): Promise<ValidatorDecision> {
      validatorCalls += 1;
      assert.equal(input.agentClaimedSuccess, true);
      return {
        status: 'BLOCK',
        notes: [
          'Agent claimed success; ignored for PASS/BLOCK decision',
          'Independent checks failed',
        ],
        exitCode: 1,
        checks: [],
        stepResults: [],
      };
    },
  };

  try {
    const controller = new PipelineController({
      config: configFor(root, { runId: 'validation-block' }),
      agent,
      validator: blockingValidator,
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 0,
    });
    const result = await controller.run(minimalTask());
    assert.equal(result.status, 'BLOCK');
    assert.equal(agentCalls, 1);
    assert.equal(validatorCalls, 1);
    assert.ok(existsEvidence(result.artifactDir));
    assert.ok(result.validatorNotes.some((note) => note.includes('ignored for PASS/BLOCK')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TaskRunner never bypasses validation after recoverable retries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-runner-'));
  try {
    const task = minimalTask({
      id: 'retry-then-validate',
      cleanupWorkspace: true,
      retryPolicy: { maxIdenticalRetries: 2, maxTotalAttempts: 3 },
      validationSteps: [
        { id: 'evidence', type: 'evidence_present' },
        { id: 'missing', type: 'changed_files_include', path: 'src/never.txt' },
      ],
    });
    const runner = new TaskRunner({
      config: configFor(root, { runId: 'runner-block' }),
      logger: createLogger({ level: 'error' }),
      agent: new MockAgentAdapter({ behavior: 'success' }),
      runTests: async () => 0,
    });
    const result = await runner.execute(task);
    assert.equal(result.status, 'BLOCK');
    assert.ok(
      result.validationChecks.some(
        (check) => check.checkName === 'missing' && check.status === 'FAIL',
      ),
    );
    assert.ok(result.evidenceManifest);
    const resultJson = JSON.parse(
      readFileSync(join(result.artifactDir, 'result.json'), 'utf8'),
    ) as {
      agentClaimedSuccessIgnored: boolean;
      status: string;
    };
    assert.equal(resultJson.status, 'BLOCK');
    assert.equal(resultJson.agentClaimedSuccessIgnored, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function existsEvidence(artifactDir: string): boolean {
  return (
    readFileSync(join(artifactDir, 'status.json'), 'utf8').length > 0 &&
    readFileSync(join(artifactDir, 'rollback.md'), 'utf8').length > 0
  );
}
