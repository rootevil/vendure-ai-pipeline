# Task cards (business goal → machine metrics)

The client’s core requirement: humans supply a **business goal**, not technical instructions. The scenario compiler expands that card into a machine-checkable `TaskDefinition` (stages, validationSteps, evidence, circuit-break rules).

## Business card shape

```yaml
id: customer-order-demo

goal: >
  A customer should be able to browse a product,
  add it to the cart and complete the checkout flow.

acceptance:
  - storefront loads
  - product is visible
  - product can be added to cart
  - checkout can be started
  - order is created
  - backend contains the order

environment:
  target: isolated-vendure
```

| Field | Meaning |
| --- | --- |
| `id` | Stable task id |
| `goal` | End-to-end business outcome in plain language |
| `acceptance` | Business-visible bullets (not GraphQL/CSS instructions) |
| `environment.target` | Runtime lane (Phase 1: `isolated-vendure`) |

Optional: `title`, `mode`, `timeoutMs`, `writeAllowlist`, URL overrides under `environment`.

## Compile

```bash
npm run pipeline -- compile --task tasks/customer-order-demo.yaml
```

Or in code:

```ts
import { compileScenarioFromPath } from './src/compiler/scenario-compiler.js';
const task = compileScenarioFromPath('tasks/customer-order-demo.yaml');
```

## What the compiler produces

For each acceptance bullet, deterministic technical metrics are added, for example:

| Acceptance | Machine checks (examples) |
| --- | --- |
| storefront loads | `application_health` + `browser_playwright` |
| product is visible | Shop HTTP products + browser selector |
| product can be added to cart | Shop GraphQL `addItemToOrder` |
| checkout can be started | Browser `/checkout` |
| order is created | Shop GraphQL `activeOrder` |
| backend contains the order | Admin GraphQL orders + json_fixture order state |

Plus always: `evidence_present`, stage plan, write allowlist, circuit-break rules. Agent `claimedSuccess` never becomes PASS.

URLs default to `http://127.0.0.1:0/...` (ephemeral / scenario rewrite), matching the public catalog pattern.

## What this does **not** claim

Compiling `customer-order-demo` proves the **task-card → metrics** path. It does **not** by itself prove a live Vendure browse→cart→checkout→order E2E against a full Shop/Admin stack — that remains a later long-chain gate. Running the compiled task against a real isolated Vendure is out of the current vertical-slice demo unless a matching scenario runner exists.

## Related cards

| Card | Kind |
| --- | --- |
| `tasks/customer-order-demo.yaml` | Business goal card (compiled) |
| `tasks/demo-task.yaml` | Companion pointer → catalog E2E JSON |
| `evaluation-demo/task.md` | Markdown NL card → catalog fixture |

See [ARCHITECTURE.md](./ARCHITECTURE.md), [VALIDATION.md](./VALIDATION.md).
