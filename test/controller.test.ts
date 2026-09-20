import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  NoopAgentAdapter,
  type AgentAdapter,
  type AgentRunOutcome,
} from '../src/agent/agent-adapter.js';
import { PipelineController } from '../src/controller/pipeline-controller.js';
import { FileEvidenceCollector } from '../src/evidence/evidence-collector.js';
import { createLogger } from '../src/logging/logger.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { parseTaskDefinition } from '../src/task/task-definition.js';
import { ArtifactPresenceValidator } from '../src/validator/validator.js';

function configFor(root: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    mode: 'acceptance',
    artifactsDir: join(root, 'artifacts'),
    workspaceDir: join(root, 'workspace'),
    maxIdenticalRetries: 2,
    maxTotalAttempts: 3,
    allowNetwork: false,
    logLevel: 'error',
    writeAllowlist: ['src'],
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

test('controller with noop agent ends BLOCK and writes evidence bundle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-ctrl-'));
  try {
    const controller = new PipelineController({
      config: configFor(root, { runId: 'noop-run' }),
      agent: new NoopAgentAdapter(),
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });

    const result = await controller.run(task);
    assert.equal(result.status, 'BLOCK');
    assert.equal(result.exitCode, 1);
    assert.equal(result.runId, 'noop-run');

    const status = JSON.parse(readFileSync(join(result.artifactDir, 'status.json'), 'utf8')) as {
      status: string;
    };
    assert.equal(status.status, 'BLOCK');
    assert.ok(readFileSync(join(result.artifactDir, 'run-manifest.json'), 'utf8').length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('controller retries recoverable agent failures then stops', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-retry-'));
  let calls = 0;
  const flakyAgent: AgentAdapter = {
    name: 'flaky',
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
      config: configFor(root, { runId: 'retry-run', maxIdenticalRetries: 3, maxTotalAttempts: 5 }),
      agent: flakyAgent,
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 1,
    });

    const result = await controller.run(task);
    assert.equal(result.status, 'BLOCK');
    assert.equal(calls, 3);
    assert.equal(result.attempts.length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('controller grants PASS when tests pass and evidence is complete', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-pass-'));
  const successAgent: AgentAdapter = {
    name: 'success-stub',
    async run(): Promise<AgentRunOutcome> {
      return {
        claimedSuccess: true,
        summary: 'done',
        stdout: 'ok',
        stderr: '',
        failureClass: 'recoverable',
        changedFiles: [],
        diff: '',
      };
    },
  };

  try {
    const controller = new PipelineController({
      config: configFor(root, { runId: 'pass-run' }),
      agent: successAgent,
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: createLogger({ level: 'error' }),
      runTests: async () => 0,
    });

    const result = await controller.run(task);
    assert.equal(result.status, 'PASS');
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
