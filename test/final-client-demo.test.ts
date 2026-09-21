import assert from 'node:assert/strict';
import test from 'node:test';

import { compileScenarioBundleFromPath } from '../src/compiler/scenario-compiler.js';

test('final demo purchase goal compiles to a validation plan', () => {
  const bundle = compileScenarioBundleFromPath('tasks/final-demo-goal.yaml');
  assert.equal(bundle.task.id, 'final-demo-purchase');
  assert.match(bundle.task.goal, /purchase a product from the storefront/i);
  assert.ok(bundle.technical);
  assert.ok(bundle.technical.acceptance.length >= 4);
  assert.ok(bundle.task.validationSteps.length >= 1);
  assert.ok((bundle.technical.browserChecks?.length ?? 0) + (bundle.technical.apiChecks?.length ?? 0) > 0);
});
