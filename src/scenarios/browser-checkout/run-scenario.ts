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
import {
  buildPostBrowserGraphqlSteps,
  DEMO_CUSTOMER_EMAIL,
  DEMO_ORDER_CODE,
} from './graphql-checks.js';
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
 * Dual-evidence checkout demo:
 *
 *   1) Playwright browser journey (screenshots)
 *   2) Independent GraphQL/API product + order queries (api-responses/)
 *
 * Browser evidence alone is not enough — backend state must match.
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
    server = await startBrowserCheckoutDemoStorefront({
      productName,
      orderCode: DEMO_ORDER_CODE,
      customerEmail: DEMO_CUSTOMER_EMAIL,
    });
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
  const graphqlSteps = buildPostBrowserGraphqlSteps({
    baseUrl: input.baseUrl,
    productName,
    orderCode: DEMO_ORDER_CODE,
    customerEmail: DEMO_CUSTOMER_EMAIL,
  });

  return {
    id: 'browser-checkout-demo',
    title: 'Browser + GraphQL checkout validation demo',
    goal: 'Prove dual evidence: Playwright screenshots plus independent Shop API product/order queries',
    acceptanceCriteria: [
      'Storefront home loads',
      'Product page is reachable from the catalog',
      'Add to cart reaches the cart page',
      'Checkout shows order confirmation',
      'GraphQL product query returns the expected product',
      'GraphQL order/customer queries confirm backend order state',
    ],
    allowedTools: ['filesystem', 'mock'],
    timeoutMs: 90_000,
    retryPolicy: { maxIdenticalRetries: 1, maxTotalAttempts: 2 },
    // Browser first, then independent GraphQL/API — never trust UI alone.
    validationSteps: [{ id: 'evidence', type: 'evidence_present' }, journey, ...graphqlSteps],
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
      {
        id: 'graphql-api-validation',
        description: 'Independent Shop API queries after browser validation',
        preconditions: ['Browser journey completed or skipped only if blocked earlier'],
        actions: [
          'GraphQL query product',
          'GraphQL query customer/order',
          'Verify expected backend state via API',
        ],
        expectedChecks: ['graphql_request', 'http_response'],
        cleanup: ['API response payloads retained under api-responses/'],
      },
    ],
    circuitBreakRules: [
      'Agent claimed success never grants PASS',
      'Browser screenshots alone never grant PASS without GraphQL/API evidence',
      'Playwright + GraphQL evidence together decide PASS or BLOCK',
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
