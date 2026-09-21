import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockAgentAdapter } from '../../agent/mock-adapter.js';
import type { PipelineConfig } from '../../config/load-config.js';
import { TaskRunner } from '../../execution/task-runner.js';
import { createLogger } from '../../logging/logger.js';
import type { RunResult, TaskDefinition } from '../../models/types.js';
import {
  createFakeJourneyBrowserLauncher,
  type FakeJourneyPageState,
} from '../../validator/browser-launcher.js';
import { startBrowserCheckoutDemoStorefront, type DemoStorefrontHandle } from './demo-storefront.js';
import { buildCheckoutJourneyStep, CHECKOUT_SCREENSHOTS } from './journey.js';

export interface BrowserCheckoutScenarioOptions {
  readonly rootDir?: string;
  readonly runId?: string;
  readonly keepWorkspace?: boolean;
  readonly useRealBrowser?: boolean;
  readonly productName?: string;
}

export interface BrowserCheckoutScenarioResult {
  readonly result: RunResult;
  readonly baseUrl: string;
  readonly task: TaskDefinition;
  readonly screenshots: readonly string[];
}

/**
 * Visually obvious Playwright browser-validation demo.
 *
 *   Open storefront → Find product → Open product → Add to cart → Checkout → Verify
 *
 * Captures:
 *   screenshots/01-home.png
 *   screenshots/02-product.png
 *   screenshots/03-cart.png
 *   screenshots/04-checkout.png
 *   playwright-results.json
 */
export async function runBrowserCheckoutScenario(
  options: BrowserCheckoutScenarioOptions = {},
): Promise<BrowserCheckoutScenarioResult> {
  const root = options.rootDir ?? mkdtempSync(join(tmpdir(), 'browser-checkout-'));
  const runId = options.runId ?? `browser-checkout-${Date.now()}`;
  const workspaceDir = join(root, 'workspace');
  const artifactsDir = join(root, 'artifacts');
  const productName = options.productName ?? 'Soft Pink Almond';
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  let server: DemoStorefrontHandle | null = null;
  try {
    server = await startBrowserCheckoutDemoStorefront({ productName });
    const task = buildBrowserCheckoutTask({
      baseUrl: server.baseUrl,
      productName,
      keepWorkspace: options.keepWorkspace === true,
    });
    writeFileSync(join(root, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');

    const useRealBrowser =
      options.useRealBrowser === true || process.env.PIPELINE_USE_REAL_BROWSER === '1';

    const config: PipelineConfig = {
      mode: 'acceptance',
      artifactsDir,
      workspaceDir,
      maxIdenticalRetries: task.retryPolicy.maxIdenticalRetries,
      maxTotalAttempts: task.retryPolicy.maxTotalAttempts,
      allowNetwork: true,
      logLevel: 'info',
      runId,
      writeAllowlist: [...task.writeAllowlist],
      agentMode: 'mock',
      agentTimeoutMs: task.timeoutMs,
      openhandsCommand: 'openhands',
      mockAgentBehavior: 'success',
    };

    const pages = buildFakePages(server.baseUrl, productName);
    const runner = new TaskRunner({
      config,
      logger: createLogger({ level: 'info' }),
      agent: new MockAgentAdapter({ behavior: 'success' }),
      runTests: async () => 0,
      ...(useRealBrowser
        ? {}
        : {
            launchBrowser: createFakeJourneyBrowserLauncher({
              origin: server.baseUrl,
              pages,
              onClick: (selector, path) => {
                if (selector === '[data-testid="place-order"]' && path === '/checkout') {
                  pages['/checkout'] = {
                    ...pages['/checkout']!,
                    textBySelector: {
                      ...pages['/checkout']!.textBySelector,
                      '[data-testid="order-confirmation"]': 'Order confirmed',
                      '[data-testid="order-result"]': `Thank you — your order for ${productName} is confirmed.`,
                    },
                  };
                }
              },
            }),
          }),
    });

    const result = await runner.execute(task);
    return {
      result,
      baseUrl: server.baseUrl,
      task,
      screenshots: [...CHECKOUT_SCREENSHOTS],
    };
  } finally {
    if (server) {
      await server.close();
    }
  }
}

export function buildBrowserCheckoutTask(input: {
  readonly baseUrl: string;
  readonly productName?: string;
  readonly keepWorkspace?: boolean;
}): TaskDefinition {
  const productName = input.productName ?? 'Soft Pink Almond';
  const journey = buildCheckoutJourneyStep({
    startUrl: input.baseUrl,
    productName,
  });

  return {
    id: 'browser-checkout-demo',
    title: 'Browser checkout validation demo',
    goal: 'Prove Playwright can walk storefront → product → cart → checkout with numbered screenshots',
    acceptanceCriteria: [
      'Storefront home loads',
      'Product page is reachable from the catalog',
      'Add to cart reaches the cart page',
      'Checkout shows order confirmation',
    ],
    allowedTools: ['filesystem', 'mock'],
    timeoutMs: 90_000,
    retryPolicy: { maxIdenticalRetries: 1, maxTotalAttempts: 2 },
    validationSteps: [{ id: 'evidence', type: 'evidence_present' }, journey],
    mode: 'acceptance',
    sourcePaths: [],
    writeAllowlist: ['src', 'data'],
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
        id: 'browser-checkout',
        description: 'Playwright storefront checkout journey with screenshots',
        preconditions: ['Demo storefront reachable on loopback'],
        actions: [
          'Open storefront',
          'Find product',
          'Open product',
          'Add to cart',
          'Checkout',
          'Verify expected result',
        ],
        expectedChecks: ['browser_journey'],
        cleanup: ['Disposable workspace may be removed after evidence is collected'],
      },
    ],
    circuitBreakRules: [
      'Agent claimed success never grants PASS',
      'Playwright journey evidence decides PASS or BLOCK',
    ],
    cleanupWorkspace: input.keepWorkspace !== true,
  };
}

function buildFakePages(origin: string, productName: string): Record<string, FakeJourneyPageState> {
  const slug = 'soft-pink-almond';
  return {
    '/': {
      title: 'Demo Store — Home',
      textBySelector: {
        body: 'Welcome',
        '[data-testid="home-heading"]': 'Welcome to the storefront',
        '[data-testid="product-link"]': productName,
      },
      links: {
        '[data-testid="product-link"]': `${origin}/product/${slug}`,
      },
    },
    [`/product/${slug}`]: {
      title: `Demo Store — ${productName}`,
      textBySelector: {
        '[data-testid="product-heading"]': productName,
        '[data-testid="add-to-cart"]': 'Add to cart',
      },
      links: {
        '[data-testid="add-to-cart"]': `${origin}/cart`,
      },
    },
    '/cart': {
      title: 'Demo Store — Cart',
      textBySelector: {
        '[data-testid="cart-heading"]': 'Your cart',
        '[data-testid="checkout-link"]': 'Checkout',
      },
      links: {
        '[data-testid="checkout-link"]': `${origin}/checkout`,
      },
    },
    '/checkout': {
      title: 'Demo Store — Checkout',
      textBySelector: {
        '[data-testid="checkout-heading"]': 'Checkout',
        '[data-testid="place-order"]': 'Place order',
        '[data-testid="order-confirmation"]': '',
        '[data-testid="order-result"]': '',
      },
      links: {},
    },
  };
}
