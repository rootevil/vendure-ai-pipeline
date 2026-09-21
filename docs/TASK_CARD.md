# Task cards (business goal → machine metrics)

The client’s core requirement: humans supply a **business goal**, not technical instructions. The **scenario compiler** expands that card into a client-shaped `technical-task.json`, then into a runnable `TaskDefinition`.

Full compiler docs: [SCENARIO_COMPILER.md](./SCENARIO_COMPILER.md).

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

## Compile → technical-task.json

```bash
npm run pipeline -- compile --task tasks/customer-order-demo.yaml
# → preconditions, actions, assertions, browserChecks, apiChecks,
#   databaseChecks, evidenceRequirements, cleanup, rollback, stopConditions
```

Checked-in sample: `tasks/customer-order-demo.technical-task.json`.

```bash
npm run pipeline -- compile --task tasks/customer-order-demo.yaml --format task    # runnable TaskDefinition
npm run pipeline -- compile --task tasks/customer-order-demo.yaml --format bundle  # both
```

## Honest bounds

Compiling proves **goal → technical acceptance metrics**. It does not by itself prove live Vendure browse→cart→checkout until an isolated-Vendure runner executes those checks.
