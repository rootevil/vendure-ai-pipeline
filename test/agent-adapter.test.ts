import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAgentAdapter } from '../src/agent/agent-factory.js';
import { MockAgentAdapter } from '../src/agent/mock-adapter.js';
import { OpenHandsAgentAdapter } from '../src/agent/openhands-adapter.js';
import type {
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from '../src/agent/process-runner.js';
import { AgentOutputError, parseAgentResultJson } from '../src/agent/result-parser.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { PipelineController } from '../src/controller/pipeline-controller.js';
import { FileEvidenceCollector } from '../src/evidence/evidence-collector.js';
import { createLogger } from '../src/logging/logger.js';
import { parseTaskDefinition } from '../src/task/task-definition.js';
import { ArtifactPresenceValidator } from '../src/validator/validator.js';

function baseConfig(root: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    mode: 'acceptance',
    artifactsDir: join(root, 'artifacts'),
    workspaceDir: join(root, 'workspace'),
    maxIdenticalRetries: 3,
    maxTotalAttempts: 5,
    allowNetwork: false,
    logLevel: 'error',
    writeAllowlist: ['src'],
    agentMode: 'mock',
    agentTimeoutMs: 50,
    openhandsCommand: 'openhands',
    mockAgentBehavior: 'success',
    ...overrides,
  };
}

const task = parseTaskDefinition({
  id: 'catalog',
  title: 'Catalog',
  goal: 'Migrate catalog',
  writeAllowlist: ['src'],
  stages: [{ id: 'one', description: 'Implement adapter' }],
});

