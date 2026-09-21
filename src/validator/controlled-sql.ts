/**
 * Validator-owned SQL only. Agents never receive free-form DB execution.
 * Postgres `database_state` steps must use a controlledQueryId from this catalog.
 */

export interface ControlledValidatorQuery {
  readonly id: string;
  readonly description: string;
  /** Parameterized read-only SQL (pg $1-style placeholders). */
  readonly sql: string;
  readonly paramCount: number;
  /**
   * For json_fixture demos: project fixture rows to the same shape as the SQL result.
   * Fixture file must be `{ "rows": [ { id, code, state, ... } ] }` or a bare array.
   */
  readonly projectFixtureRow: (row: Record<string, unknown>) => Record<string, unknown>;
  readonly matchParam?: (row: Record<string, unknown>, params: readonly unknown[]) => boolean;
}

/** Client example: SELECT id, state FROM "order" WHERE code = $1 */
export const ORDER_BY_CODE_QUERY: ControlledValidatorQuery = {
  id: 'order_by_code',
  description: 'Fetch order id and state by code',
  sql: 'SELECT id, state FROM "order" WHERE code = $1',
  paramCount: 1,
  projectFixtureRow: (row) => ({
    id: row.id,
    state: row.state,
  }),
  matchParam: (row, params) => String(row.code) === String(params[0]),
};

const CATALOG: Readonly<Record<string, ControlledValidatorQuery>> = {
  [ORDER_BY_CODE_QUERY.id]: ORDER_BY_CODE_QUERY,
};

export function listControlledValidatorQueries(): readonly ControlledValidatorQuery[] {
  return Object.values(CATALOG);
}

export function resolveControlledQuery(id: string): ControlledValidatorQuery {
  const found = CATALOG[id];
  if (!found) {
    throw new Error(
      `Unknown controlledQueryId ${JSON.stringify(id)}; allowed: ${Object.keys(CATALOG).join(', ')}`,
    );
  }
  return found;
}

/**
 * Fail closed: only single-statement SELECT / WITH…SELECT.
 * Rejects INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/COPY/EXEC and stacked statements.
 */
export function assertSafeReadOnlySql(sql: string): void {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    throw new Error('SQL query must not be blank');
  }
  if (trimmed.includes(';') && !trimmed.endsWith(';')) {
    throw new Error('Refusing stacked SQL statements');
  }
  const withoutTrailingSemi = trimmed.endsWith(';') ? trimmed.slice(0, -1).trim() : trimmed;
  if (withoutTrailingSemi.includes(';')) {
    throw new Error('Refusing stacked SQL statements');
  }

  const destructive =
    /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|MERGE|GRANT|REVOKE|COPY|CALL|EXECUTE|EXEC|INTO\s+OUTFILE|LOAD\s+DATA|VACUUM|REINDEX|CLUSTER|COMMENT\s+ON)\b/i;
  if (destructive.test(withoutTrailingSemi)) {
    throw new Error(`Refusing non-read-only SQL: ${withoutTrailingSemi.slice(0, 120)}`);
  }

  if (!/^\s*(WITH\b[\s\S]+)?SELECT\b/i.test(withoutTrailingSemi)) {
    throw new Error('Validator SQL must be a SELECT (or WITH … SELECT) statement');
  }
}

export function assertControlledQueryParams(
  query: ControlledValidatorQuery,
  params: readonly unknown[],
): void {
  if (params.length !== query.paramCount) {
    throw new Error(
      `controlledQueryId ${query.id} expects ${query.paramCount} param(s), got ${params.length}`,
    );
  }
}
