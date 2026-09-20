import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLogger } from '../src/logging/logger.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { minimalTask } from './helpers/minimal-task.js';
import {
  createExecutionContext,
  scanTextForSafetyViolations,
  SafetyError,
} from '../src/safety/execution-context.js';

const baseTask = minimalTask();

function configFor(root: string): PipelineConfig {
  return {
    mode: 'acceptance',
    artifactsDir: join(root, 'artifacts'),
    workspaceDir: join(root, 'workspace'),
    maxIdenticalRetries: 3,
    maxTotalAttempts: 5,
    allowNetwork: false,
    logLevel: 'error',
    writeAllowlist: [],
    agentMode: 'mock',
    agentTimeoutMs: 120_000,
    openhandsCommand: 'openhands',
    mockAgentBehavior: 'success',
  };
}

test('execution context blocks path escape outside workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-safety-'));
  try {
    const context = createExecutionContext({
      config: configFor(root),
      task: baseTask,
      logger: createLogger({ level: 'error' }),
      runId: 'run-1',
    });
    assert.throws(
      () => context.resolveWorkspacePath('../outside.txt'),
      (error: unknown) => error instanceof SafetyError && error.code === 'PATH_ESCAPE',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('execution context enforces write allowlist', () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-allow-'));
  try {
    const context = createExecutionContext({
      config: configFor(root),
      task: baseTask,
      logger: createLogger({ level: 'error' }),
      runId: 'run-2',
    });
    assert.equal(
      context.assertWritablePath('src/file.ts').endsWith(`${join('src', 'file.ts')}`),
      true,
    );
    assert.throws(
      () => context.assertWritablePath('secrets/key.pem'),
      (error: unknown) => error instanceof SafetyError && error.code === 'PATH_ESCAPE',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanTextForSafetyViolations detects secret-like and production text', () => {
  const secret = scanTextForSafetyViolations('api_key=supersecretvalue123');
  assert.ok(secret);
  assert.equal(secret?.code, 'SECRET_PATTERN');

  const production = scanTextForSafetyViolations('deploying to production now');
  assert.ok(production);
  assert.equal(production?.code, 'PRODUCTION_INDICATOR');

  assert.equal(scanTextForSafetyViolations('ordinary log line'), null);
});