test('mock agent success writes changes; validator decides PASS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-success-'));
  try {
    const config = baseConfig(root, { runId: 'success-run', mockAgentBehavior: 'success' });
    const controller = new PipelineController({
      config,
      agent: createAgentAdapter({ config }),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 0,
    });

    const result = await controller.run(task);
    assert.equal(result.status, 'PASS');
    assert.equal(result.exitCode, 0);
    assert.equal(result.attempts[0]?.agentClaimedSuccess, true);
    assert.ok(result.validatorNotes.some((note) => note.includes('Agent claimed success')));
    const written = readFileSync(
      join(root, 'workspace', 'success-run', 'src', 'mock-agent-output.txt'),
      'utf8',
    );
    assert.match(written, /mock agent change/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mock agent failure returns non_recoverable and pipeline BLOCKs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-fail-'));
  try {
    const controller = new PipelineController({
      config: baseConfig(root, { runId: 'fail-run' }),
      agent: new MockAgentAdapter({ behavior: 'failure' }),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });
    const result = await controller.run(task);
    assert.equal(result.status, 'BLOCK');
    assert.equal(result.attempts[0]?.failureClass, 'non_recoverable');
    assert.match(result.attempts[0]?.signature ?? '', /MOCK_FAILURE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mock agent timeout yields AGENT_TIMEOUT', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-timeout-'));
  try {
    const started = Date.now();
    const controller = new PipelineController({
      config: baseConfig(root, { runId: 'timeout-run', agentTimeoutMs: 30 }),
      agent: new MockAgentAdapter({ behavior: 'timeout', timeoutMs: 30 }),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });
    const result = await controller.run(task);
    assert.ok(Date.now() - started >= 30);
    assert.match(result.attempts[0]?.signature ?? '', /AGENT_TIMEOUT/);
    assert.equal(result.status, 'BLOCK');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mock agent retryable failures are retried then can succeed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-retry-'));
  try {
    const controller = new PipelineController({
      config: baseConfig(root, {
        runId: 'retry-run',
        maxIdenticalRetries: 3,
        maxTotalAttempts: 5,
      }),
      agent: new MockAgentAdapter({ behavior: 'retryable' }),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 0,
    });
    const result = await controller.run(task);
    assert.ok(result.attempts.length >= 2);
    assert.match(result.attempts[0]?.signature ?? '', /MOCK_RETRYABLE/);
    assert.equal(result.status, 'PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed agent output is rejected as recoverable MALFORMED_OUTPUT', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-malformed-'));
  try {
    const controller = new PipelineController({
      config: baseConfig(root, {
        runId: 'malformed-run',
        maxIdenticalRetries: 1,
        maxTotalAttempts: 1,
      }),
      agent: new MockAgentAdapter({ behavior: 'malformed' }),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });
    const result = await controller.run(task);
    assert.match(result.attempts[0]?.signature ?? '', /MALFORMED_OUTPUT/);
    assert.equal(result.status, 'BLOCK');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent forbidden pipeline verdict fields are rejected', () => {
  assert.throws(
    () =>
      parseAgentResultJson(
        JSON.stringify({
          summary: 'done',
          claimed_success: true,
          status: 'PASS',
        }),
      ),
    (error: unknown) =>
      error instanceof AgentOutputError && error.code === 'FORBIDDEN_PIPELINE_VERDICT',
  );
});

test('OpenHands adapter enforces timeout via process runner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-oh-timeout-'));
  const runner: ProcessRunner = {
    async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
      assert.equal(request.timeoutMs, 40);
      return {
        exitCode: null,
        signal: 'SIGKILL',
        stdout: '',
        stderr: 'killed',
        timedOut: true,
        durationMs: request.timeoutMs,
      };
    },
  };

  try {
    const controller = new PipelineController({
      config: baseConfig(root, { runId: 'oh-timeout', agentTimeoutMs: 40 }),
      agent: new OpenHandsAgentAdapter({ timeoutMs: 40, runner, command: 'openhands' }),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });
    const result = await controller.run(task);
    assert.match(result.attempts[0]?.signature ?? '', /AGENT_TIMEOUT/);
    assert.equal(result.status, 'BLOCK');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OpenHands adapter captures stdout/stderr/changes; validator decides PASS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-oh-success-'));
  const runner: ProcessRunner = {
    async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const target = path.join(request.cwd, 'src');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'from-openhands.txt'), 'hello\n', 'utf8');
      fs.writeFileSync(
        path.join(request.cwd, 'agent-result.json'),
        JSON.stringify({
          summary: 'OpenHands finished editing',
          claimed_success: true,
          changed_files: ['src/from-openhands.txt'],
        }),
        'utf8',
      );
      return {
        exitCode: 0,
        signal: null,
        stdout: '{"type":"observation","content":"ok"}\n',
        stderr: 'openhands-stderr',
        timedOut: false,
        durationMs: 5,
      };
    },
  };

  try {
    const controller = new PipelineController({
      config: baseConfig(root, { runId: 'oh-success' }),
      agent: new OpenHandsAgentAdapter({ timeoutMs: 5_000, runner }),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 0,
    });
    const result = await controller.run(task);
    assert.equal(result.status, 'PASS');
    assert.equal(result.agentSummary, 'OpenHands finished editing');
    assert.ok(result.attempts[0]?.agentClaimedSuccess);
    assert.match(readFileSync(join(result.artifactDir, 'stdout.log'), 'utf8'), /observation/);
    assert.match(readFileSync(join(result.artifactDir, 'stderr.log'), 'utf8'), /openhands-stderr/);
    const status = JSON.parse(readFileSync(join(result.artifactDir, 'status.json'), 'utf8')) as {
      status: string;
    };
    assert.equal(status.status, 'PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OpenHands adapter rejects malformed agent-result.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-oh-malformed-'));
  const runner: ProcessRunner = {
    async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
      const fs = await import('node:fs');
      const path = await import('node:path');
      fs.writeFileSync(path.join(request.cwd, 'agent-result.json'), '{bad', 'utf8');
      return {
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        durationMs: 1,
      };
    },
  };

  try {
    const controller = new PipelineController({
      config: baseConfig(root, {
        runId: 'oh-malformed',
        maxIdenticalRetries: 1,
        maxTotalAttempts: 1,
      }),
      agent: new OpenHandsAgentAdapter({ timeoutMs: 1_000, runner }),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });
    const result = await controller.run(task);
    assert.match(result.attempts[0]?.signature ?? '', /MALFORMED_OUTPUT/);
    assert.equal(result.status, 'BLOCK');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
