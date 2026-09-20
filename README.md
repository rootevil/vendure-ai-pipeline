# vendure-ai-pipeline

Contractor-owned workspace for a reusable autonomous engineering and validation pipeline targeting Vendure.

## Phase 1 skeleton

TypeScript control plane with swappable agent and validator interfaces. The default agent is a noop stub (no complex AI behavior yet). The **validator**, not the agent, decides `PASS` / `BLOCK`.

```bash
npm install
npm run format
npm run typecheck
npm test
npm run pipeline -- run --task fixtures/tasks/public-catalog.json
```

Configuration is via environment variables (see `.env.example`). Do not commit secrets.

## Layout

- `src/` — pipeline controller, task schema, execution context, agent/validator interfaces, retry policy, evidence collector, CLI
- `test/` — unit tests for core logic
- `fixtures/tasks/` — sample machine-readable task definitions
- `docs/` — client briefing and architecture notes
- `evaluation-demo/` — mirrored public demo (reference only)

Do not connect this repository to production, private client systems, or unrestricted minipc access.
