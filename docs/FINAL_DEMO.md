# Final demonstration (Phase 1 clean-room rehearsal)

Evaluator-facing script. Every command below was executed successfully in a rehearsal on this repository. Claims are limited to what these commands prove.

## What this demo proves

| Step | Proven by |
| --- | --- |
| Natural-language task card | `evaluation-demo/task.md` |
| Convert to structured task | Known mapping → `fixtures/tasks/vendure-public-catalog-e2e.json` |
| Isolated run + agent + validation + evidence + PASS | `./scripts/start.sh --task evaluation-demo/task.md` |
| Independent re-check of evidence | `packages/validator/bin/validate.mjs` |
| Controlled failure (incomplete starter) | `evaluation-demo/scripts/verify.sh --baseline` |
| Bounded recovery / autonomous debugging → PASS | `npm run scenario:autonomous-debugging` |
| Unrecoverable → BLOCK | `npm run scenario:failure-unrecoverable` |
| Final report | `artifacts/<runId>/report.md` (+ `summary.html`) |
| Cleanup | `./scripts/cleanup.sh` |

## What this demo does **not** prove

- Arbitrary free-form natural language → task (only the published `evaluation-demo/task.md` card maps in Phase 1).
- Live OpenHands / LLM coding (catalog path uses the **public-catalog scenario agent**, which applies the published reference adapter).
- Real Chromium (default browser check uses the fake Playwright launcher; set `PIPELINE_USE_REAL_BROWSER=1` only after `npx playwright install chromium`).
- Full Vendure Shop/Admin, Stripe, Mailpit, or production/minipc access.
- Cryptographic evidence signing.

See [LIMITATIONS.md](./LIMITATIONS.md).

## Prerequisites (any clean machine)

| Requirement | Notes |
| --- | --- |
| Git | Clone this repository |
| Node.js ≥ 20 + npm | Prefer `npm ci` |
| Docker Engine + Compose v2 | Or Colima on macOS ([DOCKER_SETUP.md](./DOCKER_SETUP.md)) |
| Credentials | **None** for the default demo (`PIPELINE_AGENT_MODE=mock` / scenario agent) |

No private tokens, `.env` secrets, or hidden local-only files are required. Templates: `.env.example`, `.env.docker.example` (placeholders only; `start.sh` copies `.env.docker` if missing).

Optional: `PIPELINE_SKIP_PLAYWRIGHT_INSTALL=1` if browser download is unwanted.

---

## Clean-room script (reproduce in order)

Replace `<repo-url>` with the clone URL. Run from a fresh directory.

### 0. Clone and install

```bash
git clone <repo-url> vendure-ai-pipeline
cd vendure-ai-pipeline

PIPELINE_SKIP_PLAYWRIGHT_INSTALL=1 npm ci
npm run typecheck
npm test
```

Expected: typecheck exit 0; tests pass (rehearsal: **63** passing).

### 1. Submit a natural-language task

Human card (committed in-repo):

```bash
sed -n '1,40p' evaluation-demo/task.md
```

This is the only Phase 1 markdown card with a built-in scenario compiler mapping.

### 2. Convert it into a structured task

```bash
node --import tsx -e "
import { loadTaskDefinitionFromPath } from './src/task/task-card.ts';
const t = loadTaskDefinitionFromPath('evaluation-demo/task.md');
console.log(JSON.stringify({
  from: 'evaluation-demo/task.md',
  structuredTaskId: t.id,
  title: t.title,
  mode: t.mode,
  writeAllowlist: t.writeAllowlist,
  validationStepIds: t.validationSteps.map((s) => s.id),
  requiredEvidence: t.requiredEvidence,
  sourcePaths: t.sourcePaths,
}, null, 2));
"
```

Expected: `structuredTaskId` = `vendure-public-catalog-e2e`, companion file `fixtures/tasks/vendure-public-catalog-e2e.json`, `sourcePaths` includes `evaluation-demo/task.md`.

### 3. Start Docker (isolated stack) then an isolated task run

macOS + Colima (if applicable):

