import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAgentAdapter } from '../src/agent/mock-adapter.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { TaskRunner } from '../src/execution/task-runner.js';
import { createLogger } from '../src/logging/logger.js';
import { createFakeBrowserLauncher } from '../src/validator/browser-launcher.js';
import { IndependentValidator } from '../src/validator/independent-validator.js';
import { createExecutionContext } from '../src/safety/execution-context.js';
import { minimalTask } from './helpers/minimal-task.js';

function configFor(root: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    mode: 'acceptance',
    artifactsDir: join(root, 'artifacts'),
    workspaceDir: join(root, 'workspace'),
    maxIdenticalRetries: 3,
    maxTotalAttempts: 5,
    allowNetwork: true,
    logLevel: 'error',
    writeAllowlist: ['src', 'data'],
    agentMode: 'mock',
    agentTimeoutMs: 60_000,
    openhandsCommand: 'openhands',
    mockAgentBehavior: 'success',
    ...overrides,
  };
}

async function withServer(
  handler: (reqUrl: string, body: string) => { status: number; body: string; contentType?: string },
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const result = handler(req.url ?? '/', body);
      res.writeHead(result.status, {
        'content-type': result.contentType ?? 'application/json',
      });
      res.end(result.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind test server');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('independent validator PASSes health/http/graphql/db/browser checks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ind-pass-'));
  try {
    await withServer(
      (url, body) => {
        if (url === '/health') {
          return { status: 200, body: '{"ok":true}' };
        }
        if (url === '/api/products') {
          return { status: 200, body: '{"items":[{"id":1}]}' };
        }
        if (url === '/graphql') {
          const parsed = JSON.parse(body) as { query: string };
          assert.ok(parsed.query.includes('products'));
          return {
            status: 200,
            body: JSON.stringify({ data: { products: { totalItems: 2 } } }),
          };
        }
        return { status: 404, body: '{"error":"missing"}' };
      },
      async (baseUrl) => {
        const workspace = join(root, 'workspace', 'run-pass');
        mkdirSync(join(workspace, 'data'), { recursive: true });
        writeFileSync(
          join(workspace, 'data', 'catalog.json'),
          JSON.stringify({ products: [{ id: 1, active: true }], count: 1 }),
          'utf8',
        );

        const task = minimalTask({
          id: 'independent-pass',
          writeAllowlist: ['src', 'data'],
          validationSteps: [
            { id: 'evidence', type: 'evidence_present' },
            {
              id: 'health',
              type: 'application_health',
              url: `${baseUrl}/health`,
              expectStatus: 200,
              timeoutMs: 5_000,
            },
            {
              id: 'api',
              type: 'http_response',
              url: `${baseUrl}/api/products`,
              method: 'GET',
              headers: {},
              expectStatus: 200,
              expectBodyContains: '"items"',
              timeoutMs: 5_000,
            },
            {
              id: 'gql',
              type: 'graphql_request',
              url: `${baseUrl}/graphql`,
              query: '{ products { totalItems } }',
              variables: {},
              headers: {},
              expectNoErrors: true,
              expectDataPath: 'products.totalItems',
              expectDataEquals: 2,
              timeoutMs: 5_000,
            },
            {
              id: 'db',
              type: 'database_state',
              driver: 'json_fixture',
              fixturePath: 'data/catalog.json',
              query: 'count',
              expectEquals: 1,
            },
            {
              id: 'browser',
              type: 'browser_playwright',
              url: `${baseUrl}/health`,
              expectTitleContains: 'Healthy',
              expectSelector: 'h1',
              expectTextContains: 'OK',
              screenshotName: 'health.png',
              timeoutMs: 5_000,
            },
          ],
        });

        const config = configFor(root, { runId: 'run-pass', allowNetwork: true });
        const context = createExecutionContext({
          config,
          task,
          logger: createLogger({ level: 'error' }),
        });
        mkdirSync(context.artifactDir, { recursive: true });

        const validator = new IndependentValidator({
          allowNetwork: true,
          launchBrowser: createFakeBrowserLauncher({
            title: 'Healthy App',
            textBySelector: { h1: 'Status OK' },
          }),
        });

        const decision = await validator.validate({
          context,
          mode: 'acceptance',
          agentClaimedSuccess: true,
          requiredEvidence: task.requiredEvidence,
          presentEvidence: task.requiredEvidence,
          testExitCode: 0,
          changedFiles: [],
        });

        assert.equal(decision.status, 'PASS');
        assert.equal(decision.exitCode, 0);
        assert.ok(decision.notes.some((note) => note.includes('ignored for PASS/BLOCK')));
        assert.ok(decision.checks && decision.checks.length >= 6);
        assert.ok(decision.checks.every((check) => check.status === 'PASS'));
        for (const check of decision.checks ?? []) {
          assert.ok(check.checkName);
          assert.ok(check.expected);
          assert.ok(check.actual);
          assert.ok(check.timestamp);
          assert.ok(check.evidencePath);
          assert.equal(typeof check.output, 'string');
        }
        assert.ok(existsSync(join(context.artifactDir, 'validation-results.json')));
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('independent validator BLOCKs when checks fail despite agent claimed success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ind-block-'));
  try {
    await withServer(
      () => ({ status: 503, body: '{"ok":false}' }),
      async (baseUrl) => {
        const task = minimalTask({
          id: 'independent-block',
          validationSteps: [
            { id: 'evidence', type: 'evidence_present' },
            {
              id: 'health',
              type: 'application_health',
              url: `${baseUrl}/health`,
              expectStatus: 200,
              timeoutMs: 5_000,
            },
          ],
        });
        const config = configFor(root, { runId: 'run-block', allowNetwork: true });
        const context = createExecutionContext({
          config,
          task,
          logger: createLogger({ level: 'error' }),
        });
        mkdirSync(context.artifactDir, { recursive: true });

        const validator = new IndependentValidator({ allowNetwork: true });
        const decision = await validator.validate({
          context,
          mode: 'acceptance',
          agentClaimedSuccess: true,
          requiredEvidence: task.requiredEvidence,
          presentEvidence: task.requiredEvidence,
          testExitCode: 0,
          changedFiles: [],
        });

        assert.equal(decision.status, 'BLOCK');
        assert.equal(decision.exitCode, 1);
        assert.ok(
          decision.checks?.some((check) => check.checkName === 'health' && check.status === 'FAIL'),
        );
        assert.ok(decision.notes.some((note) => note.includes('ignored for PASS/BLOCK')));
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pipeline result depends only on validator — failed GraphQL blocks run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ind-flow-'));
  try {
    await withServer(
      () => ({
        status: 200,
        body: JSON.stringify({ errors: [{ message: 'unauthorized' }] }),
      }),
      async (baseUrl) => {
        const task = minimalTask({
          id: 'gql-block-flow',
          cleanupWorkspace: false,
          validationSteps: [
            { id: 'evidence', type: 'evidence_present' },
            {
              id: 'gql',
              type: 'graphql_request',
              url: `${baseUrl}/graphql`,
              query: '{ me { id } }',
              variables: {},
              headers: {},
              expectNoErrors: true,
              timeoutMs: 5_000,
            },
          ],
        });

        const runner = new TaskRunner({
          config: configFor(root, { runId: 'gql-block', allowNetwork: true }),
          logger: createLogger({ level: 'error' }),
          agent: new MockAgentAdapter({ behavior: 'success' }),
          runTests: async () => 0,
        });

        const result = await runner.execute(task);
        assert.equal(result.status, 'BLOCK');
        assert.ok(
          result.validationChecks.some(
            (check) => check.checkName === 'gql' && check.status === 'FAIL',
          ),
        );
        assert.ok(result.validatorNotes.some((note) => note.includes('ignored for PASS/BLOCK')));
        const resultsFile = join(result.artifactDir, 'validation-results.json');
        assert.ok(existsSync(resultsFile));
        const parsed = JSON.parse(readFileSync(resultsFile, 'utf8')) as Array<{
          checkName: string;
          status: string;
        }>;
        assert.ok(parsed.some((item) => item.checkName === 'gql' && item.status === 'FAIL'));
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('database_state and browser checks fail closed with machine-readable evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ind-db-browser-'));
  try {
    const workspace = join(root, 'workspace', 'db-run');
    mkdirSync(join(workspace, 'data'), { recursive: true });
    writeFileSync(join(workspace, 'data', 'catalog.json'), JSON.stringify({ count: 0 }), 'utf8');

    const task = minimalTask({
      id: 'db-browser-fail',
      writeAllowlist: ['src', 'data'],
      validationSteps: [
        {
          id: 'db',
          type: 'database_state',
          driver: 'json_fixture',
          fixturePath: 'data/catalog.json',
          query: 'count',
          expectEquals: 5,
        },
        {
          id: 'browser',
          type: 'browser_playwright',
          url: 'http://127.0.0.1:9/',
          expectTitleContains: 'Shop',
          screenshotName: 'shop.png',
          timeoutMs: 1_000,
        },
      ],
    });

    const config = configFor(root, { runId: 'db-run', allowNetwork: true });
    const context = createExecutionContext({
      config,
      task,
      logger: createLogger({ level: 'error' }),
    });
    mkdirSync(context.artifactDir, { recursive: true });

    const validator = new IndependentValidator({
      allowNetwork: true,
      launchBrowser: createFakeBrowserLauncher({
        title: 'Wrong',
      }),
    });

    const decision = await validator.validate({
      context,
      mode: 'acceptance',
      agentClaimedSuccess: true,
      requiredEvidence: task.requiredEvidence,
      presentEvidence: task.requiredEvidence,
      testExitCode: 0,
      changedFiles: [],
    });

    assert.equal(decision.status, 'BLOCK');
    const db = decision.checks?.find((check) => check.checkName === 'db');
    const browser = decision.checks?.find((check) => check.checkName === 'browser');
    assert.equal(db?.status, 'FAIL');
    assert.equal(browser?.status, 'FAIL');
    assert.ok(db?.evidencePath && existsSync(db.evidencePath));
    assert.ok(browser?.evidencePath && existsSync(browser.evidencePath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
