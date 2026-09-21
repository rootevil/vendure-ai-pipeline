import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTaskDefinition, TaskDefinitionError } from '../src/task/task-definition.js';
import { minimalTask } from './helpers/minimal-task.js';
import { ArtifactPresenceValidator } from '../src/validator/validator.js';
import { createLogger } from '../src/logging/logger.js';
import type { ExecutionContext } from '../src/safety/execution-context.js';
import { defaultSafetyKernel } from '../src/safety/safety-kernel.js';
import type { TaskDefinition } from '../src/models/types.js';

test('parseTaskDefinition accepts a minimal valid task', () => {
  const task = parseTaskDefinition(minimalTask());
  assert.equal(task.mode, 'acceptance');
  assert.equal(task.stages.length, 1);
  assert.ok(task.requiredEvidence.includes('status.json'));
  assert.ok(task.acceptanceCriteria.length >= 1);
});

test('parseTaskDefinition rejects empty stages', () => {
  assert.throws(
    () => parseTaskDefinition(minimalTask({ stages: [] })),
    (error: unknown) => error instanceof TaskDefinitionError,
  );
});

function stubContext(task: TaskDefinition): ExecutionContext {
  return {
    runId: 'r1',
    mode: task.mode,
    task,
    workspaceDir: '/tmp/ws',
    artifactDir: '/tmp/art',
    writeAllowlist: [],
    allowNetwork: false,
    startedAt: new Date().toISOString(),
    logger: createLogger({ level: 'error' }),
    safetyKernel: defaultSafetyKernel,
    resolveWorkspacePath: (p) => p,
    assertWritablePath: (p) => p,
  };
}

test('validator ignores agent claimed success and blocks on missing evidence', async () => {
  const validator = new ArtifactPresenceValidator();
  const task = minimalTask();
  const decision = await validator.validate({
    context: stubContext(task),
    mode: 'acceptance',
    agentClaimedSuccess: true,
    requiredEvidence: task.requiredEvidence,
    presentEvidence: ['status.json'],
    testExitCode: 0,
  });
  assert.equal(decision.status, 'BLOCK');
  assert.equal(decision.exitCode, 1);
  assert.ok(decision.notes.some((note) => note.includes('Agent claimed success')));
  assert.ok(decision.notes.some((note) => note.includes('Missing required evidence')));
});

test('validator returns BASELINE_BLOCKED_EXPECTED when baseline tests fail with full evidence', async () => {
  const validator = new ArtifactPresenceValidator();
  const task = minimalTask({ mode: 'baseline' });
  const decision = await validator.validate({
    context: stubContext(task),
    mode: 'baseline',
    agentClaimedSuccess: false,
    requiredEvidence: task.requiredEvidence,
    presentEvidence: task.requiredEvidence,
    testExitCode: 1,
  });
  assert.equal(decision.status, 'BASELINE_BLOCKED_EXPECTED');
  assert.equal(decision.exitCode, 0);
});

test('validator returns PASS only when evidence and tests succeed', async () => {
  const validator = new ArtifactPresenceValidator();
  const task = minimalTask();
  const decision = await validator.validate({
    context: stubContext(task),
    mode: 'acceptance',
    agentClaimedSuccess: true,
    requiredEvidence: task.requiredEvidence,
    presentEvidence: task.requiredEvidence,
    testExitCode: 0,
  });
  assert.equal(decision.status, 'PASS');
  assert.equal(decision.exitCode, 0);
});
