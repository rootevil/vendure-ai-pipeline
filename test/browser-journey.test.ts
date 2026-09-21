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

    const verdict = JSON.parse(
      readFileSync(join(result.artifactDir, 'validator-verdict.json'), 'utf8'),
    ) as { status: string };
    assert.equal(verdict.status, 'PASS');
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
