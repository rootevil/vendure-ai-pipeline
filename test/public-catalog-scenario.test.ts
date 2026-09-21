import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NoopAgentAdapter } from '../src/agent/agent-adapter.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { TaskRunner } from '../src/execution/task-runner.js';
import { createLogger } from '../src/logging/logger.js';
import {
  buildScenarioTask,
  runPublicCatalogScenario,
} from '../src/scenarios/public-catalog/run-scenario.js';
import { startPublicCatalogDemoServer } from '../src/scenarios/public-catalog/demo-server.js';
import {
  materializeEvaluationDemo,
  runAcceptanceTests,
} from '../src/scenarios/public-catalog/scenario-agent.js';
import { createFakeBrowserLauncher } from '../src/validator/browser-launcher.js';

test('public catalog scenario PASSes with health/API/GraphQL/browser/state evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scenario-pass-'));
  try {
    const { result, baseUrl } = await runPublicCatalogScenario({
      rootDir: root,
      runId: 'scenario-pass',
      keepWorkspace: true,
    });

    assert.equal(result.status, 'PASS');
    assert.equal(result.exitCode, 0);
    assert.ok(baseUrl.startsWith('http://127.0.0.1:'));
    assert.ok(result.evidenceManifest);
    assert.ok(existsSync(join(result.artifactDir, 'result.json')));
    assert.ok(existsSync(join(result.artifactDir, 'summary.html')));
    assert.ok(existsSync(join(result.artifactDir, 'validation.json')));
    assert.ok(existsSync(join(result.artifactDir, 'evidence-manifest.json')));

    const checks = result.validationChecks.map((check) => check.checkName);
    for (const name of [
      'health',
      'api-products',
      'graphql-products',
      'browser-catalog',
      'db-state',
      'adapter-changed',
    ]) {
      assert.ok(checks.includes(name), `missing check ${name}`);
    }
    assert.ok(result.validationChecks.every((check) => check.status === 'PASS'));

    const resultJson = JSON.parse(
      readFileSync(join(result.artifactDir, 'result.json'), 'utf8'),
    ) as {
      status: string;
      agentClaimedSuccessIgnored: boolean;
    };
    assert.equal(resultJson.status, 'PASS');
    assert.equal(resultJson.agentClaimedSuccessIgnored, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public catalog scenario BLOCKs when agent does not fix the adapter', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scenario-block-'));
  const runId = 'scenario-block';
  const workspaceDir = join(root, 'workspace');
  const artifactsDir = join(root, 'artifacts');
  try {
    materializeEvaluationDemo(join(workspaceDir, runId));
    const appDir = join(workspaceDir, runId, 'evaluation-demo', 'app');
    const server = await startPublicCatalogDemoServer({ appDir });
    try {
      const task = buildScenarioTask(server.baseUrl, true);
      const config: PipelineConfig = {
        mode: 'acceptance',
        artifactsDir,
        workspaceDir,
        maxIdenticalRetries: 2,
        maxTotalAttempts: 3,
        allowNetwork: true,
        logLevel: 'error',
        runId,
        writeAllowlist: [...task.writeAllowlist],
        agentMode: 'noop',
        agentTimeoutMs: 60_000,
        openhandsCommand: 'openhands',
        mockAgentBehavior: 'success',
      };

      const runner = new TaskRunner({
        config,
        logger: createLogger({ level: 'error' }),
        agent: new NoopAgentAdapter(),
        runTests: async () => runAcceptanceTests(appDir),
        launchBrowser: createFakeBrowserLauncher({
          title: 'Public Catalog Demo',
          textBySelector: { '#product-list': 'No products' },
        }),
      });

      const result = await runner.execute(task);
      assert.equal(result.status, 'BLOCK');
      assert.ok(
        result.validationChecks.some(
          (check) =>
            (check.checkName === 'api-products' ||
              check.checkName === 'graphql-products' ||
              check.checkName === 'adapter-changed' ||
              check.checkName === 'db-state' ||
              check.checkName === 'acceptance-tests') &&
            check.status !== 'PASS',
        ),
      );
      assert.ok(existsSync(join(result.artifactDir, 'result.json')));
      assert.ok(existsSync(join(result.artifactDir, 'summary.html')));
    } finally {
      await server.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
