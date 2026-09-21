import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeReadOnlySql,
  ORDER_BY_CODE_QUERY,
  resolveControlledQuery,
} from '../src/validator/controlled-sql.js';
import { defaultDatabaseExecutor } from '../src/validator/database-executor.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('order_by_code controlled query is the client SELECT example', () => {
  const q = resolveControlledQuery('order_by_code');
  assert.equal(q.sql, 'SELECT id, state FROM "order" WHERE code = $1');
  assert.equal(q.id, ORDER_BY_CODE_QUERY.id);
  assertSafeReadOnlySql(q.sql);
});

test('assertSafeReadOnlySql rejects destructive SQL', () => {
  assert.throws(() => assertSafeReadOnlySql('DELETE FROM "order" WHERE code = $1'), /read-only|non-read-only/i);
  assert.throws(() => assertSafeReadOnlySql('DROP TABLE "order"'), /read-only|non-read-only/i);
  assert.throws(() => assertSafeReadOnlySql('UPDATE "order" SET state = $1'), /read-only|non-read-only/i);
  assert.throws(() => assertSafeReadOnlySql('SELECT 1; DELETE FROM "order"'), /stacked/i);
});

test('postgres driver refuses free-form SQL without controlledQueryId', async () => {
  await assert.rejects(
    () =>
      defaultDatabaseExecutor({
        driver: 'postgres',
        connectionString: 'postgres://127.0.0.1:5432/demo',
        query: 'SELECT id FROM "order"',
        workspaceDir: '/tmp',
      }),
    /controlledQueryId/,
  );
});

test('controlled order_by_code json_fixture compares expected vs actual', async () => {
  const root = mkdtempSync(join(tmpdir(), 'db-controlled-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(
      join(root, 'data', 'order-table.json'),
      JSON.stringify({
        rows: [
          { id: '42', code: 'ORD-DEMO-1', state: 'PaymentSettled' },
          { id: '99', code: 'OTHER', state: 'AddingItems' },
        ],
      }),
      'utf8',
    );

    const result = await defaultDatabaseExecutor({
      driver: 'json_fixture',
      fixturePath: 'data/order-table.json',
      controlledQueryId: 'order_by_code',
      params: ['ORD-DEMO-1'],
      query: '',
      workspaceDir: root,
    });

    assert.equal(result.rowCount, 1);
    assert.deepEqual(result.rows, [{ id: '42', state: 'PaymentSettled' }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
