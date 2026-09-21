# Scenario Compiler (PM / E2E)

First intelligence layer between a **business task card** and the runnable pipeline:

```text
Business Task (goal + acceptance)
        ↓
 Scenario Compiler
        ↓
 technical-task.json
        ↓
 runnable TaskDefinition (validationSteps, stages, …)
```

The client requires the Product Manager / E2E Scenario Compiler to produce technical acceptance conditions, evidence requirements, cleanup, rollback, and circuit-break (stop) conditions — not to leave those as free-form agent prose.

## Compile

Default output is the **technical scenario** (client shape):

```bash
npm run pipeline -- compile --task tasks/customer-order-demo.yaml
# equivalent:
npm run pipeline -- compile --task tasks/customer-order-demo.yaml --format technical
```

Other formats:

```bash
npm run pipeline -- compile --task tasks/customer-order-demo.yaml --format task     # runnable TaskDefinition
npm run pipeline -- compile --task tasks/customer-order-demo.yaml --format bundle   # { technical, task }
```

## technical-task.json shape

```json
{
  "id": "customer-order-demo",
  "title": "Customer Order Demo",
  "goal": "A customer should be able to browse a product, …",
  "acceptance": ["storefront loads", "…"],
  "environment": { "target": "isolated-vendure" },
  "preconditions": [],
  "actions": [],
  "assertions": [],
  "browserChecks": [],
  "apiChecks": [],
  "databaseChecks": [],
  "evidenceRequirements": [],
  "cleanup": [],
  "rollback": [],
  "stopConditions": [],
  "writeAllowlist": [],
  "mode": "acceptance",
  "timeoutMs": 300000
}
```

| Field | Role |
| --- | --- |
| `preconditions` | What must be true before the agent runs |
| `actions` | High-level engineering actions (still not client micro-instructions) |
| `assertions` | Cross-cutting / business assertions + evidence_present |
| `browserChecks` | Playwright metrics (URL, selector, screenshot) |
| `apiChecks` | Health / HTTP / GraphQL metrics |
| `databaseChecks` | Fixture or DB state metrics |
| `evidenceRequirements` | Required artifact files |
| `cleanup` | Post-run cleanup obligations |
| `rollback` | How to discard disposable work |
| `stopConditions` | Circuit-break / safe-stop rules (maps to `circuitBreakRules`) |

Checked-in example: `tasks/customer-order-demo.technical-task.json` (regenerate via compile).

## Mapping to the pipeline

`technicalScenarioToTaskDefinition()` projects checks into `validationSteps` and stages. The independent validator still decides PASS/BLOCK; agent success claims never grant PASS.

## Honest bounds

- Compiler is **deterministic** (acceptance bullet → metric templates), not a free-form LLM PM agent.
- Compiling `customer-order-demo` does **not** prove a live Vendure checkout E2E until an isolated-Vendure scenario runner executes those checks against a real stack.
- Companion YAML cards (`companion: …json`) skip technical compilation and load the TaskDefinition directly.

## Code map

| Module | Role |
| --- | --- |
| `src/compiler/compile-technical-scenario.ts` | Business card → technical scenario |
| `src/compiler/technical-scenario.ts` | Zod schema |
| `src/compiler/technical-scenario-to-task.ts` | Technical → TaskDefinition |
| `src/compiler/scenario-compiler.ts` | Path loader / bundle |

See also [TASK_CARD.md](./TASK_CARD.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [VALIDATION.md](./VALIDATION.md).
