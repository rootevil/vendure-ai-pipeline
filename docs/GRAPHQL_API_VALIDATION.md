# GraphQL / API validation

After browser validation, the independent validator queries the Shop API separately.

```text
Browser evidence (Playwright screenshots)
                 +
Backend evidence (GraphQL / HTTP)
                 ↓
            PASS / BLOCK
```

UI looking correct is **not** enough. Backend state must match.

## Flow (checkout demo)

```text
GraphQL
  ↓
query product
  ↓
query customer / order
  ↓
verify expected state  (+ REST order GET)
```

Runs **after** the Playwright journey in `browser-checkout-demo`:

1. `graphql-query-product` — `product(slug: …).name`
2. `graphql-query-order` — `order(code: …).code`
3. `graphql-query-customer-orders` — `activeCustomer.emailAddress`
4. `api-order-state` — `GET /api/orders/ORD-DEMO-1` body contains product name

## Evidence

| Channel | Artifacts |
| --- | --- |
| Browser | `screenshots/01-home.png` … `04-checkout.png`, `playwright-results.json` |
| Backend | `api-responses/graphql-query-product.json`, `graphql-query-order.json`, `graphql-query-customer-orders.json`, `api-order-state.json` |

## Run

```bash
npm run scenario:browser-checkout
```

Inspect:

```bash
ls artifacts/<runId>/screenshots/
ls artifacts/<runId>/api-responses/
cat artifacts/<runId>/validator-verdict.json
```

## Code map

| Module | Role |
| --- | --- |
| `src/scenarios/browser-checkout/graphql-checks.ts` | Post-browser GraphQL/HTTP steps |
| `src/scenarios/browser-checkout/demo-storefront.ts` | HTML + `/shop-api` + `/api/*` |
| `src/validator/checks/graphql.ts` | `graphql_request` check runner |

See [BROWSER_VALIDATION.md](./BROWSER_VALIDATION.md), [DATABASE_VALIDATION.md](./DATABASE_VALIDATION.md), [VALIDATION.md](./VALIDATION.md).
