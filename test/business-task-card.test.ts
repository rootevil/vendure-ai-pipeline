import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileBusinessTaskCard } from '../src/compiler/compile-business-card.js';
import { compileTechnicalScenario } from '../src/compiler/compile-technical-scenario.js';
import { parseBusinessTaskCardYaml } from '../src/compiler/load-business-card.js';
import {
  compileScenarioBundleFromPath,
  compileScenarioFromPath,
} from '../src/compiler/scenario-compiler.js';
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

describe('scenario compiler technical-task.json', () => {
  it('emits client-shaped technical scenario with cleanup/rollback/stopConditions', () => {
    const card = parseBusinessTaskCardYaml(CUSTOMER_ORDER_YAML);
    const technical = compileTechnicalScenario(card);

    assert.equal(technical.id, 'customer-order-demo');
    assert.ok(technical.preconditions.length > 0);
    assert.ok(technical.actions.length > 0);
    assert.ok(technical.assertions.length > 0);
    assert.ok(technical.browserChecks.length > 0);
    assert.ok(technical.apiChecks.length > 0);
    assert.ok(technical.databaseChecks.length > 0);
    assert.ok(technical.evidenceRequirements.includes('status.json'));
    assert.ok(technical.cleanup.some((c) => /workspace|server/i.test(c)));
    assert.ok(technical.rollback.some((r) => /rollback|workspace/i.test(r)));
    assert.ok(technical.stopConditions.some((s) => /claimedSuccess/i.test(s)));
  });

  it('compile bundle returns technical + task', () => {
    const bundle = compileScenarioBundleFromPath('tasks/customer-order-demo.yaml');
    assert.ok(bundle.technical);
    assert.equal(bundle.technical?.id, 'customer-order-demo');
    assert.equal(bundle.task.id, 'customer-order-demo');
    parseTaskDefinition(bundle.task);
  });
});
