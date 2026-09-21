# Long-chain tasks (framework)

Formal client delivery eventually requires **at least three** representative long-chain E2E tasks, with Batch 1 / Batch 2 coverage and a third proposed task. That gate is **not** claimed as PASS in this MVP.

What is prepared now: the same reusable Pipeline executes every card under `tasks/task-NN.yaml`.

```text
tasks/
├── task-01.yaml   # Batch 1 foundation slot
├── task-02.yaml   # Batch 2 commerce slot
└── task-03.yaml   # proposed third slot
```

## Flow (no per-task branches)

```text
Task (YAML business card)
   ↓
Scenario compiler → technical acceptance + TaskDefinition
   ↓
Agent (isolated workspace)
   ↓
Tools (allowlisted)
   ↓
Validators (independent PASS/BLOCK)
   ↓
Evidence package
```

Do **not** add runner logic like:

```text
if task == checkout: …
if task == inventory: …
```

Acceptance language is expanded by the scenario compiler. The long-chain runner only discovers `task-NN.yaml` and calls the same `TaskRunner` for each path.

## Commands

```bash
# Compile all three (proves Task → Scenario without claiming E2E PASS)
npm run long-chain:compile

# Execute each slot through the full Pipeline (may BLOCK until a live Vendure target exists)
npm run long-chain

# Single slot — same path as any other business card
npm run pipeline -- run --task tasks/task-02.yaml
```

## Status honesty

| What exists | What does not |
| --- | --- |
| Three task cards + discovery + identical runner | Formal three-task client gate PASS |
| Compiler → validationSteps from acceptance | Full Batch 1+2 migration on private inputs |
| Evidence per run | Unlimited post-delivery tuning loop |

See [PHASE1_SCOPE.md](./PHASE1_SCOPE.md), [SCENARIO_COMPILER.md](./SCENARIO_COMPILER.md), [LIMITATIONS.md](./LIMITATIONS.md).
