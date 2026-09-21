# Architecture — adaptive engineering pipeline (vertical slice)

Client target (briefing branch `codex/github-refactor-20260904`): an **adaptive engineering pipeline** with independent validation, evidence, safe recovery, and E2E/API checks — not a chatbot and not a giant hard-coded state machine.

This repository implements a **working vertical slice** of that loop. Full Vendure Batch 1+2 migration, Buzz multi-role orchestration, load testing, and red-team lanes are **deferred** (see [LIMITATIONS.md](./LIMITATIONS.md), [PHASE1_SCOPE.md](./PHASE1_SCOPE.md)).

## 1. What we build (control loop)

```text
                    ┌──────────────────────┐
                    │  Natural Language    │
                    │      Task Card       │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Scenario Compiler    │
                    │ / PM Agent           │
                    └──────────┬───────────┘
                               │
                     technical task.json
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Pipeline Controller  │
                    │ / Safety Kernel      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Autonomous Agent     │
                    │ OpenHands/equivalent │
                    └──────────┬───────────┘
                               │
                 ┌─────────────┼─────────────┐
                 ▼             ▼             ▼
             Code/CLI      Playwright     GraphQL/API
                 │             │             │
                 └─────────────┼─────────────┘
                               ▼
                    ┌──────────────────────┐
                    │ Independent         │
                    │ Validation Engine   │
                    └──────────┬───────────┘
                               │
                         PASS / BLOCK
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Evidence Package     │
                    │ logs/screenshots/etc │
                    └──────────────────────┘
```

Client reference loop (outcomes, not mandatory product names):

```text
task card → scenario compilation → technical analysis → autonomous development
  → evidence → independent validation → [load / red-team — deferred]
  → cleanup / rollback
```

**Design principle:** thin custom orchestration around an Agent runtime (OpenHands adapter or mock/scenario agents). The code-owned kernel owns permissions, allowlists, retries/circuit-break, evidence integrity, and **PASS/BLOCK**. The Agent never decides PASS.

### Vertical-slice status

| Layer | Phase 1 status |
| --- | --- |
| Natural-language task card | Yes — `evaluation-demo/task.md` + business YAML cards under `tasks/` |
| Scenario compiler | Yes — business goal → `technical-task.json` (preconditions/actions/checks/cleanup/rollback/stop) → TaskDefinition |
| Safety kernel | Yes — workspace/runs isolation, action/command allowlists, fail-closed MiniPC/SSH/production |
| Autonomous agent | Yes — mock + OpenHands CLI adapter + scenario agents; default demo uses scenario/mock |
| Code / Playwright / GraphQL-API checks | Yes — independent validator check types |
| Independent PASS/BLOCK | Yes — in-process + `packages/validator` |
| Evidence package | Yes — `artifacts/<runId>/` (runtime alias of `runs/`) |
| Load testing / red-team | **Not** in this slice |
| Buzz permanent multi-role team | **Not** in this slice |

## 2. Repository structure

Canonical layout (orchestration-facing names). Implementation may live in a sibling module and be re-exported — thin façade, not a second state machine.

