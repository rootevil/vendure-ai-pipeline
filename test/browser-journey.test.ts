import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { PipelineConfig } from '../src/config/load-config.js';
import { createLogger } from '../src/logging/logger.js';
import type { ValidationStep } from '../src/models/types.js';
import { createExecutionContext } from '../src/safety/execution-context.js';
import { createFakeJourneyBrowserLauncher } from '../src/validator/browser-launcher.js';
import { IndependentValidator } from '../src/validator/independent-validator.js';
import { startBrowserCheckoutDemoStorefront } from '../src/scenarios/browser-checkout/demo-storefront.js';
import { buildCheckoutJourneyActions, CHECKOUT_SCREENSHOTS } from '../src/scenarios/browser-checkout/journey.js';
import {
  buildBrowserCheckoutTask,
  runBrowserCheckoutScenario,
} from '../src/scenarios/browser-checkout/run-scenario.js';

test('browser checkout scenario PASSes with numbered screenshots and playwright-results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-checkout-test-'));
  try {
    const { result, screenshots } = await runBrowserCheckoutScenario({
      rootDir: root,
      runId: 'checkout-demo',
      keepWorkspace: true,
      useRealBrowser: false,
    });

    assert.equal(result.status, 'PASS');
    assert.deepEqual(screenshots, [...CHECKOUT_SCREENSHOTS]);

    for (const name of CHECKOUT_SCREENSHOTS) {
      assert.ok(
        existsSync(join(result.artifactDir, 'screenshots', name)),
        `missing screenshot ${name}`,
      );
    }

    const playwrightResultsPath = join(result.artifactDir, 'playwright-results.json');
    assert.ok(existsSync(playwrightResultsPath));
    const playwrightResults = JSON.parse(readFileSync(playwrightResultsPath, 'utf8')) as {
      engine: string;
      status: string;
      screenshots: string[];
    };
    assert.equal(playwrightResults.engine, 'playwright');
    assert.equal(playwrightResults.status, 'PASS');
    assert.ok(playwrightResults.screenshots.length >= 4);

    for (const name of [
      'graphql-query-product.json',
      'graphql-query-order.json',
      'graphql-query-customer-orders.json',
      'api-order-state.json',
    ]) {
      assert.ok(
        existsSync(join(result.artifactDir, 'api-responses', name)),
        `missing backend evidence ${name}`,
      );
    }

    const checks = result.validationChecks.map((c) => c.checkName);
    assert.ok(checks.includes('checkout-journey'));
    assert.ok(checks.includes('graphql-query-product'));
    assert.ok(checks.includes('graphql-query-order'));
    assert.ok(checks.includes('graphql-query-customer-orders'));
    assert.ok(checks.includes('api-order-state'));
    assert.ok(checks.includes('database-order-by-code'));
    assert.ok(result.validationChecks.every((c) => c.status === 'PASS'));

    const dbEvidence = join(result.artifactDir, 'validation', 'database-order-by-code.json');
    assert.ok(existsSync(dbEvidence));
    const dbPayload = JSON.parse(readFileSync(dbEvidence, 'utf8')) as {
      output?: string;
      status: string;
    };
    assert.equal(dbPayload.status, 'PASS');
    assert.ok(
      dbPayload.output?.includes('PaymentSettled') ||
        JSON.stringify(dbPayload).includes('PaymentSettled'),
    );

    const verdict = JSON.parse(
      readFileSync(join(result.artifactDir, 'validator-verdict.json'), 'utf8'),
    ) as { status: string; checks: Array<{ name: string; status: string }> };
    assert.equal(verdict.status, 'PASS');
    assert.ok(verdict.checks.some((c) => c.name.includes('graphql') && c.status === 'PASS'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('browser journey BLOCKs when a critical assert fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-checkout-block-'));
  try {
    const server = await startBrowserCheckoutDemoStorefront();
    try {
      const actions: Extract<ValidationStep, { type: 'browser_journey' }>['actions'] = [
        ...buildCheckoutJourneyActions(),
        {
          type: 'assert',
          expectSelector: '[data-testid="missing-confirmation"]',
          expectTextContains: 'never',
        },
      ];

      const task = buildBrowserCheckoutTask({
        baseUrl: server.baseUrl,
        keepWorkspace: true,
      });
      const journey = task.validationSteps.find((s) => s.type === 'browser_journey');
      assert.ok(journey && journey.type === 'browser_journey');
      const taskWithFail = {
        ...task,
        validationSteps: [
          { id: 'evidence', type: 'evidence_present' as const },
          { ...journey, actions },
        ],
      };

      const config: PipelineConfig = {
        mode: 'acceptance',
        artifactsDir: join(root, 'artifacts'),
        workspaceDir: join(root, 'workspace'),
        maxIdenticalRetries: 1,
        maxTotalAttempts: 2,
        allowNetwork: true,
        logLevel: 'error',
        runId: 'checkout-block',
        writeAllowlist: ['src', 'data'],
        agentMode: 'mock',
        agentTimeoutMs: 30_000,
        openhandsCommand: 'openhands',
        mockAgentBehavior: 'success',
      };
      const context = createExecutionContext({
        config,
        task: taskWithFail,
        logger: createLogger({ level: 'error' }),
      });
      mkdirSync(context.artifactDir, { recursive: true });

      const pages = {
        '/': {
          title: 'Demo Store — Home',
          textBySelector: {
            '[data-testid="home-heading"]': 'Welcome',
            '[data-testid="product-link"]': 'Soft Pink Almond',
          },
          links: {
            '[data-testid="product-link"]': `${server.baseUrl}/product/soft-pink-almond`,
          },
        },
        '/product/soft-pink-almond': {
          title: 'Demo Store — Soft Pink Almond',
          textBySelector: {
            '[data-testid="product-heading"]': 'Soft Pink Almond',
            '[data-testid="add-to-cart"]': 'Add to cart',
          },
          links: { '[data-testid="add-to-cart"]': `${server.baseUrl}/cart` },
        },
        '/cart': {
          title: 'Demo Store — Cart',
          textBySelector: {
            '[data-testid="cart-heading"]': 'Your cart',
            '[data-testid="checkout-link"]': 'Checkout',
          },
          links: { '[data-testid="checkout-link"]': `${server.baseUrl}/checkout` },
        },
        '/checkout': {
          title: 'Demo Store — Checkout',
          textBySelector: {
            '[data-testid="checkout-heading"]': 'Checkout',
            '[data-testid="place-order"]': 'Place order',
            '[data-testid="order-confirmation"]': 'Order confirmed',
            '[data-testid="order-result"]':
              'Thank you — your order for Soft Pink Almond is confirmed.',
          },
          links: {},
        },
      };

      const validator = new IndependentValidator({
        allowNetwork: true,
        launchBrowser: createFakeJourneyBrowserLauncher({
          origin: server.baseUrl,
          pages,
        }),
      });

      const decision = await validator.validate({
        context,
        mode: 'acceptance',
        agentClaimedSuccess: true,
        requiredEvidence: task.requiredEvidence,
        presentEvidence: task.requiredEvidence,
        testExitCode: null,
        changedFiles: [],
      });

      assert.equal(decision.status, 'BLOCK');
      assert.equal(decision.verdict?.status, 'BLOCK');
      assert.ok(existsSync(join(context.artifactDir, 'playwright-results.json')));
    } finally {
      await server.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('browser PASS is insufficient — GraphQL order mismatch BLOCKs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'graphql-block-'));
  try {
    const server = await startBrowserCheckoutDemoStorefront();
    try {
      const task = buildBrowserCheckoutTask({
        baseUrl: server.baseUrl,
        keepWorkspace: true,
      });
      const journey = task.validationSteps.find((s) => s.type === 'browser_journey');
      assert.ok(journey && journey.type === 'browser_journey');

      const taskWrongOrder = {
        ...task,
        validationSteps: [
          { id: 'evidence', type: 'evidence_present' as const },
          journey,
          {
            id: 'graphql-query-order',
            type: 'graphql_request' as const,
            url: `${server.baseUrl}/shop-api`,
            query: '{ order(code: "ORD-MISSING") { code } }',
            variables: {},
            headers: {},
            expectNoErrors: true,
            expectDataPath: 'order.code',
            expectDataEquals: 'ORD-MISSING',
            timeoutMs: 5_000,
          },
        ],
      };

      const config: PipelineConfig = {
        mode: 'acceptance',
        artifactsDir: join(root, 'artifacts'),
        workspaceDir: join(root, 'workspace'),
        maxIdenticalRetries: 1,
        maxTotalAttempts: 2,
        allowNetwork: true,
        logLevel: 'error',
        runId: 'graphql-block',
        writeAllowlist: ['src', 'data'],
        agentMode: 'mock',
        agentTimeoutMs: 30_000,
        openhandsCommand: 'openhands',
        mockAgentBehavior: 'success',
      };
      const context = createExecutionContext({
        config,
        task: taskWrongOrder,
        logger: createLogger({ level: 'error' }),
      });
      mkdirSync(context.artifactDir, { recursive: true });

      const pages = {
        '/': {
          title: 'Demo Store — Home',
          textBySelector: {
            '[data-testid="home-heading"]': 'Welcome',
            '[data-testid="product-link"]': 'Soft Pink Almond',
          },
          links: {
            '[data-testid="product-link"]': `${server.baseUrl}/product/soft-pink-almond`,
          },
        },
        '/product/soft-pink-almond': {
          title: 'Demo Store — Soft Pink Almond',
          textBySelector: {
            '[data-testid="product-heading"]': 'Soft Pink Almond',
            '[data-testid="add-to-cart"]': 'Add to cart',
          },
          links: { '[data-testid="add-to-cart"]': `${server.baseUrl}/cart` },
        },
        '/cart': {
          title: 'Demo Store — Cart',
          textBySelector: {
            '[data-testid="cart-heading"]': 'Your cart',
            '[data-testid="checkout-link"]': 'Checkout',
          },
          links: { '[data-testid="checkout-link"]': `${server.baseUrl}/checkout` },
        },
        '/checkout': {
          title: 'Demo Store — Checkout',
          textBySelector: {
            '[data-testid="checkout-heading"]': 'Checkout',
            '[data-testid="place-order"]': 'Place order',
            '[data-testid="order-confirmation"]': 'Order confirmed',
            '[data-testid="order-result"]':
              'Thank you — your order for Soft Pink Almond is confirmed.',
          },
          links: {},
        },
      };

      // Pre-confirm checkout so browser journey PASSes; GraphQL must still BLOCK.
      pages['/checkout'].textBySelector['[data-testid="order-confirmation"]'] = 'Order confirmed';
      pages['/checkout'].textBySelector['[data-testid="order-result"]'] =
        'Thank you — your order for Soft Pink Almond is confirmed.';

      const validator = new IndependentValidator({
        allowNetwork: true,
        launchBrowser: createFakeJourneyBrowserLauncher({
          origin: server.baseUrl,
          pages,
          onClick: (selector, path) => {
            if (selector === '[data-testid="place-order"]' && path === '/checkout') {
              pages['/checkout'] = {
                ...pages['/checkout'],
                textBySelector: {
                  ...pages['/checkout'].textBySelector,
                  '[data-testid="order-confirmation"]': 'Order confirmed',
                  '[data-testid="order-result"]':
                    'Thank you — your order for Soft Pink Almond is confirmed.',
                },
              };
            }
          },
        }),
      });

      const decision = await validator.validate({
        context,
        mode: 'acceptance',
        agentClaimedSuccess: true,
        requiredEvidence: task.requiredEvidence,
        presentEvidence: task.requiredEvidence,
        testExitCode: null,
        changedFiles: [],
      });

      assert.equal(decision.status, 'BLOCK');
      const journeyCheck = decision.checks?.find((c) => c.checkName === 'checkout-journey');
      const orderCheck = decision.checks?.find((c) => c.checkName === 'graphql-query-order');
      assert.equal(journeyCheck?.status, 'PASS');
      assert.ok(orderCheck && orderCheck.status !== 'PASS');
      assert.ok(existsSync(join(context.artifactDir, 'api-responses', 'graphql-query-order.json')));
    } finally {
      await server.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
