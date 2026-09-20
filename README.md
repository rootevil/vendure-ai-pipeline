# vendure-ai-pipeline

Contractor-owned workspace for a reusable autonomous engineering and validation pipeline targeting Vendure.

## Phase 1 skeleton

TypeScript control plane with swappable agent and validator interfaces. Default agent mode is `mock` (no LLM). Set `PIPELINE_AGENT_MODE=openhands` to invoke the OpenHands CLI. The **validator**, not the agent, decides `PASS` / `BLOCK`.

```bash
npm install
npm run format
npm run typecheck
npm test
npm run pipeline -- run --task fixtures/tasks/public-catalog.json
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
- `test/` — unit tests for core logic
- `fixtures/tasks/` — sample machine-readable task definitions
- `docker/` — Dockerfile + Compose stack (Postgres, Redis, pipeline runner)
- `scripts/` — start/stop/check/cleanup helpers
- `docs/` — client briefing and architecture notes
- `evaluation-demo/` — mirrored public demo (reference only)

Do not connect this repository to production, private client systems, or unrestricted minipc access.
