# Troubleshooting

## Install / Node

### `npm ci` fails

- Use Node ≥ 20 (`node -v`).  
- Delete `node_modules` and retry `npm ci`.  
- Corporate registry / offline: set `PIPELINE_SKIP_PLAYWRIGHT_INSTALL=1` if Playwright download fails.

### Playwright / real browser `Executable doesn't exist`

```bash
npx playwright install chromium
PIPELINE_USE_REAL_BROWSER=1 npm run scenario:public-catalog
```

Default demos use a fake browser launcher and do not need Chromium.

## Docker

### `Docker daemon is not reachable` / permission denied on socket

Colima:

```bash
colima start --cpu 2 --memory 4 --disk 20
export DOCKER_HOST=unix://$HOME/.colima/docker.sock
./scripts/start.sh
```

`docker-stack.sh` auto-exports Colima’s socket when present.

### `Timed out waiting for postgres to become healthy`

- Ensure daemon is up and not out of disk.  
- `./scripts/cleanup.sh` then `./scripts/start.sh`.  
- Inspect: `docker compose -f docker/compose.yaml --env-file .env.docker logs postgres`.

### Image build hung on `apt-get`

Transient mirror/network issue inside the build. Retry; or use a previously built `vendure-ai-pipeline:local` image with `docker compose … up -d --no-build` after verifying digests.

### `check.sh` fails when stack is down

Expected — exit non-zero. Start the stack first.

## Pipeline / tasks

### `Task definition is not valid JSON` on a `.md` file

Only known markdown cards compile (notably `evaluation-demo/task.md`). Other tasks must be JSON under `fixtures/tasks/` or include a companion `task.json` / `<!-- task-json: … -->` marker. See `src/task/task-card.ts`.

### `writeAllowlist must contain at least one relative path`

Tasks must declare a non-empty `writeAllowlist` (fail closed).

### HTTP / GraphQL checks fail with network disabled

Set scenario/`PIPELINE_ALLOW_NETWORK` appropriately. Host default is `false`. Catalog scenarios enable network for loopback in code.

### `URL host … is not in PIPELINE_NETWORK_ALLOWLIST`

Phase 1 SSRF guard. Use `127.0.0.1` / `localhost` or add an explicit host to `PIPELINE_NETWORK_ALLOWLIST` (avoid production).

### OpenHands `OPENHANDS_NOT_AVAILABLE` / timeout

Install OpenHands CLI, ensure `PIPELINE_OPENHANDS_COMMAND` is correct, and inject provider credentials outside scrubbed secret env keys — or stay on `PIPELINE_AGENT_MODE=mock`.

## Validation / evidence

### Artifact CLI blocks `PASS` without validation JSON

Intended. `validate.mjs` refuses forgeable PASS if `validation-results.json` / `validation.json` is missing. Re-run the pipeline to regenerate evidence.

### Baseline verify exits 1 with `BLOCK`

Tree `catalog.mjs` is incomplete by design. Baseline should report `BASELINE_BLOCKED_EXPECTED` via `verify.sh --baseline`. If you replaced `catalog.mjs` with the reference solution, restore from `catalog.incomplete.mjs`.

### Acceptance verify BLOCKs on the tree

Expected while `catalog.mjs` is incomplete. Use `npm run scenario:public-catalog` or `run-demo.mjs` for PASS paths.

### Cannot find `artifacts/`

Scenarios that use a temp `rootDir` print `artifactDir` in JSON. Host `--task` / cwd scenarios write under `./artifacts/`.

## Failure demos

### Recoverable demo does not PASS

Ensure you run `npm run scenario:failure-recoverable` (not the unrecoverable flag). Check `failure-demo.json` in the printed artifact directory for which step failed.

## GitHub Actions

### Workflow rejects task path

Only `evaluation-demo/task.md` or `fixtures/tasks/<safe-name>.json` are allowed.

## Still stuck

1. `npm test` and `npm run typecheck`  
2. `./scripts/check.sh` after a clean `./scripts/start.sh`  
3. Collect `artifacts/<runId>/summary.html` and `validation/*.json`  
4. Read [LIMITATIONS.md](./LIMITATIONS.md) before assuming a missing Phase 2 feature  
