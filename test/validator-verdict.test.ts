import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { PipelineConfig } from '../src/config/load-config.js';
import { createLogger } from '../src/logging/logger.js';
import { createExecutionContext } from '../src/safety/execution-context.js';
import { createFakeBrowserLauncher } from '../src/validator/browser-launcher.js';
import { IndependentValidator } from '../src/validator/independent-validator.js';
import {
  buildValidatorVerdict,
  type ValidatorVerdict,
} from '../src/validator/verdict.js';
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
  handler: (reqUrl: string, body: string) => { status: number; body: string },
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const result = handler(req.url ?? '/', body);
      res.writeHead(result.status, { 'content-type': 'application/json' });
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

test('buildValidatorVerdict maps checks to client {name,status} shape', () => {
  const verdict = buildValidatorVerdict({
    status: 'PASS',
    agentClaimedSuccess: true,
    checks: [
      {
        checkName: 'storefront-loads',
        status: 'PASS',
        expected: 'title contains Shop',
        actual: 'title=Shop',
        timestamp: '2026-01-01T00:00:00.000Z',
        output: 'ok',
        evidencePath: '/tmp/a.json',
      },
      {
        checkName: 'product-visible',
        status: 'PASS',
        expected: 'products present',
        actual: 'items=1',
        timestamp: '2026-01-01T00:00:00.000Z',
        output: 'ok',
        evidencePath: '/tmp/b.json',
      },
      {
        checkName: 'order-created',
        status: 'PASS',
        expected: 'order id',
        actual: 'orderId=42',
        timestamp: '2026-01-01T00:00:00.000Z',
        output: 'ok',
        evidencePath: '/tmp/c.json',
      },
      {
        checkName: 'database-order-exists',
        status: 'PASS',
        expected: 'row count 1',
        actual: 'count=1',
        timestamp: '2026-01-01T00:00:00.000Z',
        output: 'ok',
        evidencePath: '/tmp/d.json',
      },
    ],
  });

  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.agentClaimIgnored, true);
  assert.deepEqual(
    verdict.checks.map((c) => ({ name: c.name, status: c.status })),
    [
      { name: 'storefront loads', status: 'PASS' },
      { name: 'product visible', status: 'PASS' },
      { name: 'order created', status: 'PASS' },
      { name: 'database order exists', status: 'PASS' },
    ],
  );
});

test('one failed check forces overall BLOCK in verdict', () => {
  const verdict = buildValidatorVerdict({
    status: 'BLOCK',
    agentClaimedSuccess: true,
    checks: [
      {
        checkName: 'storefront-loads',
        status: 'PASS',
        expected: 'ok',
        actual: 'ok',
        timestamp: '2026-01-01T00:00:00.000Z',
        output: 'ok',
        evidencePath: '/tmp/a.json',
      },
      {
        checkName: 'order-created',
        status: 'FAIL',
        expected: 'order id',
        actual: 'missing',
        timestamp: '2026-01-01T00:00:00.000Z',
        output: 'missing',
        evidencePath: '/tmp/c.json',
      },
    ],
  });

  assert.equal(verdict.status, 'BLOCK');
  assert.equal(verdict.checks[1]?.status, 'BLOCK');
  assert.equal(verdict.agentClaimIgnored, true);
});

