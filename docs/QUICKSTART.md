# Quickstart

Goal: a new developer can clone, configure, start Docker, run the pipeline, run demos, inspect evidence, and reproduce failure/recovery — using only what is implemented today.

## Prerequisites

- Node.js **≥ 20**
- npm (lockfile present — prefer `npm ci`)
- Docker Engine + Compose v2 (or Colima on macOS — see [DOCKER_SETUP.md](./DOCKER_SETUP.md))
- Optional: Playwright Chromium for real-browser checks (`npx playwright install chromium`)

## 1. Clone and install

```bash
git clone <repo-url> vendure-ai-pipeline
cd vendure-ai-pipeline
npm ci
npm run typecheck
npm test
```

`postinstall` may attempt Playwright browser install. To skip: `PIPELINE_SKIP_PLAYWRIGHT_INSTALL=1 npm ci`.

## 2. Configure environment

```bash
cp .env.example .env
# For Docker stack placeholders:
cp .env.docker.example .env.docker   # created automatically by start.sh if missing
```

Do **not** put production secrets, API keys, or private tokens in these files. See [CONFIGURATION.md](./CONFIGURATION.md).

Useful defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PIPELINE_AGENT_MODE` | `mock` | No LLM required |
| `PIPELINE_ARTIFACTS_DIR` | `./runs` | Evidence root (`runs/<runId>/`) |
| `PIPELINE_ALLOW_NETWORK` | `false` | Validator HTTP denied unless scenario enables loopback |
| `PIPELINE_WRITE_ALLOWLIST` | `src,app,evaluation-demo/app` | Host config allowlist (tasks also declare their own) |

## 3. Start Docker, then run the client demo

```bash
docker compose up -d
npm run pipeline -- tasks/demo-task.yaml
```

Expected stdout:

```text
[PIPELINE] Task received
[COMPILER] Creating acceptance criteria
[AGENT] Starting isolated workspace
[AGENT] Inspecting repository
[AGENT] Implementing changes
[VALIDATOR] Running API checks
[VALIDATOR] Running Playwright
[VALIDATOR] Checking database
[EVIDENCE] Collecting artifacts
[RESULT] PASS
```

Evidence lands under `runs/<runId>/` (`final-report.html` and the rest of the package). Postgres and Redis come up with Compose; the demo task itself uses the isolated public-catalog surface (loopback), not production.

`docker compose` reads the root `compose.yaml`, which includes `docker/compose.yaml` (internal network, no host ports). Equivalent: `./scripts/start.sh`.

Stop / wipe:

```bash
docker compose down          # keep volumes
./scripts/cleanup.sh         # remove disposable volumes
```

## 4. Run the pipeline (JSON task)

```bash
npm run pipeline -- run --task fixtures/tasks/hello-change.json
```

Exit code `0` ≈ validator `PASS` (or baseline expected block when applicable). Output JSON includes `artifactDir`.

Built-in fixtures include:

- `fixtures/tasks/hello-change.json` — tiny workspace change
- `fixtures/tasks/nail-patterns-path-invariant.json` — used by nail-patterns scenario
- `fixtures/tasks/stack-deps-health.json` — Redis/Postgres probes (intended inside Compose)

## 5. Run demonstrations

Deliberate client demos (not hard-coded PASS):

```bash
npm run demo:success
npm run demo:recovery
npm run demo:block
```

`demo:success` is Task → Agent → Tests → Browser → API → DB → PASS.  
`demo:recovery` is Task → Agent → Failure → Diagnosis → Fix → Retest → PASS.  
`demo:block` is Failure → retries exhausted → circuit breaker → BLOCK → evidence.

### Public catalog (primary Phase 1 demo)

Applies the published reference catalog adapter inside an isolated copy of `evaluation-demo`, starts a local demo server, and runs health/API/GraphQL/browser/state checks.

```bash
npm run scenario:public-catalog
# equivalent host entry:
./scripts/start.sh --task evaluation-demo/task.md
```

Notes:

- Default agent is a **scenario agent** (copies reference adapter) — not a live OpenHands coding session.
- Browser checks use a **fake Playwright launcher** unless `PIPELINE_USE_REAL_BROWSER=1` (and Chromium is installed).
- Evidence lands under `artifacts/<runId>/` when using `--task` / `rootDir=cwd`.

### Public evaluation-demo scripts (baseline / reference)

Tree `evaluation-demo/app/src/catalog.mjs` is the **incomplete** starter.

```bash
node evaluation-demo/scripts/run-demo.mjs          # reference PASS in a temp copy
bash evaluation-demo/scripts/verify.sh --baseline  # expect BASELINE_BLOCKED_EXPECTED
```

Acceptance against the incomplete tree is expected to **BLOCK** until the adapter is fixed (the catalog scenario does that in an isolated workspace).

### Nail-patterns path invariants

```bash
npm run scenario:nail-patterns
```

### Failure / recovery

```bash
npm run scenario:failure-recoverable     # autonomous debugging → one repair → PASS
    npm run scenario:autonomous-debugging    # alias of failure-recoverable
    npm run scenario:failure-unrecoverable   # unsafe → BLOCK, no repair
