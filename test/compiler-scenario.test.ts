import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileScenarioFromPath } from '../src/compiler/scenario-compiler.js';

describe('scenario compiler (architecture vertical slice)', () => {
  it('compiles evaluation-demo/task.md into structured catalog task', () => {
    const task = compileScenarioFromPath('evaluation-demo/task.md');
    assert.equal(task.id, 'vendure-public-catalog-e2e');
    assert.ok(task.validationSteps.length >= 1);
    assert.ok(task.sourcePaths.some((p) => p.includes('evaluation-demo/task.md')));
  });

  it('compiles tasks/demo-task.yaml via JSON companion', () => {
    const task = compileScenarioFromPath('tasks/demo-task.yaml');
    assert.equal(task.id, 'vendure-public-catalog-e2e');
    assert.ok(task.sourcePaths.some((p) => p.includes('tasks/demo-task.yaml')));
  });

  it('compiles tasks/failure-recovery-task.yaml', () => {
    const task = compileScenarioFromPath('tasks/failure-recovery-task.yaml');
    assert.equal(task.id, 'failure-recovery-demo');
  });
});
