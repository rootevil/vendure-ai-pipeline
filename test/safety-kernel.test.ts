import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createLogger } from '../src/logging/logger.js';
import { GuardingProcessRunner } from '../src/safety/command-guard.js';
import { createExecutionContext, SafetyError } from '../src/safety/execution-context.js';
import { DEFAULT_SAFETY_POLICY } from '../src/safety/policy.js';
import { SafetyKernel } from '../src/safety/safety-kernel.js';
import { loadConfig } from '../src/config/load-config.js';
import type { TaskDefinition } from '../src/models/types.js';

function minimalTask(): TaskDefinition {
  return {
    id: 'safety-demo',
    title: 'Safety demo',
    goal: 'Prove safety kernel boundaries',
    acceptanceCriteria: ['writes stay inside allowlist'],
    allowedTools: ['filesystem', 'mock'],
    timeoutMs: 60_000,
    retryPolicy: { maxIdenticalRetries: 2, maxTotalAttempts: 3 },
    validationSteps: [{ id: 'evidence', type: 'evidence_present' }],
    mode: 'acceptance',
    sourcePaths: [],
    writeAllowlist: ['src'],
    requiredEvidence: [
      'run-manifest.json',
      'status.json',
      'stdout.log',
      'stderr.log',
      'change-summary.md',
      'rollback.md',
      'summary.md',
    ],
    stages: [
      {
        id: 's1',
        description: 'demo',
        preconditions: [],
        actions: [],
        expectedChecks: [],
        cleanup: [],
      },
    ],
    circuitBreakRules: [],
    cleanupWorkspace: true,
  };
}

describe('safety kernel', () => {
  it('describes allow/deny policy including MiniPC denial', () => {
    const kernel = new SafetyKernel();
    const desc = kernel.describe();
    assert.deepEqual(desc.allowedActions, DEFAULT_SAFETY_POLICY.allowedActions);
    assert.ok((desc.forbiddenByDefault as string[]).includes('minipc_unrestricted'));
    assert.equal(desc.allowSsh, false);
    assert.equal(desc.allowHostFilesystem, false);
  });

  it('places run workspace under workspace/runs/<run-id>', () => {
    const root = mkdtempSync(join(tmpdir(), 'safety-ws-'));
    const config = loadConfig({
      PIPELINE_WORKSPACE_DIR: join(root, 'workspace', 'runs'),
      PIPELINE_ARTIFACTS_DIR: join(root, 'artifacts'),
      PIPELINE_WRITE_ALLOWLIST: 'src',
    });
    const context = createExecutionContext({
      config,
      task: minimalTask(),
      logger: createLogger({ level: 'error' }),
      runId: 'run-abc',
    });
    assert.match(context.workspaceDir.replace(/\\/g, '/'), /workspace\/runs\/run-abc$/);
    assert.ok(context.safetyKernel);
  });

  it('denies host filesystem paths outside the run workspace', () => {
    const kernel = new SafetyKernel();
    const ws = kernel.resolveRunWorkspace('/tmp/pipeline-ws/runs', 'r1');
    assert.throws(
      () => kernel.assertPathInsideWorkspace(ws, '/etc/passwd'),
      (err: unknown) => err instanceof SafetyError && err.code === 'HOST_FILESYSTEM',
    );
  });

  it('denies SSH and unapproved commands', () => {
    const kernel = new SafetyKernel();
    assert.throws(
      () => kernel.assertCommandApproved('ssh', ['host']),
      (err: unknown) => err instanceof SafetyError && err.code === 'SSH_DENIED',
    );
    assert.throws(
      () => kernel.assertCommandApproved('curl', ['https://evil.example']),
      (err: unknown) => err instanceof SafetyError && err.code === 'COMMAND_DENIED',
    );
    kernel.assertCommandApproved('node', ['--version']);
    kernel.assertCommandApproved('openhands', ['--headless']);
  });

  it('denies MiniPC in command lines', () => {
    const kernel = new SafetyKernel();
    assert.throws(
      () => kernel.assertCommandApproved('node', ['scripts/minipc-open.js']),
      (err: unknown) => err instanceof SafetyError && err.code === 'MINIPC_DENIED',
    );
  });

  it('caps unlimited retries', () => {
    const kernel = new SafetyKernel();
    assert.throws(
      () => kernel.assertRetryBudgets(100, 200),
      (err: unknown) => err instanceof SafetyError && err.code === 'RETRY_LIMIT',
    );
  });

  it('GuardingProcessRunner blocks before spawn', async () => {
    const runner = new GuardingProcessRunner({
      inner: {
        async run() {
          throw new Error('should not spawn');
        },
      },
    });
    const root = mkdtempSync(join(tmpdir(), 'guard-cwd-'));
    await assert.rejects(
      () =>
        runner.run({
          command: 'ssh',
          args: ['box'],
          cwd: root,
          timeoutMs: 1000,
        }),
      (err: unknown) => err instanceof SafetyError,
    );
  });
});
