# Delivery checklist (Phase 1)

Use this before declaring the contractor Phase 1 workspace ready for evaluator handover. Every item must be **demonstrable** with commands in [FINAL_DEMO.md](./FINAL_DEMO.md) or the linked docs. Do not tick items that only exist as design prose.

## A. Clean-room readiness

| # | Criterion | How to verify | Status |
| --- | --- | --- | --- |
| A1 | Fresh clone installs with public lockfile | `PIPELINE_SKIP_PLAYWRIGHT_INSTALL=1 npm ci` | ☐ |
| A2 | Typecheck + unit/integration tests pass | `npm run typecheck && npm test` | ☐ |
| A3 | No undocumented credentials required for default demo | Defaults: mock / scenario agent; templates only in `.env.example` / `.env.docker.example` | ☐ |
| A4 | No dependence on private machine-only paths | Demo uses repo-relative paths + printed `artifactDir` | ☐ |
| A5 | Docker stack starts and healthchecks | `./scripts/start.sh` then `./scripts/check.sh` | ☐ |
| A6 | Docker cleanup restores empty stack | `./scripts/cleanup.sh` | ☐ |

## B. Demonstration coverage (evaluator script)

| # | Criterion | Command / artifact | Status |
| --- | --- | --- | --- |
| B1 | Natural-language task card exists | `evaluation-demo/task.md` | ☐ |
| B2 | Card compiles to structured JSON task | Mapping to `fixtures/tasks/vendure-public-catalog-e2e.json` via `loadTaskDefinitionFromPath` | ☐ |
| B3 | Isolated run produced | `workspace/` disposable + `artifacts/<runId>/` | ☐ |
| B4 | Agent execution recorded | `attempts.json`, `stdout.log`, logs name scenario agent | ☐ |
| B5 | Independent validation ran | `validation-results.json` / `validation/` | ☐ |
| B6 | Evidence pack collected | `evidence-manifest.json` + required files | ☐ |
| B7 | PASS decided by validator, not agent claim | `summary.md` notes claim ignored; `status.json` = PASS | ☐ |
| B8 | Artifact CLI confirms PASS | `node packages/validator/bin/validate.mjs --run-dir …` | ☐ |
| B9 | Controlled failure shown | `verify.sh --baseline` → `BASELINE_BLOCKED_EXPECTED` | ☐ |
| B10 | Bounded recovery shown | `scenario:failure-recoverable` → PASS, `repairAttempts: 1` | ☐ |
| B11 | Unrecoverable BLOCK shown | `scenario:failure-unrecoverable` → BLOCK, `repairAttempts: 0` | ☐ |
| B12 | Final report reviewable | `report.md` / `summary.html` | ☐ |

## C. Honesty / non-claims

| # | Criterion | Status |
| --- | --- | --- |
| C1 | README / FINAL_DEMO do not claim OpenHands solved the catalog in the default path | ☐ |
| C2 | Docs state fake browser is default unless `PIPELINE_USE_REAL_BROWSER=1` | ☐ |
| C3 | Docs state NL compiler is **known-card mapping**, not general NL | ☐ |
| C4 | Docs state Compose uses `internal: true`, not `network_mode: none` | ☐ |
| C5 | Full Vendure Batch 1+2 / Stripe / Mailpit / production / minipc explicitly out of Phase 1 | ☐ |
| C6 | [LIMITATIONS.md](./LIMITATIONS.md) and [SECURITY_LIMITATIONS.md](./SECURITY_LIMITATIONS.md) present | ☐ |

## D. Handover documentation set

| Doc | Present | Status |
| --- | --- | --- |
| [README.md](../README.md) | Entry + honest scope | ☐ |
| [QUICKSTART.md](./QUICKSTART.md) | Clone → demo path | ☐ |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | As-built | ☐ |
| [CONFIGURATION.md](./CONFIGURATION.md) | Env reference | ☐ |
| [VALIDATION.md](./VALIDATION.md) | PASS/BLOCK | ☐ |
| [LIMITATIONS.md](./LIMITATIONS.md) | Non-claims | ☐ |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common failures | ☐ |
| [FINAL_DEMO.md](./FINAL_DEMO.md) | Evaluator script | ☐ |
| [DOCKER_SETUP.md](./DOCKER_SETUP.md) | Stack | ☐ |
| [FAILURE_DEMO.md](./FAILURE_DEMO.md) | Recovery detail | ☐ |
| [PHASE1_SCOPE.md](./PHASE1_SCOPE.md) | Scope freeze | ☐ |

## E. Safety / CI surfaces (Phase 1)

| # | Criterion | How to verify | Status |
| --- | --- | --- | --- |
| E1 | GHA workflow exists with allowlisted tasks | `.github/workflows/pipeline.yml` | ☐ |
| E2 | Default agent mode needs no LLM keys | `PIPELINE_AGENT_MODE=mock` in `.env.example` | ☐ |
| E3 | Validator refuses forgeable PASS without check JSON | Covered in tests + `validate.mjs` behavior | ☐ |

## Gate decision

**Ready for Phase 1 evaluator demo** only if:

- All of **A**, **B**, and **C** are checked, and  
- **D** docs exist and match the rehearsal, and  
- A reviewer has walked [FINAL_DEMO.md](./FINAL_DEMO.md) once on a machine that is **not** the author’s day-to-day workspace (or a clean clone + wipe of `artifacts/` / Docker volumes).

If any B item fails, the project is **not** ready — fix or narrow claims before handover.

## Rehearsal note

A clean-room rehearsal was executed against this repo before writing [FINAL_DEMO.md](./FINAL_DEMO.md). Re-run the script on evaluator day; do not rely solely on prior artifact directories.
