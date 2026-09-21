import type { ValidationStep } from '../../models/types.js';
import { ORDER_BY_CODE_QUERY } from '../../validator/controlled-sql.js';
import { DEMO_ORDER_CODE } from './graphql-checks.js';

export const DEMO_ORDER_ID = '42';
export const DEMO_ORDER_STATE = 'PaymentSettled';
export const ORDER_FIXTURE_PATH = 'data/order-table.json';

/**
 * Controlled DB evidence after browser + GraphQL:
 *
 *   PostgreSQL (or json_fixture stand-in)
 *      ↓
 *   SELECT id, state FROM "order" WHERE code = $1
 *      ↓
 *   compare expected / actual
 *
 * Agents never supply free-form SQL — only controlledQueryId.
 */
export function buildPostApiDatabaseSteps(input: {
  readonly orderCode?: string;
  readonly orderId?: string;
  readonly orderState?: string;
  /** When set, use live postgres with controlled query; otherwise json_fixture. */
  readonly postgresConnectionString?: string;
}): readonly ValidationStep[] {
  const orderCode = input.orderCode ?? DEMO_ORDER_CODE;
  const orderId = input.orderId ?? DEMO_ORDER_ID;
  const orderState = input.orderState ?? DEMO_ORDER_STATE;
  const expectedRows = [{ id: orderId, state: orderState }];

  if (input.postgresConnectionString) {
    return [
      {
        id: 'database-order-by-code',
        type: 'database_state',
        driver: 'postgres',
        connectionString: input.postgresConnectionString,
        controlledQueryId: ORDER_BY_CODE_QUERY.id,
        params: [orderCode],
        expectEquals: expectedRows,
        expectRowCount: 1,
      },
    ];
  }

  return [
    {
      id: 'database-order-by-code',
      type: 'database_state',
      driver: 'json_fixture',
      fixturePath: ORDER_FIXTURE_PATH,
      controlledQueryId: ORDER_BY_CODE_QUERY.id,
      params: [orderCode],
      expectEquals: expectedRows,
      expectRowCount: 1,
    },
  ];
}

/** Workspace fixture shaped like `"order"` rows for controlled query demos. */
export function buildOrderTableFixture(input?: {
  readonly orderCode?: string;
  readonly orderId?: string;
  readonly orderState?: string;
}): {
  readonly table: 'order';
  readonly controlledQueryId: string;
  readonly sql: string;
  readonly rows: ReadonlyArray<{ id: string; code: string; state: string }>;
} {
  return {
    table: 'order',
    controlledQueryId: ORDER_BY_CODE_QUERY.id,
    sql: ORDER_BY_CODE_QUERY.sql,
    rows: [
      {
        id: input?.orderId ?? DEMO_ORDER_ID,
        code: input?.orderCode ?? DEMO_ORDER_CODE,
        state: input?.orderState ?? DEMO_ORDER_STATE,
      },
    ],
  };
}
