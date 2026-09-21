# Phase 1 Scope

Prepared after reading the four client public documents under `docs/` and the mirrored `evaluation-demo/` package. This is the contractor Phase 1 delivery boundary. It is **not** formal client final acceptance and **not** a promise to complete the full Vendure Batch 1 + Batch 2 migration inside Phase 1.

## 1. Phase 1 goal

Deliver a **reusable, Docker-first autonomous engineering and validation pipeline skeleton** that:

1. accepts a plain-language task card for a **bounded** change;
2. expands it into machine-checkable stages;
3. executes coding/debugging/tests inside an **isolated** workspace;
4. retries only **recoverable** failures within a hard budget;
5. stops safely with reviewable evidence on missing auth, identity, or repeated failure;
6. lets an **independent validator** decide `PASS` / `BLOCK` (never the agent self-report).

The public evaluation demo is the first proving ground. After that, Phase 1 must demonstrate the same control loop against one **longer but still bounded** task derived from the sanitized migration-input package (path-aware / fixture-aware work), without requiring private repos, minipc, or production.

## 2. Required for Phase 1

| ID | Requirement | Evidence of done |
| --- | --- | --- |
| P1-01 | Reproducible Linux runner via `Dockerfile` + `compose.yaml` (or equivalent), network-isolated by default for public/demo modes | Image builds; compose up/down; `network_mode: none` or documented allowlist |
| P1-02 | No-secret `.env.example`, pinned dependency lockfiles, start/stop/check/cleanup scripts | Scripts exit non-zero on health failure; cleanup removes temp workspaces |
| P1-03 | Task-card entry: human goal → scenario / stage manifest (preconditions, actions, expected checks, cleanup, circuit-break rules) | Manifest schema + fixture example derived from `evaluation-demo/task.md` |
| P1-04 | Isolated workspace checkout per run (temp dir / container volume); agent cannot write outside allowlisted paths | Path-guard tests; rollback notes |
| P1-05 | Coding worker integration (reuse OpenHands or equivalent OSS agent runtime; do not invent a second agent framework) | Documented adapter; one end-to-end coding run on the public catalog task |
| P1-06 | Bounded retry policy (classify failure; max identical retries; escalate to `BLOCK` / `AUTH_REQUIRED`) | Retry counters in run manifest; circuit-break unit tests |
| P1-07 | Independent validator deriving `PASS` / `BLOCK` / `BASELINE_BLOCKED_EXPECTED` from artifacts only | Validator CLI; agent prose ignored |
| P1-08 | Evidence bundle per run: run id, manifest, status, stdout/stderr, diff/change summary, rollback notes | Compatible with demo `results/<run_id>/` shape |
| P1-09 | Prove public demo: reference PASS, baseline expected block, acceptance PASS after adapter fix | Commands in §6 |
| P1-10 | One additional bounded fixture/path task using `evaluation-demo/assets/nail-patterns/` or `migration-input` paths **without** flattening/renaming | Validator checks relative-path invariants |
| P1-11 | GitHub Actions `workflow_dispatch` entry (contractor-owned repo) that starts an isolated job and uploads evidence artifacts | Workflow YAML; no secrets in logs |
| P1-12 | Explicit security boundary: no production, no private client credentials, no unrestricted minipc/SSH | Documented in README + architecture |

### Phase 1 acceptance gate (contractor-internal)

Phase 1 is complete when **all of P1-01…P1-12** pass on the contractor account/repo, with immutable commit SHA and evidence archive. This maps to the client’s **public hands-on + pipeline skeleton** stage. It does **not** satisfy the client’s post-contract **three long-chain capability gate**.

## 3. Useful for Phase 2 (explicitly deferred)

These are valuable and aligned with the client’s eventual contract, but **out of Phase 1 delivery**:

- Full OpenHands/Buzz multi-role orchestration (PM, architecture, backend, frontend, DB, security, load) as permanent processes
- Real Vendure storefront/admin Playwright journeys (homepage → search → cart → Stripe test → wallet)
- GraphQL Shop/Admin identity + channel locking assertions against a live Vendure stack
- PostgreSQL / TypeORM migration apply + clean-db / rollback verification on a real DB
- Redis / BullMQ job observation
- Stripe test-mode MCP / Mailpit email evidence
- Load testing (k6/artillery) and authorized red-team (semgrep/trivy/sqlmap) lanes
- Client Terminal Computer Adapter / minipc allowlisted adapters
- Owner-controlled Acceptance Manifest freeze + private `vendure-evaluation-input` runs
- Three long-chain tasks (Batch 1 + Batch 2 + owner-confirmed third) — **framework prepared** as `tasks/task-01.yaml` … `task-03.yaml` with a shared runner ([LONG_CHAIN_TASKS.md](./LONG_CHAIN_TASKS.md)); formal gate PASS still deferred
- Post-delivery unlimited in-scope tuning until full Batch 1+2 migration reliability
- Terraform for ephemeral cloud runners (optional; Docker-local is enough for Phase 1)
- skill-doctor retrospective loop

## 4. Explicitly out of scope (all phases unless written change order)

- Performing the **full** client Vendure migration as human labor (client owns migration; pipeline assists)
- Accounting-related and WorldFirst-related functionality
- Coupons / marketing marked to-be-developed
- Production deployment, production data, live payment rails
- Unrestricted minipc, SSH, Docker socket on client host, or shared self-hosted runner with secrets
- Committing secrets, tokens, or private keys
- Treating PR merge, green CI alone, HTTP 200, screenshot alone, or model “done” as PASS
- Write access to client `main` or private repos without contract
- Guaranteeing performance outside the declared environment/workload

## 5. Realistic Phase 1 outcomes vs client contract language

| Client expectation (full contract) | Phase 1 stance |
| --- | --- |
| Autonomous complete Batch 1+2 migration | Deferred to Phase 2+ after private inputs |
| 3 long-chain E2E capability gate | Deferred; Phase 1 proves control loop on public/sanitized tasks |
| Payment after final acceptance only | Commercial; Phase 1 is contractor prep / optional paid spike |
| Unlimited in-scope tuning | Not started until Phase 2 delivery package exists |

## 6. Milestone verification commands

### Milestone A — Public demo intact

```bash
node evaluation-demo/scripts/run-demo.mjs
bash evaluation-demo/scripts/verify.sh --baseline
# After implementing evaluation-demo/app/src/catalog.mjs in this clone:
bash evaluation-demo/scripts/verify.sh --acceptance
```

### Milestone B — Runner package

```bash
docker compose -f docker/compose.yaml build
docker compose -f docker/compose.yaml run --rm pipeline check
docker compose -f docker/compose.yaml down -v
```

### Milestone C — Validator decides

```bash
# Agent may claim success; only validator exit code matters
node packages/validator/bin/validate.mjs --run-dir artifacts/<run_id>
```

### Milestone D — Isolated task run (catalog)

```bash
./scripts/start.sh --task evaluation-demo/task.md
./scripts/check.sh   # optional: Docker stack health (Postgres/Redis)
./scripts/cleanup.sh
```

### Milestone E — workflow_dispatch smoke

```bash
gh workflow run pipeline.yml -f task=evaluation-demo/task.md
gh run watch
gh run download --name evidence-<run_id>
```

### Additional Phase 1 path task (P1-10)

```bash
npm run scenario:nail-patterns
node packages/validator/bin/validate.mjs --run-dir artifacts/$(ls -1t artifacts | head -1)
```
