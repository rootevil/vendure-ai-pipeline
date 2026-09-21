# vendure-ai-pipeline

Contractor-owned workspace for a reusable autonomous engineering and validation pipeline targeting Vendure.

## Phase 1 skeleton

TypeScript control plane with swappable agent and validator interfaces. Default agent mode is `mock` (no LLM). Set `PIPELINE_AGENT_MODE=openhands` to invoke the OpenHands CLI. The **validator**, not the agent, decides `PASS` / `BLOCK`.

```bash
npm install
npm run format
npm run typecheck
npm test
npm run pipeline -- run --task fixtures/tasks/hello-change.json
```

For real Playwright browser checks: `npx playwright install chromium` (also attempted in `postinstall`; set `PIPELINE_SKIP_PLAYWRIGHT_INSTALL=1` to skip).

## Public Vendure catalog scenario (Phase 8)

Reproducible end-to-end demo using only `evaluation-demo/` (not the full client migration):

```bash
npm run scenario:public-catalog
# or: ./scripts/start.sh --task evaluation-demo/task.md
```

See [docs/PUBLIC_CATALOG_SCENARIO.md](docs/PUBLIC_CATALOG_SCENARIO.md).

## Nail-patterns path invariant (P1-10)

```bash
npm run scenario:nail-patterns
```

## Failure demonstration (Phase 9)

```bash
npm run scenario:failure-recoverable    # detect → repair → PASS
npm run scenario:failure-unrecoverable  # unsafe → BLOCK, no repair
```

See [docs/FAILURE_DEMO.md](docs/FAILURE_DEMO.md).

## Independent validator CLI

```bash
node packages/validator/bin/validate.mjs --run-dir artifacts/<run_id>
```

Configuration is via environment variables (see `.env.example`). Do not commit secrets.

## Isolated Docker environment

```bash
./scripts/start.sh
./scripts/check.sh
./scripts/stop.sh
./scripts/cleanup.sh   # wipe disposable volumes for a fresh state
```

See [docs/DOCKER_SETUP.md](docs/DOCKER_SETUP.md).

## Layout

- `src/` — pipeline controller, task schema, execution context, agent/validator interfaces, retry policy, evidence collector, CLI
- `packages/` — Architecture package surfaces (`validator` CLI, plus evidence/safety/scenario/agent-adapter shims)
- `test/` — unit tests for core logic
- `fixtures/tasks/` — sample machine-readable task definitions
- `docker/` — Dockerfile + Compose stack (Postgres, Redis, pipeline runner)
- `scripts/` — start/stop/check/cleanup helpers
- `docs/` — client briefing and architecture notes
- `evaluation-demo/` — mirrored public demo (reference only)
- `.github/workflows/pipeline.yml` — `workflow_dispatch` entry

Do not connect this repository to production, private client systems, or unrestricted minipc access.
