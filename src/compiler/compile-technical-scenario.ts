import type { BusinessTaskCard } from './business-task-card.js';
import {
  TechnicalScenarioSchema,
  type TechnicalCheck,
  type TechnicalScenario,
} from './technical-scenario.js';

const DEFAULT_EVIDENCE = [
  'run-manifest.json',
  'status.json',
  'stdout.log',
  'stderr.log',
  'change-summary.md',
  'rollback.md',
  'summary.md',
  'validation-results.json',
  'screenshots/',
  'api-responses/',
] as const;

interface BaseUrls {
  readonly storefront: string;
  readonly shopApi: string;
  readonly adminApi: string;
  readonly health: string;
}

/**
 * PM / E2E Scenario Compiler — business goal → technical-task.json shape.
 * Creates technical acceptance conditions, evidence, cleanup, rollback, and stop conditions.
 */
export function compileTechnicalScenario(card: BusinessTaskCard): TechnicalScenario {
  const base = resolveBaseUrls(card);
  const browserChecks: TechnicalCheck[] = [];
  const apiChecks: TechnicalCheck[] = [];
  const databaseChecks: TechnicalCheck[] = [];
  const assertions: TechnicalCheck[] = [];
  const actions: string[] = [
    'Materialize isolated workspace for the target environment',
    'Allow agent to implement only inside writeAllowlist',
    'Collect logs, diffs, screenshots, and API responses as evidence',
    'Hand off to independent validator (agent claimedSuccess is ignored)',
  ];

  assertions.push({
    id: 'evidence-pack',
    description: 'Required evidence files must be present before PASS',
    validationType: 'evidence_present',
    params: { files: [...DEFAULT_EVIDENCE] },
    evidence: [...DEFAULT_EVIDENCE],
  });

  for (const bullet of card.acceptance) {
    const expanded = expandAcceptanceBullet(bullet, base);
    actions.push(...expanded.actions);
    browserChecks.push(...expanded.browserChecks);
    apiChecks.push(...expanded.apiChecks);
    databaseChecks.push(...expanded.databaseChecks);
    assertions.push(...expanded.assertions);
  }

  const scenario: TechnicalScenario = {
    id: card.id,
    title: card.title ?? humanizeId(card.id),
    goal: card.goal.trim(),
    acceptance: [...card.acceptance],
    environment: {
      target: card.environment.target,
      ...(card.environment.baseUrl ? { baseUrl: card.environment.baseUrl } : {}),
      ...(card.environment.storefrontUrl
        ? { storefrontUrl: card.environment.storefrontUrl }
        : {}),
      ...(card.environment.shopApiUrl ? { shopApiUrl: card.environment.shopApiUrl } : {}),
      ...(card.environment.adminApiUrl ? { adminApiUrl: card.environment.adminApiUrl } : {}),
    },
    preconditions: [
      `environment.target=${card.environment.target}`,
      'No production credentials or unrestricted minipc/SSH',
      'Disposable workspace and artifact directories available',
      'Independent validator available (in-process or artifact CLI)',
      ...(card.environment.target === 'isolated-vendure'
        ? [
            'Isolated Vendure (or demo stand-in) reachable on allowlisted loopback when network enabled',
            'Shop/Admin/storefront URLs default to ephemeral http://127.0.0.1:0/… until rebound by a scenario runner',
          ]
        : []),
    ],
    actions: unique(actions),
    assertions,
    browserChecks,
    apiChecks,
    databaseChecks,
    evidenceRequirements: [...DEFAULT_EVIDENCE],
    cleanup: [
      'Stop ephemeral storefront/demo servers started for this run',
      'Remove disposable workspace when cleanupWorkspace=true',
      'Retain artifacts/<runId>/ for review',
      'Docker stack volumes removed only via scripts/cleanup.sh when used',
    ],
    rollback: [
      'Discard disposable workspace (see rollback.md in the evidence pack)',
      'Restore workspace-checkpoint/ if a pre-agent snapshot was taken',
      'Do not roll back production or shared environments (out of scope)',
    ],
    stopConditions: [
      'Missing auth/identity required for the task → AUTH_REQUIRED or BLOCK',
      'Secret-like or production indicators in agent output → safe-stop BLOCK',
      'Path escape or write outside allowlist → BLOCK',
      'Network destination outside SSRF allowlist → BLOCK',
      'Identical recoverable failure budget exhausted → circuit open BLOCK',
      'Agent claimedSuccess without independent check evidence → never PASS',
      `Leave environment target ${card.environment.target}`,
    ],
    writeAllowlist: card.writeAllowlist ?? defaultWriteAllowlist(card.environment.target),
    mode: card.mode ?? 'acceptance',
    timeoutMs: card.timeoutMs ?? 300_000,
  };

  return TechnicalScenarioSchema.parse(scenario);
}

