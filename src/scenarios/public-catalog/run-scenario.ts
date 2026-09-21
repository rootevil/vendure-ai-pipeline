import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { PipelineConfig } from '../../config/load-config.js';
import { TaskRunner } from '../../execution/task-runner.js';
import { createLogger } from '../../logging/logger.js';
import type { RunResult, TaskDefinition } from '../../models/types.js';
import { createFakeBrowserLauncher } from '../../validator/browser-launcher.js';
import { startPublicCatalogDemoServer, type DemoServerHandle } from './demo-server.js';
import {
  materializeEvaluationDemo,
  PublicCatalogScenarioAgent,
  runAcceptanceTests,
} from './scenario-agent.js';

export interface PublicCatalogScenarioOptions {
  readonly rootDir?: string;
  readonly runId?: string;
  readonly keepWorkspace?: boolean;
  readonly useRealBrowser?: boolean;
}

export interface PublicCatalogScenarioResult {
  readonly result: RunResult;
  readonly baseUrl: string;
  readonly task: TaskDefinition;
}

/**
 * End-to-end public Vendure evaluation scenario (not the full client migration).
 * Flow: task → Agent → adapter change → app startup → API/GraphQL/browser/DB → evidence → PASS/BLOCK
 */
export async function runPublicCatalogScenario(
  options: PublicCatalogScenarioOptions = {},
): Promise<PublicCatalogScenarioResult> {
  const root = options.rootDir ?? mkdtempSync(join(tmpdir(), 'vendure-catalog-scenario-'));
  const runId = options.runId ?? `catalog-${Date.now()}`;
  const workspaceDir = join(root, 'workspace');
  const artifactsDir = join(root, 'artifacts');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  materializeEvaluationDemo(join(workspaceDir, runId));
  const appDir = join(workspaceDir, runId, 'evaluation-demo', 'app');

  let server: DemoServerHandle | null = null;
  try {
    server = await startPublicCatalogDemoServer({ appDir });
    const task = buildScenarioTask(server.baseUrl, options.keepWorkspace === true);
    const taskPath = join(root, 'task.json');
    writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');

    const useRealBrowser =
      options.useRealBrowser === true || process.env.PIPELINE_USE_REAL_BROWSER === '1';
    const agentMode =
      process.env.PIPELINE_AGENT_MODE === 'openhands' ? 'openhands' : 'mock';

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
      agentMode,
      agentTimeoutMs: task.timeoutMs,
      openhandsCommand: 'openhands',
      mockAgentBehavior: 'success',
    };

    const runner = new TaskRunner({
      config,
      logger: createLogger({ level: 'info' }),
      // Default: purpose-built scenario agent applying the published reference adapter.
      // Set PIPELINE_AGENT_MODE=openhands to exercise the OpenHands adapter instead.
      ...(agentMode === 'openhands'
        ? {}
        : { agent: new PublicCatalogScenarioAgent() }),
      runTests: async () => runAcceptanceTests(appDir),
      ...(useRealBrowser
        ? {}
        : {
            launchBrowser: createFakeBrowserLauncher({
              title: 'Public Catalog Demo',
              textBySelector: {
                h1: 'Products',
                '#product-list': 'Soft Pink Almond, Rose Gold French',
              },
            }),
          }),
    });

    const result = await runner.execute(task);
    return { result, baseUrl: server.baseUrl, task };
  } finally {
    if (server) {
      await server.close().catch(() => undefined);
    }
  }
}

