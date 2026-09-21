import type { TaskDefinition, TaskStage, ValidationStep } from '../models/types.js';
import type { BusinessTaskCard } from './business-task-card.js';

const DEFAULT_EVIDENCE = [
  'run-manifest.json',
  'status.json',
  'stdout.log',
  'stderr.log',
  'change-summary.md',
  'rollback.md',
  'summary.md',
] as const;

/**
 * Expand a business task card into a machine-checkable TaskDefinition.
 * Maps acceptance bullets → validationSteps / stages without requiring the
 * human to name GraphQL fields, selectors, or CLI commands.
 */
export function compileBusinessTaskCard(card: BusinessTaskCard): TaskDefinition {
  const base = resolveBaseUrls(card);
  const validationSteps: ValidationStep[] = [
    { id: 'evidence', type: 'evidence_present' },
  ];
  const stages: TaskStage[] = [
    {
      id: 'compile-acceptance',
      description: 'Business goal compiled into machine-checkable metrics',
      preconditions: [`environment.target=${card.environment.target}`],
      actions: ['Expand acceptance bullets into independent validation steps'],
      expectedChecks: card.acceptance.map((a) => `metric:${slug(a)}`),
      cleanup: [],
    },
    {
      id: 'agent-implement',
      description: 'Autonomous agent works toward the business goal inside the allowlist',
      preconditions: ['Isolated workspace ready', 'Write allowlist enforced'],
      actions: ['Read code', 'Implement changes', 'Run local checks'],
      expectedChecks: ['Agent produces reviewable diffs and logs'],
      cleanup: [],
    },
  ];

  const checkIds: string[] = [];
  for (const bullet of card.acceptance) {
    const expanded = expandAcceptanceBullet(bullet, base);
    validationSteps.push(...expanded.steps);
    checkIds.push(...expanded.steps.map((s) => s.id));
    stages.push({
      id: `accept-${slug(bullet)}`,
      description: `Business acceptance: ${bullet}`,
      preconditions: [`goal refers to: ${summarizeGoal(card.goal)}`],
      actions: expanded.actions,
      expectedChecks: expanded.steps.map((s) => s.id),
      cleanup: [],
    });
  }

  stages.push({
    id: 'independent-validate',
    description: 'Independent validator derives PASS/BLOCK from evidence only',
    preconditions: checkIds.map((id) => `check:${id}`),
    actions: ['Run validationSteps', 'Write evidence pack'],
    expectedChecks: ['PASS only when all independent checks succeed'],
    cleanup: ['Stop ephemeral demo services if started'],
  });

  return {
    id: card.id,
    title: card.title ?? humanizeId(card.id),
    goal: card.goal.trim(),
    acceptanceCriteria: [...card.acceptance],
    allowedTools: card.allowedTools ?? ['filesystem', 'mock', 'openhands', 'node_test'],
    timeoutMs: card.timeoutMs ?? 300_000,
    retryPolicy: {
      maxIdenticalRetries: 2,
      maxTotalAttempts: 4,
    },
    validationSteps,
    mode: card.mode ?? 'acceptance',
    sourcePaths: [],
    writeAllowlist:
      card.writeAllowlist ?? defaultWriteAllowlist(card.environment.target),
    requiredEvidence: [...DEFAULT_EVIDENCE],
    stages,
    circuitBreakRules: [
      'Do not access production, private client credentials, or unrestricted minipc/SSH',
      'Do not treat agent claimedSuccess as PASS',
      'Do not invent missing auth secrets; stop with AUTH_REQUIRED / BLOCK',
      `Stay within environment target: ${card.environment.target}`,
    ],
    cleanupWorkspace: true,
  };
}

interface BaseUrls {
  readonly storefront: string;
  readonly shopApi: string;
  readonly adminApi: string;
  readonly health: string;
}

