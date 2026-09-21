# Phase 10 — Independent QA Report

**Role:** Independent QA (no implementation changes before this document).  
**Scope under test:** Phase 1 pipeline vs `docs/PHASE1_SCOPE.md`, `docs/ARCHITECTURE.md`, and public evaluation requirements.  
**Commit under test:** `70da0b1` (`main`).  
**Date:** 2026-09-20.

## 1. Executive verdict

Phase 1 is **not gate-complete**. Core control-loop behavior (task JSON → mock/scenario agent → independent validation → evidence → PASS/BLOCK → cleanup → failure demos) is largely green on the host, but **required Phase 1 IDs P1-07, P1-09, P1-10, and P1-11 fail**, and several Architecture / Milestone C–E entrypoints do not exist as specified.

| Gate | Result |
| --- | --- |
| P1-01 Docker runner + isolation | **PASS** (with Colima + `DOCKER_HOST`) |
| P1-02 env/lock/scripts | **PASS** (minor UX gap DEF-013) |
| P1-03 task-card → stage manifest | **PARTIAL** (JSON only; no `task.md`) |
| P1-04 isolated workspace / path guards | **PASS** |
| P1-05 coding worker integration | **PARTIAL** (adapter present; catalog E2E uses scenario/mock agent) |
| P1-06 bounded retry / circuit | **PASS** |
| P1-07 independent validator CLI | **FAIL** |
| P1-08 evidence bundle | **PASS** (path name diverges: `runs/` vs `artifacts/`) |
| P1-09 public demo reference/baseline/acceptance | **FAIL** (baseline broken) |
| P1-10 nail-patterns / path-invariant task | **FAIL** |
| P1-11 `workflow_dispatch` | **FAIL** |
| P1-12 security boundary docs | **PASS** |

## 2. Test matrix (empirical)

| Area | Command / method | Result | Notes |
| --- | --- | --- | --- |
| Clean installation | `npm ci` | **PASS** | Lockfile present; Node ≥20 |
| Typecheck | `npm run typecheck` | **PASS** | |
| Unit / integration suite | `npm test` | **PASS** | 54/54 |
| Build | `npm run build` | **PASS** | (prior Phase 10 run) |
| Docker startup | `./scripts/start.sh` | **PASS** | Requires Colima + `DOCKER_HOST=unix://$HOME/.colima/docker.sock` |
| Docker health | `./scripts/check.sh` | **PASS** when stack up; **exit 1** when down (correct) |
| Docker stop / cleanup | `./scripts/stop.sh`, `./scripts/cleanup.sh` | **PASS** | Volumes removed |
| Postgres / Redis health | compose health + `healthcheck.mjs --full` | **PASS** | Ping only; not task validation |
| Task parsing (JSON) | fixtures + Zod | **PASS** | |
| Task parsing (`task.md`) | `pipeline run --task evaluation-demo/task.md` | **FAIL** | JSON parse error; exit 1 |
| Agent execution | mock + public-catalog scenario agent | **PASS** | |
| Timeout | unit tests + mock/OpenHands adapter tests | **PASS** | |
| Retry limits | `test/retry-policy.test.ts` + recovery demos | **PASS** | |
| Validation (independent) | unit + scenarios | **PASS** | Agent claim ignored |
| PASS path | hello fixture, catalog scenario (fake browser), acceptance verify | **PASS** | |
| BLOCK path | failure-unrecoverable, missing evidence tests | **PASS** | |
| Evidence pack | manifest, status, logs, rollback, summary, screenshots dir | **PASS** | Under `runs/<runId>/` |
| Cleanup | `cleanupWorkspace` + docker volumes | **PASS** | |
| Rollback / checkpoint | evidence `rollback.md` only | **PARTIAL** | No restore checkpoint |
| Browser test (fake) | default public-catalog | **PASS** | |
| Browser test (real Playwright) | `useRealBrowser: true` | **FAIL** | Chromium binary missing |
| API / GraphQL | public-catalog + failure demos | **PASS** | |
| Database validation | `database_state` json_fixture | **PASS** | |
| Database validation | postgres driver | **NOT EXERCISED** | `pg` not installed |
| Redis validation (task-level) | — | **MISSING** | Healthcheck only |
| Failure recovery | `scenario:failure-recoverable` / `unrecoverable` | **PASS** | |
| Eval reference | `node evaluation-demo/scripts/run-demo.mjs` | **PASS** | |
| Eval baseline | `verify.sh --baseline` | **FAIL** | exit 1, status `BLOCK` |
| Eval acceptance | `verify.sh --acceptance` | **PASS** | |
| Milestone C validator CLI | `node packages/validator/bin/validate.mjs` | **FAIL** | path missing |
| Milestone D `start.sh --task` | `./scripts/start.sh --task …` | **FAIL** | flag ignored / unsupported |
| Milestone E workflow | `gh workflow run pipeline.yml` | **FAIL** | no workflow |
| npm audit (prod) | `npm audit --omit=dev` | **FAIL** | 1 high (playwright) |

