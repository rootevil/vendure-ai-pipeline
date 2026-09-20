# Reuse Analysis

Study of the mirrored public `evaluation-demo/` package and client documents, with a reuse-first stance: **do not rebuild existing open-source capabilities.**

## 1. What the evaluation demo already proves

The demo is a miniature of the full acceptance model:

| Concept | Demo location | Reuse decision |
| --- | --- | --- |
| Bounded NL task | `evaluation-demo/task.md` | Keep as Phase 1 scenario fixture; generalize schema later |
| Fixed input | `app/fixtures/legacy-catalog.json` | Keep; pattern for pinned fixtures |
| Incomplete starter → expected BLOCK | `app/src/catalog.mjs` returns `[]` | Keep baseline mode semantics |
| Known-good reference | `expected-results/reference-catalog.mjs` | Keep for reference runs only |
| Assertions | `app/tests/acceptance.test.mjs` (node:test) | Keep Node test runner; do not replace with custom framework |
| Independent verify | `scripts/verify.mjs` | **Lift into** `packages/validator` + `packages/evidence` |
| Reference run in temp copy | `scripts/run-demo.mjs` | Reuse pattern for isolated execution |
| Docker isolation | `Dockerfile`, `compose.yaml` (`network_mode: none`) | **Extend** into repo-root `docker/` |
| Evidence bundle | `results/<run_id>/{run-manifest,status,stdout,stderr,diff,rollback,summary}` | **Canonical evidence shape** for Phase 1 |
| Image tree contract | `assets/nail-patterns/` (~200 files, nested sets) | Reuse as path-invariant tests; never flatten |
| Larger sanitized input | `migration-input/` (legacy snapshot, acceptance-inputs, fixtures) | Inspect/path experiments in Phase 1; not formal private acceptance |

## 2. Reusable as-is (copy/adapt with minimal change)

1. **Evidence file set** — `run-manifest.json`, `status.json`, `stdout.log`, `stderr.log`, `diff.patch`, `change-summary.md`, `rollback.md`, `summary.md`.
2. **Status vocabulary** — `PASS`, `BLOCK`, `BASELINE_BLOCKED_EXPECTED`.
3. **Baseline vs acceptance modes** — verifier exit 0 on expected baseline block.
4. **Temp-copy reference execution** — mutate only ephemeral trees.
5. **Compose network none** — default for no-secret public tasks.
6. **Node 20 Alpine base image** — aligns with client Node 20 baseline.
7. **Catalog migration rules** — slug, price_cents, image_count, SKU sort, no internalNote, no input mutation (reference implementation).

## 3. Reusable with generalization

| Demo piece | Generalization |
| --- | --- |
| `verify.mjs` hard-codes catalog test path | Parameterize: scenario points at test command + required artifacts |
| `git diff -- evaluation-demo` | Diff allowlisted workspace paths from scenario |
| Single test file | Scenario may list multiple commands (unit, path check) |
| Results under `evaluation-demo/results/` | Prefer top-level `artifacts/<run_id>/` (gitignore results) |

## 4. Do not rebuild — use existing OSS

| Capability | Prefer | Avoid |
| --- | --- | --- |
| Autonomous coding loop | OpenHands (or maintained peer) | Custom multi-agent OS |
| Browser E2E (Phase 2) | Playwright | Homegrown browser drivers |
| Containers | Docker / Compose | Bespoke isolation daemons |
| CI trigger | GitHub Actions `workflow_dispatch` | Custom always-on control plane |
| Unit tests | Node.js test runner (already used) | New test framework for demo |
| Schema validation | Zod / JSON Schema | Ad-hoc string checks only |
| Later GraphQL | graphql client / existing MCP | Hand-rolled GraphQL stack |
| Later load/security | k6, semgrep, trivy | Custom scanners |

Client docs list many historical MCP tools. Treat that catalog as a **capability registry**, not a purchase list. Phase 1 mounts only what the scenario requires.

## 5. Useful patterns from client docs (not code)

- Product Manager / scenario compiler before coding
- Plugin-first migration reasoning (Phase 2 Vendure work)
- Circuit-break conditions (credentials, irreversible ops, identity ambiguity)
- Delivery package checklist: Dockerfile, compose, pins, start/stop/check/cleanup, `.env.example`, permissions, digest
- GitHub as control/evidence surface; Linux as runtime

## 6. Not reusable / do not treat as production truth

- Public `migration-input/legacy/` as formal acceptance revision (sanitized clean-tree only)
- Historical host paths (`/home/zyy/...`, Windows WSL paths) as runtime contracts
- Any assumption that PR merge or demo PASS equals private final acceptance
- Full surrounding-software inventory as mandatory installs

## 7. Recommended reuse plan for implementation order

1. Keep `evaluation-demo/` intact as regression oracle.
2. Extract evidence + status logic from `verify.mjs` into shared packages without breaking demo scripts (demo can call shared package or remain a thin wrapper).
3. Promote `Dockerfile`/`compose.yaml` patterns to `docker/` with the same network-none default.
4. Add OpenHands adapter around an isolated workspace that still ends in the same validator.
5. Add a second scenario that only asserts nail-pattern directory invariants (structure/names), reusing validator + evidence packages.

## 8. Phase 1 vs Phase 2 reuse summary

| Asset | Phase 1 | Phase 2 |
| --- | --- | --- |
| Demo verifier/evidence | Required core | Keep as smoke |
| Docker network-none | Required | Relax with allowlist for live services |
| OpenHands | Required adapter | Expand roles/tools |
| nail-patterns tree | Path-invariant task | Feed publish/export E2E |
| migration-input docs/source | Read-only study + bounded path task | Compatibility inventory input |
| Playwright/Postgres/Stripe | Out | Required for long-chain gates |
