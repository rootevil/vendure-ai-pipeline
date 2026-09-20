# Public Vendure catalog scenario (Phase 8)

Representative end-to-end demonstration using **only** the public `evaluation-demo/` materials. This is **not** the client’s full Vendure migration.

## What it exercises

```
task → Agent → code change → demo app startup
  → health / HTTP / GraphQL / browser / state validation
  → evidence pack → PASS | BLOCK
```

Reuses:

- `evaluation-demo/task.md` goal and fixture contract
- `evaluation-demo/app/fixtures/legacy-catalog.json`
- `evaluation-demo/app/tests/acceptance.test.mjs`
- `evaluation-demo/expected-results/reference-catalog.mjs` (Agent applies this adapter)
- `evaluation-demo/app/src/catalog.incomplete.mjs` (isolated starting point)

## Reproduce from a clean checkout

```bash
npm install
npm run typecheck
npm test
npm run scenario:public-catalog
```

Expected stdout includes `"status": "PASS"` and paths under `runs/<runId>/` (or the temp root used by the scenario runner). Open:

- `summary.html` — human-readable why PASS/BLOCK
- `result.json` — machine-readable verdict
- `validation.json` — independent check results
- `evidence-manifest.json` — file catalog
- `api-responses/` and `screenshots/` — when network/browser checks ran

Optional flags:

```bash
npm run scenario:public-catalog -- --keep-workspace
npm run scenario:public-catalog -- --real-browser   # requires Playwright browsers installed
```

## Boundary

- Isolated evaluation environment only (local temp workspace + localhost demo server)
- No private client repos, minipc, production, or secrets
- Independent validator decides PASS/BLOCK; Agent claimed success is ignored