## 3. Defects (complete list)

Severity: **S0** blocks Phase 1 gate; **S1** breaks documented milestone / public eval; **S2** reliability or security; **S3** docs/UX drift.

### DEF-001 — Baseline public demo no longer blocks (P1-09) — **S0**

- **Evidence:** `evaluation-demo/app/src/catalog.mjs` contains the completed migration adapter. `bash evaluation-demo/scripts/verify.sh --baseline` → exit **1**, `status: "BLOCK"` (not `BASELINE_BLOCKED_EXPECTED`).
- **Expected:** Incomplete starter so baseline exits 0 with `BASELINE_BLOCKED_EXPECTED`.
- **Impact:** Milestone A / P1-09 false.

### DEF-002 — Missing GitHub Actions `workflow_dispatch` (P1-11) — **S0**

- **Evidence:** No `.github/workflows/` in repo.
- **Expected:** `pipeline.yml` starting an isolated job and uploading evidence artifacts; Milestone E commands work.
- **Impact:** Phase 1 gate incomplete; client one-click / Codex trigger surface absent.

### DEF-003 — Missing independent validator package CLI (P1-07 / Milestone C) — **S0**

- **Evidence:** `packages/` does not exist; `node packages/validator/bin/validate.mjs --run-dir …` fails.
- **Expected:** Validator CLI deciding PASS/BLOCK/`BASELINE_BLOCKED_EXPECTED` from artifacts only (Architecture §3 / §11).
- **Note:** Logic exists under `src/validator/`; public entrypoint required by scope is missing.

### DEF-004 — Missing nail-patterns / path-invariant task (P1-10) — **S0**

- **Evidence:** No fixture/scenario/tests asserting `evaluation-demo/assets/nail-patterns/` (or `migration-input` fixture paths) relative-path invariants without flatten/rename.
- **Expected:** Second bounded Phase 1 task with validator path checks (Architecture Milestone G).

### DEF-005 — Task-card entry is JSON-only; Milestone D entrypoint broken (P1-03) — **S1**

- **Evidence:**
  - `./scripts/start.sh` only calls `docker-stack.sh start` (no `--task`).
  - CLI: `vendure-pipeline run --task <path-to-task.json>` only; `evaluation-demo/task.md` → `TaskDefinitionError` (invalid JSON).
- **Expected:** Human task card → scenario/stage manifest; `./scripts/start.sh --task evaluation-demo/task.md`.

### DEF-006 — Architecture `packages/` layout not delivered — **S1**

- **Evidence:** Control plane lives entirely under `src/`; Architecture §3 lists `packages/{scenario,safety,evidence,validator,agent-adapter}`.
- **Impact:** Documented package boundaries and Milestone C path are wrong for consumers.

### DEF-007 — Evidence root defaults to `runs/`, not `artifacts/` — **S2**

- **Evidence:** `PIPELINE_ARTIFACTS_DIR` default `./runs`; Architecture and Milestone commands use `artifacts/<run_id>`.
- **Impact:** Operators following Architecture smoke commands look in the wrong place.