```bash
colima start --cpu 2 --memory 4 --disk 20
export DOCKER_HOST=unix://$HOME/.colima/docker.sock
```

```bash
./scripts/start.sh
./scripts/check.sh
```

Expected: Postgres, Redis, and pipeline container healthy on the **internal** Compose network.

Isolated catalog run (disposable workspace under `workspace/`, evidence under `artifacts/`):

```bash
rm -rf artifacts workspace
mkdir -p artifacts workspace
./scripts/start.sh --task evaluation-demo/task.md
```

Expected JSON on stdout (example from rehearsal):

```json
{
  "status": "PASS",
  "exitCode": 0,
  "artifactDir": ".../artifacts/catalog-<runId>",
  "runId": "catalog-<runId>"
}
```

Note: `--task` runs on the **host** via `scripts/run-task.sh` (scenario path). The Compose stack is the Docker isolation demonstration; it is not required for the catalog scenario itself, but is part of the Phase 1 clean-room sequence.

### 4. Show agent execution

```bash
RUN=$(ls -1t artifacts | head -1)
cat "artifacts/$RUN/attempts.json"
cat "artifacts/$RUN/stdout.log"
```

Rehearsal showed agent `public-catalog-scenario-agent` applying the reference adapter (`CATALOG_ADAPTER_APPLIED`), with `agentClaimedSuccess: true` recorded in attempts.

Logs also print:

```text
pipeline run started ... agent=public-catalog-scenario-agent validator=independent
```

### 5. Show validation

```bash
cat "artifacts/$RUN/validation-results.json" | head -c 2500
ls "artifacts/$RUN/validation/"
```

Rehearsal checks included: `evidence`, `adapter-changed`, `health`, `api-products`, `graphql-products`, `browser-catalog`, `db-state`, plus acceptance tests — all `PASS`.

### 6. Show collected evidence

```bash
ls -la "artifacts/$RUN/"
cat "artifacts/$RUN/evidence-manifest.json"
cat "artifacts/$RUN/change-summary.md"
cat "artifacts/$RUN/rollback.md"
```

Typical files: `status.json`, `run-manifest.json`, `report.md`, `report.json`, `summary.html`, `summary.md`, `validation.json`, `validation-results.json`, `diff.patch` / `git.diff`, `screenshots/`, `api-responses/`, `workspace-checkpoint/`.

### 7. Show independent PASS / BLOCK decision

Pipeline status (machine):

```bash
cat "artifacts/$RUN/status.json"
cat "artifacts/$RUN/validator-verdict.json"
```

Human summary (notes that agent claim is ignored):

```bash
cat "artifacts/$RUN/summary.md"
```

Artifact-only re-validation (ignores agent prose; requires check JSON):

```bash
node packages/validator/bin/validate.mjs --run-dir "artifacts/$RUN"
```

Expected: `"status": "PASS"`, exit code `0`.

### 7b. Playwright browser checkout (visually obvious)

```bash
npm run scenario:browser-checkout
# Real Chromium screenshots: npm run scenario:browser-checkout -- --real-browser
```

Expect numbered shots, GraphQL `api-responses/`, and controlled DB evidence (`database-order-by-code`). Details: [BROWSER_VALIDATION.md](./BROWSER_VALIDATION.md), [GRAPHQL_API_VALIDATION.md](./GRAPHQL_API_VALIDATION.md), [DATABASE_VALIDATION.md](./DATABASE_VALIDATION.md).

### 8. Demonstrate one controlled failure

Incomplete starter in the tree (`catalog.mjs` returns empty) must fail acceptance tests:

```bash
bash evaluation-demo/scripts/verify.sh --baseline
```

Expected: `"status": "BASELINE_BLOCKED_EXPECTED"`, process exit `0` (baseline correctly blocked). Acceptance test output shows empty actual vs expected products.

### 9. Demonstrate autonomous debugging (recoverable)

```bash
npm run scenario:autonomous-debugging
# or: npm run scenario:failure-recoverable
```