```

See [FAILURE_DEMO.md](./FAILURE_DEMO.md).

## 6. Inspect evidence

Each run writes under `runs/<runId>/` (default `PIPELINE_ARTIFACTS_DIR=./runs`). Typical client layout:

| File / dir | Purpose |
| --- | --- |
| `task.json` | Exact task executed |
| `scenario.json` | Technical scenario / validation plan |
| `execution.log` | Attempt timeline + stdout/stderr |
| `agent.log` | Agent attempt log |
| `git-diff.patch` | Workspace patch |
| `validation.json` | Independent checks (expected vs actual) |
| `api/` · `graphql/` · `screenshots/` · `playwright/` · `database/` | Typed evidence |
| `recovery.json` | Retries / circuit break / rollback summary |
| `rollback.md` / `rollback-outcome.json` | Phase 1 preserve-or-restore outcome |
| `final-report.html` | Answers WHAT WAS REQUESTED? … FINAL RESULT? |

Also present for compatibility: `status.json`, `result.json`, `summary.html`, `evidence-manifest.json`, `validator-verdict.json`, `api-responses/`. Details: [EVIDENCE_PACKAGE.md](./EVIDENCE_PACKAGE.md).

Re-validate artifacts only (ignores agent prose; requires check JSON for `PASS`):

```bash
node packages/validator/bin/validate.mjs --run-dir runs/<run_id>
```

## 7. Understand PASS / BLOCK

| Status | Meaning | Typical exit |
| --- | --- | --- |
| `PASS` | Independent checks + required evidence succeeded | 0 |
| `BLOCK` | Checks failed, evidence missing, or unsafe stop | 1 |
| `BASELINE_BLOCKED_EXPECTED` | Baseline mode correctly observed failing acceptance | 0 |
| `AUTH_REQUIRED` | Missing credential — stop, do not retry | 2 |
| `CLIENT_DECISION` | Business ambiguity — stop for the client | 1 |

**The agent never decides PASS.** Agent `claimedSuccess` is recorded and ignored for the verdict. Details: [VALIDATION.md](./VALIDATION.md).

## 8. Reproduce failure / recovery

```bash
npm run scenario:failure-recoverable
# Inspect printed artifactDir → failure-demo.json timeline
npm run scenario:failure-unrecoverable
```

Expect recoverable: `PASS` after one repair. Unrecoverable: `BLOCK` with `repairAttempts: 0`.

## Next reading

- [TASK_CARD.md](./TASK_CARD.md) — business goal cards  
- [SCENARIO_COMPILER.md](./SCENARIO_COMPILER.md) — business → technical-task.json  
- [BROWSER_VALIDATION.md](./BROWSER_VALIDATION.md) — Playwright storefront → checkout demo  
- [GRAPHQL_API_VALIDATION.md](./GRAPHQL_API_VALIDATION.md) — independent Shop API evidence after browser  
- [DATABASE_VALIDATION.md](./DATABASE_VALIDATION.md) — controlled order SQL expected vs actual  
- [AUTONOMOUS_DEBUGGING.md](./AUTONOMOUS_DEBUGGING.md) — deliberate failure → recover → validate  
- [RETRY_POLICY.md](./RETRY_POLICY.md) — classified retries, MAX_RETRIES=3, circuit break  
- [EVIDENCE_PACKAGE.md](./EVIDENCE_PACKAGE.md) — runs/<id>/ layout and final-report.html  
- [ROLLBACK.md](./ROLLBACK.md) — git checkpoint → preserve / restore  
- [ARCHITECTURE.md](./ARCHITECTURE.md) — as-built control loop  
- [CONFIGURATION.md](./CONFIGURATION.md) — full env reference  
- [SAFETY.md](./SAFETY.md) — code-owned permissions, safe-stop, rollback  
- [LIMITATIONS.md](./LIMITATIONS.md) — honest non-claims  
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — common failures  
