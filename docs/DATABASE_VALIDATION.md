# Database validation

Where appropriate, the independent validator queries expected records and compares **expected vs actual**.

```text
PostgreSQL (or json_fixture stand-in)
   ↓
controlled query (allowlisted SELECT)
   ↓
compare expected / actual
```

Example (catalog id `order_by_code`):

```sql
SELECT id, state
FROM "order"
WHERE code = $1;
```

## Agents do not run free SQL

| Actor | SQL access |
| --- | --- |
| Coding agent | **No** free-form / destructive SQL |
| Independent validator | **Only** `controlledQueryId` allowlisted SELECTs + bound `$n` params |

Postgres `database_state` **requires** `controlledQueryId`. Raw agent-supplied SQL is rejected.

Destructive statements (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, …) are refused by `assertSafeReadOnlySql`.

## Checkout demo

After browser + GraphQL, the demo runs:

```text
controlledQueryId: order_by_code
params: ["ORD-DEMO-1"]
expectEquals: [{ "id": "42", "state": "PaymentSettled" }]
```

Default driver is `json_fixture` (`data/order-table.json`) so CI needs no live Postgres.  
Live DB: pass a stack-allowlisted connection string / `postgresConnectionString` on the scenario.

Evidence: `validation/database-order-by-code.json` (expected + actual rows).

## Code map

| Module | Role |
| --- | --- |
| `src/validator/controlled-sql.ts` | Allowlist + read-only SQL guard |
| `src/validator/database-executor.ts` | json_fixture / parameterized postgres |
| `src/scenarios/browser-checkout/database-checks.ts` | Order-by-code step builder |

See [GRAPHQL_API_VALIDATION.md](./GRAPHQL_API_VALIDATION.md), [VALIDATION.md](./VALIDATION.md).