Expected: `"status": "PASS"`, `"repairAttempts": 1`, exit `0`.  
Deliberate failure: expected products on storefront vs buggy catalog leaking inactive items.

```bash
cat "<artifactDir>/failure-demo.json"
ls "<artifactDir>/failed-state/"
```

Timeline must include: deliberate failure → capture logs / preserve failed state → classify → agent investigates → smallest fix → targeted reproducer → regression independent validation → `PASS`.

Details: [AUTONOMOUS_DEBUGGING.md](./AUTONOMOUS_DEBUGGING.md).

### 10. Demonstrate unrecoverable failure → BLOCK

```bash
npm run scenario:failure-unrecoverable
```

Expected: `"status": "BLOCK"`, `"repairAttempts": 0`, exit `1`.

```bash
cat "<artifactDir>/failure-demo.json"
cat "<artifactDir>/status.json"
```

Timeline: detect unsafe / secret-like pattern → classify → stop without repair → `BLOCK`.

### 11. Show the final run report

From the catalog PASS run:

```bash
cat "artifacts/$RUN/report.md"
open "artifacts/$RUN/summary.html"   # or open the file in a browser
```

`report.md` lists goal, criteria, changed files, per-check expected vs actual, and the independent verdict.

### 12. Show cleanup

```bash
export DOCKER_HOST=unix://$HOME/.colima/docker.sock   # if using Colima
./scripts/cleanup.sh
```

Expected: containers and named disposable volumes removed; Compose project empty.

Host evidence under `./artifacts/` is **not** deleted by `cleanup.sh` (reviewable). Remove manually if desired:

```bash
rm -rf artifacts workspace
```

---

## Minimal command index (copy/paste)

```bash
git clone <repo-url> vendure-ai-pipeline && cd vendure-ai-pipeline
PIPELINE_SKIP_PLAYWRIGHT_INSTALL=1 npm ci && npm run typecheck && npm test

# optional Docker isolation
colima start --cpu 2 --memory 4 --disk 20   # macOS Colima
export DOCKER_HOST=unix://$HOME/.colima/docker.sock
./scripts/start.sh && ./scripts/check.sh

# NL → structured (inspect mapping)
node --import tsx -e "import { loadTaskDefinitionFromPath } from './src/task/task-card.ts'; console.log(JSON.stringify(loadTaskDefinitionFromPath('evaluation-demo/task.md'), null, 2));"

# main PASS path
rm -rf artifacts workspace && mkdir -p artifacts workspace
./scripts/start.sh --task evaluation-demo/task.md
RUN=$(ls -1t artifacts | head -1)
cat artifacts/$RUN/status.json artifacts/$RUN/summary.md artifacts/$RUN/report.md
node packages/validator/bin/validate.mjs --run-dir artifacts/$RUN

# controlled failure + recovery + unrecoverable
bash evaluation-demo/scripts/verify.sh --baseline
npm run scenario:failure-recoverable
npm run scenario:failure-unrecoverable

# cleanup stack
./scripts/cleanup.sh
```

## Rehearsal record (this workspace)

| Check | Result |
| --- | --- |
| `npm ci` / typecheck / test | Pass (63 tests) |
| Docker `start` + `check` | Pass |
| `start.sh --task evaluation-demo/task.md` | `PASS` (`catalog-1789953123534`) |
| `validate.mjs` on that run | `PASS` exit 0 |
| `verify.sh --baseline` | `BASELINE_BLOCKED_EXPECTED` exit 0 |
| `scenario:failure-recoverable` | `PASS`, `repairAttempts: 1` |
| `scenario:failure-unrecoverable` | `BLOCK`, `repairAttempts: 0`, exit 1 |
| `cleanup.sh` | Volumes/containers removed |

## Related docs

- [QUICKSTART.md](./QUICKSTART.md)  
- [VALIDATION.md](./VALIDATION.md)  
- [FAILURE_DEMO.md](./FAILURE_DEMO.md)  
- [DELIVERY_CHECKLIST.md](./DELIVERY_CHECKLIST.md)  
