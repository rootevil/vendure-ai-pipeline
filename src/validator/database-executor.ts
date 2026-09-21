import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import {
  isAllowedStackDependencyHost,
  looksLikeProductionTarget,
} from '../safety/redaction.js';
import {
  assertControlledQueryParams,
  assertSafeReadOnlySql,
  resolveControlledQuery,
} from './controlled-sql.js';
import type { DatabaseExecutor, DatabaseQueryResult } from './check-types.js';

/**
 * Default DB executor: json_fixture reads workspace JSON; postgres uses optional `pg`.
 * Postgres always goes through controlled read-only SQL (no free-form agent SQL).
 */
export const defaultDatabaseExecutor: DatabaseExecutor = async (input) => {
  const controlled =
    input.controlledQueryId !== undefined
      ? resolveControlledQuery(input.controlledQueryId)
      : null;
  const params = input.params ?? [];
  if (controlled) {
    assertControlledQueryParams(controlled, params);
  }

  if (input.driver === 'json_fixture') {
    if (!input.fixturePath) {
      throw new Error('database_state json_fixture requires fixturePath');
    }
    if (isAbsolute(input.fixturePath) || input.fixturePath.includes('..')) {
      throw new Error(`Unsafe fixturePath: ${input.fixturePath}`);
    }
    const absolute = join(input.workspaceDir, input.fixturePath);
    const raw = readFileSync(absolute, 'utf8');
    const data: unknown = JSON.parse(raw);

    if (controlled) {
      const rows = projectControlledFixture(data, controlled, params);
      return { rows, rowCount: rows.length, value: rows };
    }

    const path = input.query;
    if (!path) {
      throw new Error('database_state json_fixture requires query path or controlledQueryId');
    }
    const value = readJsonPath(data, path);
    const rows = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return { rows, rowCount: rows.length, value };
  }

  // postgres driver — controlled queries only.
  if (!controlled) {
    throw new Error(
      'database_state postgres requires controlledQueryId (validators use allowlisted SQL only)',
    );
  }
  assertSafeReadOnlySql(controlled.sql);

  const connectionString = input.connectionString;
  if (!connectionString) {
    throw new Error('database_state postgres requires connectionString');
  }
  if (looksLikeProductionTarget(connectionString)) {
    throw new Error('Refusing database connection string that looks like production');
  }
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname || '';
    if (host && !isAllowedStackDependencyHost(host)) {
      throw new Error(
        `Postgres host ${host} is not in PIPELINE_STACK_HOST_ALLOWLIST (Phase 1)`,
      );
    }
  } catch (error) {
    if (error instanceof Error && /PIPELINE_STACK_HOST_ALLOWLIST|production/i.test(error.message)) {
      throw error;
    }
  }

  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{
    default?: { Client: new (config: { connectionString: string }) => PgClient };
    Client?: new (config: { connectionString: string }) => PgClient;
  }>;

  let pg: {
    default?: { Client: new (config: { connectionString: string }) => PgClient };
    Client?: new (config: { connectionString: string }) => PgClient;
  };
  try {
    pg = await dynamicImport('pg');
  } catch {
    throw new Error('postgres driver requires the optional `pg` package to be installed');
  }
  const Client = pg.Client ?? pg.default?.Client;
  if (!Client) {
    throw new Error('Unable to load pg.Client');
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(controlled.sql, [...params]);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
      value: result.rows,
    };
  } finally {
    await client.end();
  }
};

function projectControlledFixture(
  data: unknown,
  controlled: ReturnType<typeof resolveControlledQuery>,
  params: readonly unknown[],
): unknown[] {
  const sourceRows = extractFixtureRows(data);
  const matched = sourceRows.filter((row) =>
    controlled.matchParam ? controlled.matchParam(row, params) : true,
  );
  return matched.map((row) => controlled.projectFixtureRow(row));
}

function extractFixtureRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }
  if (isRecord(data) && Array.isArray(data.rows)) {
    return data.rows.filter(isRecord);
  }
  if (isRecord(data) && Array.isArray(data.orders)) {
    return data.orders.filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface PgClient {
  connect(): Promise<void>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}

export function readJsonPath(data: unknown, path: string): unknown {
  if (path === '' || path === '$' || path === '.') {
    return data;
  }
  const normalized = path.replace(/^\$\.?/, '').replace(/^\./, '');
  if (normalized.length === 0) {
    return data;
  }
  const parts = normalized.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function valuesEqual(expected: unknown, actual: unknown): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export function valueContains(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack === 'string' && typeof needle === 'string') {
    return haystack.includes(needle);
  }
  return JSON.stringify(haystack).includes(JSON.stringify(needle));
}

export type { DatabaseQueryResult };
