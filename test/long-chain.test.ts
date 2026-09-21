import assert from 'node:assert/strict';
import test from 'node:test';

import { compileScenarioBundleFromPath } from '../src/compiler/scenario-compiler.js';
import { discoverLongChainTasks } from '../src/long-chain/discover-tasks.js';
import { runLongChainTasks } from '../src/long-chain/run-long-chain.js';

test('discovers task-01, task-02, task-03 by filename only', () => {
  const paths = discoverLongChainTasks('tasks');
  assert.equal(paths.length, 3);
  assert.match(paths[0] ?? '', /task-01\.yaml$/);
  assert.match(paths[1] ?? '', /task-02\.yaml$/);
  assert.match(paths[2] ?? '', /task-03\.yaml$/);
});

test('each long-chain card compiles through the same Scenario path', () => {
  for (const path of discoverLongChainTasks('tasks')) {
    const bundle = compileScenarioBundleFromPath(path);
    assert.ok(bundle.task.id.length > 0);
    assert.ok(bundle.task.validationSteps.length > 0);
    assert.ok(bundle.technical);
    assert.ok(bundle.technical.acceptance.length > 0);
    assert.ok(bundle.technical.rollback.length > 0);
    assert.ok(bundle.technical.cleanup.length > 0);
  }
});

test('long-chain compile-only runs Task → Scenario for all slots without branching', async () => {
  const result = await runLongChainTasks({ compileOnly: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.tasks.length, 3);
  assert.ok(result.tasks.every((task) => task.compiled && task.status === 'COMPILED'));
  assert.ok(result.summaryLines.some((line) => line.includes('Task → Scenario → Agent')));
  assert.equal(result.tasks[0]?.taskId, 'task-01');
  assert.equal(result.tasks[1]?.taskId, 'task-02');
  assert.equal(result.tasks[2]?.taskId, 'task-03');
});
