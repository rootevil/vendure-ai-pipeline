import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileBusinessTaskCard } from '../src/compiler/compile-business-card.js';
import { parseBusinessTaskCardYaml } from '../src/compiler/load-business-card.js';
import { compileScenarioFromPath } from '../src/compiler/scenario-compiler.js';
import { parseTaskDefinition } from '../src/task/task-definition.js';

const CUSTOMER_ORDER_YAML = `
id: customer-order-demo

goal: >
  A customer should be able to browse a product,
  add it to the cart and complete the checkout flow.

acceptance:
  - storefront loads
  - product is visible
  - product can be added to cart
  - checkout can be started
  - order is created
  - backend contains the order

environment:
  target: isolated-vendure
`;

describe('business task card', () => {
  it('parses client-style business YAML', () => {
    const card = parseBusinessTaskCardYaml(CUSTOMER_ORDER_YAML);
    assert.equal(card.id, 'customer-order-demo');
    assert.match(card.goal, /browse a product/i);
    assert.equal(card.acceptance.length, 6);
    assert.equal(card.environment.target, 'isolated-vendure');
  });

  it('compiles acceptance bullets into machine validationSteps', () => {
    const card = parseBusinessTaskCardYaml(CUSTOMER_ORDER_YAML);
    const task = compileBusinessTaskCard(card);
    parseTaskDefinition(task);

    assert.equal(task.id, 'customer-order-demo');
    assert.deepEqual(task.acceptanceCriteria, card.acceptance);
    assert.ok(task.validationSteps.some((s) => s.type === 'evidence_present'));
    assert.ok(task.validationSteps.some((s) => s.type === 'application_health'));
    assert.ok(task.validationSteps.some((s) => s.type === 'browser_playwright'));
    assert.ok(task.validationSteps.some((s) => s.type === 'graphql_request'));
    assert.ok(task.validationSteps.some((s) => s.type === 'http_response'));
    assert.ok(task.validationSteps.some((s) => s.type === 'database_state'));
    assert.ok(task.stages.length >= 3);
    assert.ok(task.circuitBreakRules.some((r) => /claimedSuccess/i.test(r)));
  });

  it('compiles tasks/customer-order-demo.yaml from disk', () => {
    const task = compileScenarioFromPath('tasks/customer-order-demo.yaml');
    assert.equal(task.id, 'customer-order-demo');
    assert.ok(task.sourcePaths.some((p) => p.includes('customer-order-demo.yaml')));
    assert.ok(task.validationSteps.length > 6);
  });
});