### DEF-008 — Catalog E2E does not exercise OpenHands coding worker (P1-05 partial) — **S2**

- **Evidence:** `runPublicCatalogScenario` hardcodes `agentMode: 'mock'` and injects `PublicCatalogScenarioAgent`. OpenHands adapter + timeout tests exist, but there is no catalog end-to-end coding run via OpenHands.
- **Impact:** P1-05 “one end-to-end coding run on the public catalog task” is only proven with a purpose-built scenario agent.

### DEF-009 — Real browser validation fails on clean install — **S1**

- **Evidence:** With `useRealBrowser: true`, check `browser-catalog` → `ERROR`: Playwright Chromium executable missing under the Playwright cache path. Default scenario injects a fake launcher, so CI stays green while real browser is unproven.
- **Expected:** Documented `npx playwright install` (or postinstall) and at least one real-browser path that can PASS.

### DEF-010 — High-severity Playwright advisory — **S2**

- **Evidence:** `npm audit --omit=dev` → `playwright <1.55.1` (GHSA-7mvr-c777-76hp).
- **Fix direction:** Bump to ≥1.55.1 and reinstall browsers.

### DEF-011 — No workspace checkpoint / restore — **S2**

- **Evidence:** Rollback is instructional (`rollback.md` / discard workspace). No pre-agent filesystem checkpoint or restore on failure.
- **Expected (QA matrix):** rollback/checkpoint behavior beyond prose.

### DEF-012 — Live Postgres/Redis unused by task validation — **S2**

- **Evidence:** Compose injects `DATABASE_URL` / `REDIS_URL`; healthcheck pings both. Task schema supports `database_state` + optional postgres via `pg`, but `pg` is not a dependency and no Redis validation step exists. Public scenario uses `json_fixture` only.
- **Note:** Full Vendure DB/Redis observation is Phase 2 deferred in PHASE1_SCOPE §3; nevertheless the shipped stack implies dependency validation that the control plane never uses in a task.

### DEF-013 — Docker scripts lack Colima / daemon preflight — **S3**

- **Evidence:** Without `DOCKER_HOST` pointing at Colima’s socket, `docker` fails (`permission denied` / daemon down). `check` waits ~30s on postgres health before failing.
- **Expected:** Fast fail with actionable message (set `DOCKER_HOST` / start Colima).

### DEF-014 — Milestone verification commands drift from implementation — **S3**

- **Evidence:** PHASE1_SCOPE §6 / Architecture §11 still prescribe `packages/validator`, `start.sh --task`, `artifacts/`, and `workflow_dispatch` paths that do not match the repo.
- **Impact:** Reviewers cannot follow written smoke steps.

### DEF-015 — `start.sh --task` cannot start an isolated catalog job inside Compose — **S1** (related to DEF-005)

- **Evidence:** Pipeline container only runs `keep-alive.mjs`; there is no compose `run` path that mounts a task card, executes the pipeline, and exports evidence to the host/artifacts volume as Milestone D describes.

## 4. What passed (keep)

- Zod task safety, path allowlist / escape fail-closed.
- Retry policy: identical/timeout budgets, unsafe fail-closed, validation never retries agent for PASS.
- Independent validator ignores agent prose; PASS / BLOCK / `BASELINE_BLOCKED_EXPECTED` (in unit tests).
- Evidence pack shape compatible with demo (`run-manifest`, `status`, logs, diff/change-summary, rollback, summary, manifest).
- Public catalog scenario (fake browser): health, REST, GraphQL, json_fixture DB, evidence → PASS.
- Recoverable failure demo → repair → PASS; unrecoverable → BLOCK without repair.
- Docker internal network, no host ports, disposable volumes, health probes for pipeline/postgres/redis.
- Security boundary stated in README + architecture (no production / private creds / unrestricted minipc).

## 5. Fix order (post-report)

Fixes must land **after** this report, one defect at a time, with a full suite re-run after the set:

1. DEF-001 restore incomplete `catalog.mjs` for baseline  
2. DEF-003 validator CLI under `packages/validator`  
3. DEF-002 `workflow_dispatch` workflow + artifact upload  
4. DEF-004 nail-patterns path-invariant task + tests  
5. DEF-005 / DEF-015 task entry (`task.md` compile and/or `start.sh --task` + container run)  
6. DEF-007 align default evidence dir / docs (`artifacts/`)  
7. DEF-009 / DEF-010 Playwright bump + install + real-browser coverage  
8. DEF-011 workspace checkpoint/restore  
9. DEF-012 minimal Redis/Postgres validation hook for the Docker stack  
10. DEF-006 / DEF-014 package shims + milestone doc sync  
11. DEF-008 document or add OpenHands catalog dry-run path  
12. DEF-013 Docker preflight / Colima hint  

## 7. Remediation log (post-report fixes)

| Defect | Fix | Re-test |
| --- | --- | --- |
| DEF-001 | Restored incomplete `evaluation-demo/app/src/catalog.mjs` from `catalog.incomplete.mjs` | `verify.sh --baseline` → `BASELINE_BLOCKED_EXPECTED` exit 0; reference demo PASS |
| DEF-002 | Added `.github/workflows/pipeline.yml` (`workflow_dispatch`, artifact upload) | Workflow file present |
| DEF-003 | Added `packages/validator/bin/validate.mjs` + `src/validator/validate-run-dir.ts` | CLI PASS on `artifacts/<runId>` |
| DEF-004 | Added `path_invariant` check, nail-patterns fixture/scenario, `npm run scenario:nail-patterns` | Scenario PASS; unit test PASS |
| DEF-005 / DEF-015 | `task-card` MD→JSON compiler; `./scripts/start.sh --task`; `scripts/run-task.sh` | `./scripts/start.sh --task evaluation-demo/task.md` → PASS |
| DEF-006 | Added `packages/{validator,evidence,safety,scenario,agent-adapter}` surfaces | Layout present |
| DEF-007 | Default `PIPELINE_ARTIFACTS_DIR=./artifacts` | Config test + scenarios write under `artifacts/` |
| DEF-008 | Catalog scenario honors `PIPELINE_AGENT_MODE=openhands`; default remains scenario agent | Documented in README / run-scenario |
| DEF-009 | `postinstall` Playwright install helper; `PIPELINE_USE_REAL_BROWSER=1` / `--real-browser` | Install attempted; Chromium download can be slow/offline — fake browser still default |
| DEF-010 | Bumped `playwright` to ^1.55.1 (resolved ^1.63.0) | `npm audit --omit=dev` → 0 vulnerabilities |
| DEF-011 | `createWorkspaceCheckpoint` / `restore-checkpoint.mjs` | Unit test PASS |
| DEF-012 | `redis_ping` + `postgres_ready` steps; `fixtures/tasks/stack-deps-health.json` | Stack-deps task PASS inside Compose |
| DEF-013 | Docker scripts auto-set Colima `DOCKER_HOST` + daemon preflight | Fast fail when daemon down |
| DEF-014 | Updated PHASE1_SCOPE milestone commands + README | Docs aligned |

### Full suite re-run (after fixes)

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | **59/59 PASS** |
| `npm run build` | PASS |
| Eval baseline / reference | PASS |
| `scenario:public-catalog` | PASS |
| `scenario:nail-patterns` | PASS |
| Failure demos | PASS |
| Validator CLI | PASS |
| `./scripts/start.sh --task evaluation-demo/task.md` | PASS |
| Docker health + stack-deps Redis/Postgres | PASS |
| Real Playwright browser | **PARTIAL** — install script present; full Chromium download did not finish in this QA host session (network). Fake-browser path remains green. |

### Phase 1 gate after remediation

| ID | Result |
| --- | --- |
| P1-01 … P1-12 | **GO** for contractor Phase 1 skeleton (with residual: live OpenHands catalog E2E and real-browser download depend on local toolchain/network) |

---

*End of Phase 10 QA report.*
