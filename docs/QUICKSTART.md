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
| `PIPELINE_ARTIFACTS_DIR` | `./artifacts` | Evidence root |
| `PIPELINE_ALLOW_NETWORK` | `false` | Validator HTTP denied unless scenario enables loopback |
| `PIPELINE_WRITE_ALLOWLIST` | `src,app,evaluation-demo/app` | Host config allowlist (tasks also declare their own) |

## 3. Start Docker

```bash
# macOS + Colima example
colima start --cpu 2 --memory 4 --disk 20
export DOCKER_HOST=unix://$HOME/.colima/docker.sock

./scripts/start.sh
./scripts/check.sh
```

`start.sh` without `--task` builds/starts Postgres, Redis, and the pipeline keep-alive container on an **internal** Compose network (no egress, no host ports). Details: [DOCKER_SETUP.md](./DOCKER_SETUP.md).

Stop / wipe:

```bash
./scripts/stop.sh      # keep volumes
./scripts/cleanup.sh   # remove disposable volumes
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
npm run scenario:failure-recoverable     # detect → one repair → PASS
npm run scenario:failure-unrecoverable   # unsafe → BLOCK, no repair
```

See [FAILURE_DEMO.md](./FAILURE_DEMO.md).

## 6. Inspect evidence

Each run writes under `artifacts/<runId>/` (or a temp directory printed in JSON). Typical files:

| File | Purpose |
| --- | --- |
| `status.json` | Machine status (`PASS` / `BLOCK` / …) |
| `run-manifest.json` | Run metadata |
| `result.json` / `report.json` | Validator-oriented result / execution report |
| `validation.json` / `validation-results.json` | Per-check expected vs actual |
| `stdout.log` / `stderr.log` | Redacted agent/process logs |
| `change-summary.md` / `diff.patch` | Change summary |
| `rollback.md` | How to discard the disposable workspace |
| `summary.html` | Human-readable summary |
| `evidence-manifest.json` | Catalog of evidence files |
| `workspace-checkpoint/` | Pre-agent filesystem snapshot (when created) |

Re-validate artifacts only (ignores agent prose; requires check JSON for `PASS`):

```bash
node packages/validator/bin/validate.mjs --run-dir artifacts/<run_id>
```

## 7. Understand PASS / BLOCK

| Status | Meaning | Typical exit |
| --- | --- | --- |
| `PASS` | Independent checks + required evidence succeeded | 0 |
| `BLOCK` | Checks failed, evidence missing, or unsafe stop | 1 |
| `BASELINE_BLOCKED_EXPECTED` | Baseline mode correctly observed failing acceptance | 0 |
| `AUTH_REQUIRED` | Agent/control plane reported auth gap | 1 |

**The agent never decides PASS.** Agent `claimedSuccess` is recorded and ignored for the verdict. Details: [VALIDATION.md](./VALIDATION.md).

## 8. Reproduce failure / recovery

```bash
npm run scenario:failure-recoverable
# Inspect printed artifactDir → failure-demo.json timeline
npm run scenario:failure-unrecoverable
```

Expect recoverable: `PASS` after one repair. Unrecoverable: `BLOCK` with `repairAttempts: 0`.

## Next reading

- [TASK_CARD.md](./TASK_CARD.md) — business goal → machine metrics  
- [ARCHITECTURE.md](./ARCHITECTURE.md) — as-built control loop  
- [CONFIGURATION.md](./CONFIGURATION.md) — full env reference  
- [SAFETY.md](./SAFETY.md) — code-owned permissions, safe-stop, rollback  
- [LIMITATIONS.md](./LIMITATIONS.md) — honest non-claims  
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — common failures  