test('agent SUCCESS → Playwright/GraphQL/Postgres → client verdict PASS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'verdict-pass-'));
  try {
    await withServer(
      (url, body) => {
        if (url === '/') {
          return { status: 200, body: '{"ok":true}' };
        }
        if (url === '/shop-api') {
          const parsed = JSON.parse(body) as { query: string };
          if (parsed.query.includes('products')) {
            return {
              status: 200,
              body: JSON.stringify({ data: { products: { items: [{ name: 'Nail Kit' }] } } }),
            };
          }
          if (parsed.query.includes('addItemToOrder') || parsed.query.includes('order')) {
            return {
              status: 200,
              body: JSON.stringify({ data: { addItemToOrder: { id: '42', code: 'ORD-42' } } }),
            };
          }
        }
        return { status: 404, body: '{}' };
      },
      async (baseUrl) => {
        const workspace = join(root, 'workspace', 'checkout-pass');
        mkdirSync(join(workspace, 'data'), { recursive: true });
        writeFileSync(
          join(workspace, 'data', 'orders.json'),
          JSON.stringify({ orders: [{ id: '42' }], count: 1 }),
          'utf8',
        );

        const task = minimalTask({
          id: 'checkout-verdict-pass',
          writeAllowlist: ['src', 'data'],
          validationSteps: [
            {
              id: 'storefront-loads',
              type: 'browser_playwright',
              url: `${baseUrl}/`,
              expectTitleContains: 'Shop',
              expectSelector: 'h1',
              expectTextContains: 'Welcome',
              screenshotName: 'storefront.png',
              timeoutMs: 5_000,
            },
            {
              id: 'product-visible',
              type: 'graphql_request',
              url: `${baseUrl}/shop-api`,
              query: '{ products { items { name } } }',
              variables: {},
              headers: {},
              expectNoErrors: true,
              expectDataPath: 'products.items',
              timeoutMs: 5_000,
            },
            {
              id: 'order-created',
              type: 'graphql_request',
              url: `${baseUrl}/shop-api`,
              query: 'mutation { addItemToOrder(productVariantId: "1", quantity: 1) { id code } }',
              variables: {},
              headers: {},
              expectNoErrors: true,
              expectDataPath: 'addItemToOrder.id',
              expectDataEquals: '42',
              timeoutMs: 5_000,
            },
            {
              id: 'database-order-exists',
              type: 'database_state',
              driver: 'json_fixture',
              fixturePath: 'data/orders.json',
              query: 'count',
              expectEquals: 1,
            },
          ],
        });

        const context = createExecutionContext({
          config: configFor(root, { runId: 'checkout-pass', allowNetwork: true }),
          task,
          logger: createLogger({ level: 'error' }),
        });
        mkdirSync(context.artifactDir, { recursive: true });

        const validator = new IndependentValidator({
          allowNetwork: true,
          launchBrowser: createFakeBrowserLauncher({
            title: 'Shop',
            textBySelector: { h1: 'Welcome' },
          }),
        });

        // Agent claims SUCCESS — ignored for authority.
        const decision = await validator.validate({
          context,
          mode: 'acceptance',
          agentClaimedSuccess: true,
          requiredEvidence: task.requiredEvidence,
          presentEvidence: task.requiredEvidence,
          testExitCode: null,
          changedFiles: [],
        });

        assert.equal(decision.status, 'PASS');
        assert.ok(decision.verdict);
        assert.equal(decision.verdict.status, 'PASS');
        assert.equal(decision.verdict.agentClaimIgnored, true);
        assert.deepEqual(
          decision.verdict.checks.map((c) => ({ name: c.name, status: c.status })),
          [
            { name: 'storefront loads', status: 'PASS' },
            { name: 'product visible', status: 'PASS' },
            { name: 'order created', status: 'PASS' },
            { name: 'database order exists', status: 'PASS' },
          ],
        );

        const onDisk = JSON.parse(
          readFileSync(join(context.artifactDir, 'validator-verdict.json'), 'utf8'),
        ) as ValidatorVerdict;
        assert.equal(onDisk.status, 'PASS');
        assert.ok(existsSync(join(context.artifactDir, 'validator-verdict.json')));
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent SUCCESS with failing order check → BLOCK (not agent self-report)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'verdict-block-'));
  try {
    await withServer(
      (url, body) => {
        if (url === '/') {
          return { status: 200, body: '{}' };
        }
        if (url === '/shop-api') {
          const parsed = JSON.parse(body) as { query: string };
          if (parsed.query.includes('products')) {
            return {
              status: 200,
              body: JSON.stringify({ data: { products: { items: [{ name: 'Nail Kit' }] } } }),
            };
          }
          return {
            status: 200,
            body: JSON.stringify({ errors: [{ message: 'checkout broken' }] }),
          };
        }
        return { status: 404, body: '{}' };
      },
      async (baseUrl) => {
        const workspace = join(root, 'workspace', 'checkout-block');
        mkdirSync(join(workspace, 'data'), { recursive: true });
        writeFileSync(
          join(workspace, 'data', 'orders.json'),
          JSON.stringify({ count: 0 }),
          'utf8',
        );

        const task = minimalTask({
          id: 'checkout-verdict-block',
          writeAllowlist: ['src', 'data'],
          validationSteps: [
            {
              id: 'storefront-loads',
              type: 'browser_playwright',
              url: `${baseUrl}/`,
              expectTitleContains: 'Shop',
              screenshotName: 'storefront.png',
              timeoutMs: 5_000,
            },
            {
              id: 'product-visible',
              type: 'graphql_request',
              url: `${baseUrl}/shop-api`,
              query: '{ products { items { name } } }',
              variables: {},
              headers: {},
              expectNoErrors: true,
              expectDataPath: 'products.items',
              timeoutMs: 5_000,
            },
            {
              id: 'order-created',
              type: 'graphql_request',
              url: `${baseUrl}/shop-api`,
              query: 'mutation { addItemToOrder(productVariantId: "1", quantity: 1) { id } }',
              variables: {},
              headers: {},
              expectNoErrors: true,
              expectDataPath: 'addItemToOrder.id',
              timeoutMs: 5_000,
            },
            {
              id: 'database-order-exists',
              type: 'database_state',
              driver: 'json_fixture',
              fixturePath: 'data/orders.json',
              query: 'count',
              expectEquals: 1,
            },
          ],
        });

        const context = createExecutionContext({
          config: configFor(root, { runId: 'checkout-block', allowNetwork: true }),
          task,
          logger: createLogger({ level: 'error' }),
        });
        mkdirSync(context.artifactDir, { recursive: true });

        const validator = new IndependentValidator({
          allowNetwork: true,
          launchBrowser: createFakeBrowserLauncher({ title: 'Shop' }),
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
        assert.equal(decision.verdict?.agentClaimIgnored, true);
        assert.ok(
          decision.verdict?.checks.some(
            (c) => c.name === 'order created' && c.status === 'BLOCK',
          ),
        );

        const onDisk = JSON.parse(
          readFileSync(join(context.artifactDir, 'validator-verdict.json'), 'utf8'),
        ) as ValidatorVerdict;
        assert.equal(onDisk.status, 'BLOCK');
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