export function buildScenarioTask(baseUrl: string, keepWorkspace = false): TaskDefinition {
  return {
    id: 'vendure-public-catalog-e2e',
    title: 'Public Vendure catalog evaluation scenario',
    goal:
      'Using only the isolated public evaluation-demo, complete the catalog migration adapter, ' +
      'start the demo shop surface, and prove the public catalog contract via health, HTTP, ' +
      'GraphQL, browser, and state checks with reviewable evidence.',
    acceptanceCriteria: [
      'Active legacy records are migrated; inactive records are excluded',
      'internalNote is never exposed',
      'Demo /health returns 200',
      'REST /api/products returns migrated items',
      'GraphQL products.totalItems equals 2',
      'Browser page lists migrated product names',
      'public-catalog-state.json count equals 2',
    ],
    allowedTools: ['filesystem', 'mock', 'node_test'],
    timeoutMs: 180_000,
    retryPolicy: {
      maxIdenticalRetries: 2,
      maxTotalAttempts: 3,
    },
    validationSteps: [
      { id: 'evidence', type: 'evidence_present' },
      {
        id: 'adapter-changed',
        type: 'changed_files_include',
        path: 'evaluation-demo/app/src/catalog.mjs',
      },
      {
        id: 'health',
        type: 'application_health',
        url: `${baseUrl}/health`,
        expectStatus: 200,
        timeoutMs: 5_000,
      },
      {
        id: 'api-products',
        type: 'http_response',
        url: `${baseUrl}/api/products`,
        method: 'GET',
        headers: {},
        expectStatus: 200,
        expectBodyContains: 'NAIL-001',
        timeoutMs: 5_000,
      },
      {
        id: 'graphql-products',
        type: 'graphql_request',
        url: `${baseUrl}/graphql`,
        query: '{ products { totalItems items { sku name } } }',
        variables: {},
        headers: {},
        expectNoErrors: true,
        expectDataPath: 'products.totalItems',
        expectDataEquals: 2,
        timeoutMs: 5_000,
      },
      {
        id: 'browser-catalog',
        type: 'browser_playwright',
        url: `${baseUrl}/`,
        expectTitleContains: 'Catalog',
        expectSelector: '#product-list',
        expectTextContains: 'Soft Pink Almond',
        screenshotName: 'public-catalog.png',
        timeoutMs: 10_000,
      },
      {
        id: 'db-state',
        type: 'database_state',
        driver: 'json_fixture',
        fixturePath: 'evaluation-demo/app/data/public-catalog-state.json',
        query: 'count',
        expectEquals: 2,
      },
    ],
    mode: 'acceptance',
    sourcePaths: [
      'evaluation-demo/app/fixtures/legacy-catalog.json',
      'evaluation-demo/app/tests/acceptance.test.mjs',
      'evaluation-demo/task.md',
    ],
    writeAllowlist: ['evaluation-demo/app/src', 'evaluation-demo/app/data'],
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
        id: 'seed-incomplete',
        description: 'Start from incomplete catalog.mjs in an isolated evaluation-demo copy',
        preconditions: ['evaluation-demo materialized', 'network limited to local demo server'],
        actions: ['Seed incomplete adapter'],
        expectedChecks: ['Baseline adapter returns empty catalog'],
        cleanup: [],
      },
      {
        id: 'agent-fix',
        description: 'Agent applies the published reference catalog adapter',
        preconditions: ['Write allowlist limited to evaluation-demo/app'],
        actions: ['Write catalog.mjs', 'Write public-catalog-state.json'],
        expectedChecks: ['Acceptance tests exit 0'],
        cleanup: [],
      },
      {
        id: 'validate',
        description: 'Independent validator checks health/API/GraphQL/browser/state/evidence',
        preconditions: ['Demo server running on localhost'],
        actions: ['Run independent checks', 'Write evidence pack'],
        expectedChecks: ['PASS only when all independent checks succeed'],
        cleanup: ['Stop demo server', 'Optionally remove disposable workspace'],
      },
    ],
    circuitBreakRules: [
      'Do not access private client repos, minipc, or production',
      'Do not bypass independent validation to obtain PASS',
      'Use only the isolated evaluation-demo materials',
    ],
    cleanupWorkspace: !keepWorkspace,
  };
}

export function resolveScenarioRoot(explicit?: string): string {
  return explicit ? resolve(explicit) : mkdtempSync(join(tmpdir(), 'vendure-catalog-scenario-'));
}