interface ExpandedBuckets {
  readonly actions: string[];
  readonly browserChecks: TechnicalCheck[];
  readonly apiChecks: TechnicalCheck[];
  readonly databaseChecks: TechnicalCheck[];
  readonly assertions: TechnicalCheck[];
}

function expandAcceptanceBullet(bullet: string, base: BaseUrls): ExpandedBuckets {
  const id = slug(bullet);
  const normalized = bullet.toLowerCase();
  const empty: ExpandedBuckets = {
    actions: [],
    browserChecks: [],
    apiChecks: [],
    databaseChecks: [],
    assertions: [],
  };

  if (
    /(storefront|shop|homepage|home page).*(load|open|available)/.test(normalized) ||
    normalized === 'storefront loads'
  ) {
    return {
      actions: ['Probe storefront health and open the storefront in a browser check'],
      apiChecks: [
        {
          id: `${id}-health`,
          description: 'Storefront / health endpoint returns HTTP 200',
          fromAcceptance: bullet,
          validationType: 'application_health',
          params: { url: base.health, expectStatus: 200, timeoutMs: 10_000 },
          evidence: ['api-responses/health.json'],
        },
      ],
      browserChecks: [
        {
          id: `${id}-browser`,
          description: 'Storefront document loads (body present); screenshot retained',
          fromAcceptance: bullet,
          validationType: 'browser_playwright',
          params: {
            url: base.storefront,
            expectSelector: 'body',
            screenshotName: `${id}.png`,
            timeoutMs: 15_000,
          },
          evidence: [`screenshots/${id}.png`],
        },
      ],
      databaseChecks: [],
      assertions: [
        {
          id: `${id}-assert`,
          description: 'Business: storefront is available to the customer',
          fromAcceptance: bullet,
          params: {},
          evidence: [],
        },
      ],
    };
  }

  if (/product.*visible|visible.*product|product (is )?listed|catalog/.test(normalized)) {
    return {
      actions: ['List products via Shop API and assert product UI is visible'],
      apiChecks: [
        {
          id: `${id}-api`,
          description: 'Shop products HTTP endpoint returns 200',
          fromAcceptance: bullet,
          validationType: 'http_response',
          params: {
            url: `${base.shopApi.replace(/\/$/, '')}/products`,
            method: 'GET',
            expectStatus: 200,
            timeoutMs: 10_000,
          },
          evidence: ['api-responses/products.json'],
        },
      ],
      browserChecks: [
        {
          id: `${id}-browser`,
          description: 'Product listing selector is present on the storefront',
          fromAcceptance: bullet,
          validationType: 'browser_playwright',
          params: {
            url: base.storefront,
            expectSelector: '[data-testid="product"], .product, #product-list, main',
            screenshotName: `${id}.png`,
            timeoutMs: 15_000,
          },
          evidence: [`screenshots/${id}.png`],
        },
      ],
      databaseChecks: [],
      assertions: [
        {
          id: `${id}-assert`,
          description: 'Business: at least one product is visible to the customer',
          fromAcceptance: bullet,
          params: {},
          evidence: [],
        },
      ],
    };
  }

  if (/add(ed)? to cart|cart/.test(normalized) && /add|can/.test(normalized)) {
    return {
      actions: ['Add a product variant to the cart via Shop API GraphQL'],
      apiChecks: [
        {
          id: `${id}-graphql`,
          description: 'Shop API addItemToOrder returns an Order or typed error payload',
          fromAcceptance: bullet,
          validationType: 'graphql_request',
          params: {
            url: base.shopApi,
            query:
              'mutation { addItemToOrder(productVariantId: "1", quantity: 1) { ... on Order { id totalQuantity } ... on ErrorResult { errorCode message } } }',
            expectDataPath: 'addItemToOrder',
            expectNoErrors: false,
            timeoutMs: 15_000,
          },
          evidence: ['api-responses/add-item-to-order.json'],
        },
      ],
      browserChecks: [],
      databaseChecks: [],
      assertions: [
        {
          id: `${id}-assert`,
          description: 'Business: customer can add a product to the cart',
          fromAcceptance: bullet,
          params: {},
          evidence: [],
        },
      ],
    };
  }

  if (/checkout/.test(normalized)) {
    return {
      actions: ['Open checkout route and assert checkout UI is reachable'],
      apiChecks: [],
      browserChecks: [
        {
          id: `${id}-browser`,
          description: 'Checkout page exposes a form or checkout landmark',
          fromAcceptance: bullet,
          validationType: 'browser_playwright',
          params: {
            url: `${base.storefront.replace(/\/$/, '')}/checkout`,
            expectSelector: 'form, [data-testid="checkout"], #checkout, main',
            screenshotName: `${id}.png`,
            timeoutMs: 15_000,
          },
          evidence: [`screenshots/${id}.png`],
        },
      ],
      databaseChecks: [],
      assertions: [
        {
          id: `${id}-assert`,
          description: 'Business: checkout can be started',
          fromAcceptance: bullet,
          params: {},
          evidence: [],
        },
      ],
    };
  }

  if (/order is created|creates? an? order|place(d)? order/.test(normalized)) {
    return {
      actions: ['Verify an order exists via Shop GraphQL activeOrder'],
      apiChecks: [
        {
          id: `${id}-graphql`,
          description: 'Shop API activeOrder is present',
          fromAcceptance: bullet,
          validationType: 'graphql_request',
          params: {
            url: base.shopApi,
            query: '{ activeOrder { id code state totalWithTax } }',
            expectNoErrors: true,
            expectDataPath: 'activeOrder',
            timeoutMs: 15_000,
          },
          evidence: ['api-responses/active-order.json'],
        },
      ],
      browserChecks: [],
      databaseChecks: [],
      assertions: [
        {
          id: `${id}-assert`,
          description: 'Business: an order was created',
          fromAcceptance: bullet,
          params: {},
          evidence: [],
        },
      ],
    };
  }

  if (/backend.*(order|contains)|order.*(backend|database|db|admin)/.test(normalized)) {
    return {
      actions: ['Verify backend/admin and persisted state contain the order'],
      apiChecks: [
        {
          id: `${id}-admin`,
          description: 'Admin API orders query returns at least one item',
          fromAcceptance: bullet,
          validationType: 'graphql_request',
          params: {
            url: base.adminApi,
            query: '{ orders(options: { take: 1 }) { totalItems items { id code } } }',
            expectNoErrors: true,
            expectDataPath: 'orders.totalItems',
            timeoutMs: 15_000,
          },
          evidence: ['api-responses/admin-orders.json'],
        },
      ],
      browserChecks: [],
      databaseChecks: [
        {
          id: `${id}-db`,
          description: 'Persisted order-state fixture/count shows one order',
          fromAcceptance: bullet,
          validationType: 'database_state',
          params: {
            driver: 'json_fixture',
            fixturePath: 'data/order-state.json',
            query: 'count',
            expectRowCount: 1,
          },
          evidence: ['data/order-state.json'],
        },
      ],
      assertions: [
        {
          id: `${id}-assert`,
          description: 'Business: backend contains the order',
          fromAcceptance: bullet,
          params: {},
          evidence: [],
        },
      ],
    };
  }

  return {
    ...empty,
    actions: [`Record evidence that business acceptance holds: ${bullet}`],
    assertions: [
      {
        id: `${id}-evidence-note`,
        description: `Acceptance evidence note must contain: ${bullet}`,
        fromAcceptance: bullet,
        validationType: 'workspace_file_contains',
        params: {
          path: `evidence/acceptance/${id}.txt`,
          contains: bullet,
        },
        evidence: [`evidence/acceptance/${id}.txt`],
      },
    ],
  };
}

function resolveBaseUrls(card: BusinessTaskCard): BaseUrls {
  const root = card.environment.baseUrl ?? 'http://127.0.0.1:0';
  return {
    storefront: card.environment.storefrontUrl ?? `${root}/`,
    shopApi: card.environment.shopApiUrl ?? `${root}/shop-api`,
    adminApi: card.environment.adminApiUrl ?? `${root}/admin-api`,
    health: `${root}/health`,
  };
}

function defaultWriteAllowlist(target: string): string[] {
  if (target === 'isolated-vendure') {
    return ['storefront', 'vendure-store', 'src', 'app', 'evaluation-demo'];
  }
  return ['src', 'app'];
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'step'
  );
}

function humanizeId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}