function resolveBaseUrls(card: BusinessTaskCard): BaseUrls {
  const root =
    card.environment.baseUrl ??
    (card.environment.target === 'isolated-vendure'
      ? 'http://127.0.0.1:0'
      : 'http://127.0.0.1:0');
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

interface ExpandedAcceptance {
  readonly steps: ValidationStep[];
  readonly actions: string[];
}

function expandAcceptanceBullet(bullet: string, base: BaseUrls): ExpandedAcceptance {
  const id = slug(bullet);
  const normalized = bullet.toLowerCase();

  if (/(storefront|shop|homepage|home page).*(load|open|available)/.test(normalized) || normalized === 'storefront loads') {
    return {
      actions: ['Probe storefront HTTP health and browser entry'],
      steps: [
        {
          id: `${id}-health`,
          type: 'application_health',
          url: base.health,
          expectStatus: 200,
          timeoutMs: 10_000,
        },
        {
          id: `${id}-browser`,
          type: 'browser_playwright',
          url: base.storefront,
          expectSelector: 'body',
          screenshotName: `${id}.png`,
          timeoutMs: 15_000,
        },
      ],
    };
  }

  if (/product.*visible|visible.*product|product (is )?listed|catalog/.test(normalized)) {
    return {
      actions: ['Assert product listing via Shop API and storefront text'],
      steps: [
        {
          id: `${id}-api`,
          type: 'http_response',
          url: `${base.shopApi.replace(/\/$/, '')}/products`,
          method: 'GET',
          headers: {},
          expectStatus: 200,
          timeoutMs: 10_000,
        },
        {
          id: `${id}-browser`,
          type: 'browser_playwright',
          url: base.storefront,
          expectSelector: '[data-testid="product"], .product, #product-list, main',
          screenshotName: `${id}.png`,
          timeoutMs: 15_000,
        },
      ],
    };
  }

  if (/add(ed)? to cart|cart/.test(normalized) && /add|can/.test(normalized)) {
    return {
      actions: ['Verify cart mutation via Shop API GraphQL'],
      steps: [
        {
          id: `${id}-graphql`,
          type: 'graphql_request',
          url: base.shopApi,
          query:
            'mutation { addItemToOrder(productVariantId: "1", quantity: 1) { ... on Order { id totalQuantity } ... on ErrorResult { errorCode message } } }',
          variables: {},
          headers: {},
          expectNoErrors: false,
          expectDataPath: 'addItemToOrder',
          timeoutMs: 15_000,
        },
      ],
    };
  }

  if (/checkout/.test(normalized)) {
    return {
      actions: ['Verify checkout entry via browser route'],
      steps: [
        {
          id: `${id}-browser`,
          type: 'browser_playwright',
          url: `${base.storefront.replace(/\/$/, '')}/checkout`,
          expectSelector: 'form, [data-testid="checkout"], #checkout, main',
          screenshotName: `${id}.png`,
          timeoutMs: 15_000,
        },
      ],
    };
  }

  if (/order is created|creates? an? order|place(d)? order/.test(normalized)) {
    return {
      actions: ['Assert order exists via Shop/Admin GraphQL'],
      steps: [
        {
          id: `${id}-graphql`,
          type: 'graphql_request',
          url: base.shopApi,
          query: '{ activeOrder { id code state totalWithTax } }',
          variables: {},
          headers: {},
          expectNoErrors: true,
          expectDataPath: 'activeOrder',
          timeoutMs: 15_000,
        },
      ],
    };
  }

  if (/backend.*(order|contains)|order.*(backend|database|db|admin)/.test(normalized)) {
    return {
      actions: ['Assert backend/admin can read the order'],
      steps: [
        {
          id: `${id}-admin`,
          type: 'graphql_request',
          url: base.adminApi,
          query: '{ orders(options: { take: 1 }) { totalItems items { id code } } }',
          variables: {},
          headers: {},
          expectNoErrors: true,
          expectDataPath: 'orders.totalItems',
          timeoutMs: 15_000,
        },
        {
          id: `${id}-db`,
          type: 'database_state',
          driver: 'json_fixture',
          fixturePath: 'data/order-state.json',
          query: 'count',
          expectRowCount: 1,
        },
      ],
    };
  }

  // Generic fallback: require evidence note file proving the bullet was checked.
  return {
    actions: [`Record evidence that business acceptance holds: ${bullet}`],
    steps: [
      {
        id: `${id}-evidence-note`,
        type: 'workspace_file_contains',
        path: `evidence/acceptance/${id}.txt`,
        contains: bullet,
      },
    ],
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'step';
}

function humanizeId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function summarizeGoal(goal: string): string {
  const oneLine = goal.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}