```text
vendure-ai-pipeline/
├── src/
│   ├── cli/
│   │   ├── index.ts          # vendure-pipeline entry
│   │   └── run.ts            # façade → CLI run
│   ├── pipeline/
│   │   ├── controller.ts     # agent loop + validator handoff
│   │   ├── run-context.ts    # disposable run identity / dirs
│   │   ├── task-loader.ts    # load task card / JSON / YAML companion
│   │   └── result.ts         # RunResult / status helpers
│   ├── compiler/
│   │   ├── scenario-compiler.ts
│   │   └── acceptance-schema.ts
│   ├── agent/
│   │   ├── agent-interface.ts
│   │   ├── openhands-adapter.ts
│   │   ├── mock-agent.ts
│   │   └── …                 # factory, parsers, process runner
│   ├── execution/
│   │   ├── sandbox.ts        # allowlisted workspace boundary
│   │   ├── command-runner.ts
│   │   ├── workspace.ts
│   │   ├── task-runner.ts
│   │   └── …
│   ├── validators/           # independent checks (façade)
│   │   ├── validator.ts
│   │   ├── health-validator.ts
│   │   ├── graphql-validator.ts
│   │   ├── api-validator.ts
│   │   ├── browser-validator.ts
│   │   └── database-validator.ts
│   ├── recovery/
│   │   ├── failure-classifier.ts
│   │   ├── retry-policy.ts
│   │   └── circuit-breaker.ts
│   ├── evidence/
│   │   ├── evidence-manager.ts
│   │   ├── screenshot.ts
│   │   └── report.ts
│   ├── safety/
│   │   ├── permissions.ts
│   │   ├── resource-limits.ts
│   │   ├── dangerous-actions.ts
│   │   └── rollback.ts
│   ├── config/
│   │   └── config.ts
│   ├── scenarios/            # vertical-slice demos (catalog, failure, nail-patterns)
│   ├── validator/            # check engine implementation
│   ├── controller/           # core controller implementation
│   ├── task/                 # Zod task schema + safety
│   └── retry/                # recovery implementation
│
├── tasks/                    # human + machine task cards
│   ├── demo-task.yaml
│   ├── demo-task.json
│   ├── failure-recovery-task.yaml
│   └── failure-recovery-task.json
│
├── validators/               # offline artifact validator surface
│   └── README.md             # → packages/validator
│
├── docker/
│   ├── Dockerfile
│   └── compose.yaml
│
├── runs/                     # reserved evidence alias (see artifacts/)
├── artifacts/                # default evidence root (gitignored)
├── workspace/                # disposable workspaces (gitignored)
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│       └── README.md         # → repo `test/` runners
│
├── test/                     # actual Node test files (Phase 1)
├── fixtures/tasks/           # additional JSON fixtures
├── evaluation-demo/          # public client evaluation package
├── scripts/                  # start/stop/check/cleanup + scenarios
├── packages/                 # thin package surfaces (validator CLI)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── QUICKSTART.md
│   ├── VALIDATION.md
│   ├── SAFETY.md
│   └── LIMITATIONS.md
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

### Module map (façade → implementation)

| Proposed module | Implementation |
| --- | --- |
| `src/pipeline/controller.ts` | `src/controller/pipeline-controller.ts` |
| `src/pipeline/task-loader.ts` | `src/compiler/scenario-compiler.ts` + `src/task/*` |
| `src/compiler/*` | `src/task/task-card.ts`, `task-definition.ts` |
| `src/recovery/*` | `src/retry/*` |
| `src/validators/*` | `src/validator/*` + `checks/*` |
| `src/execution/sandbox.ts` | `src/safety/execution-context.ts` |
| `src/cli/run.ts` | `src/cli/index.ts` |
| Evidence root `runs/` | Prefer `PIPELINE_ARTIFACTS_DIR=./artifacts` (compatible fields) |

## 3. Isolation model (as-built)

| Surface | Behavior |
| --- | --- |
| Compose stack | `internal: true` — no egress, no published ports |
| Host / scenario runs | Disposable `workspace/<runId>/`; SSRF allowlists for HTTP |
| GHA | Allowlisted task paths; default `PIPELINE_ALLOW_NETWORK=false` |

Not `network_mode: none`. Details: [DOCKER_SETUP.md](./DOCKER_SETUP.md), [SECURITY_LIMITATIONS.md](./SECURITY_LIMITATIONS.md).

## 4. Validation and recovery

- Validator ignores agent `claimedSuccess`.
- Check types: evidence, workspace/files, health, HTTP, GraphQL, browser, database/json_fixture, path_invariant, redis/postgres probes.
- Recovery: failure classifier + retry budgets + circuit breaker; unsafe/secret patterns → safe-stop `BLOCK`.
- Modes: `acceptance`, `baseline` (`BASELINE_BLOCKED_EXPECTED`), `full` (reserved).

## 5. Smoke path

```bash
npm ci && npm test
./scripts/start.sh && ./scripts/check.sh
./scripts/start.sh --task evaluation-demo/task.md
# or: npm run pipeline -- run --task tasks/demo-task.json
node packages/validator/bin/validate.mjs --run-dir artifacts/$(ls -1t artifacts | head -1)
./scripts/cleanup.sh
```

Full evaluator script: [FINAL_DEMO.md](./FINAL_DEMO.md).
