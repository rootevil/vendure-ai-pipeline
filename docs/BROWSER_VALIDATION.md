# Browser validation (Playwright)

Independent validator browser checks use **Playwright**. Agent success claims never grant PASS.

## First demo (visually obvious)

```text
Open storefront
        ↓
Find product
        ↓
Open product
        ↓
Add to cart
        ↓
Checkout
        ↓
Verify expected result
```

### Run

```bash
# Deterministic fake browser (CI / default)
npm run scenario:browser-checkout

# Real Chromium (after: npx playwright install chromium)
npm run scenario:browser-checkout -- --real-browser
# or: PIPELINE_USE_REAL_BROWSER=1 npm run scenario:browser-checkout
```

### Captured evidence

```text
artifacts/<runId>/screenshots/
  01-home.png
  02-product.png
  03-cart.png
  04-checkout.png

artifacts/<runId>/playwright-results.json
artifacts/<runId>/validator-verdict.json
```

`playwright-results.json` records each journey step (goto/click/assert), status, and screenshot paths.

## Dual evidence (required)

After the browser journey, the same demo runs **independent** Shop API checks and a **controlled** DB query:

```text
GraphQL → query product → query customer/order → verify expected state
PostgreSQL / fixture → SELECT id, state FROM "order" WHERE code = $1 → expected vs actual
```

See [GRAPHQL_API_VALIDATION.md](./GRAPHQL_API_VALIDATION.md) and [DATABASE_VALIDATION.md](./DATABASE_VALIDATION.md). Browser screenshots alone never grant PASS.

## Check types

| Type | Use |
| --- | --- |
| `browser_playwright` | Single page load + title/selector/text + one screenshot |
| `browser_journey` | Multi-step storefront flow (home → product → cart → checkout) |

Journey actions: `goto`, `click`, `fill`, `assert`, `screenshot`.

## Code map

| Module | Role |
| --- | --- |
| `src/validator/checks/browser-journey.ts` | Journey runner + `playwright-results.json` |
| `src/validator/checks/browser.ts` | Single-page Playwright check |
| `src/scenarios/browser-checkout/` | Demo storefront + scenario |
| `scripts/run-browser-checkout-demo.mjs` | CLI entry |

See [VALIDATION.md](./VALIDATION.md).
