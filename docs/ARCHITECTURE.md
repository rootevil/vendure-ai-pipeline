# Architecture (as-built Phase 1)

This document describes the **implemented** Phase 1 control plane. Earlier design notes that assumed `network_mode: none` or a full monorepo under `packages/` are updated here to match the repo.

Guiding rules still hold: Docker-first isolation for the stack, bounded retries, independent validation, evidence over narration, no production access, **validator (not the agent) decides PASS/BLOCK**.

## 1. Control loop

```text
1. Ingress
     CLI: vendure-pipeline run --task <task.json|task.md>
     or scenario scripts / start.sh --task …
2. Safety preflight
     Zod task parse + assertTaskSafe (allowlist, forbidden tools, URL/path rules)
3. Isolated workspace
     workspace/<runId>/ + artifacts/<runId>/
     optional workspace-checkpoint/ before agent
4. Agent (bounded)
     mock | openhands | scenario-specific adapters
     retries via RetryPolicy + circuit breaker
5. Independent validator
     runs validationSteps; ignores agent claimedSuccess
6. Evidence pack
     status, logs (redacted), diffs, validation JSON, summary.html, manifest
7. Cleanup
     optional workspace delete; Docker volumes via cleanup.sh
```

## 2. Components (where they live)

| Component | Location | Notes |
| --- | --- | --- |
| Task schema / safety | `src/task/` | JSON Zod schema; `task.md` → companion JSON for known cards |
| Pipeline controller | `src/controller/` | Agent loop, retries, handoff to validator |
| Task runner / CLI | `src/execution/`, `src/cli/` | End-to-end flow + `npm run pipeline` |
| Agents | `src/agent/` | `mock`, `openhands`, `noop` |
| Scenario agents | `src/scenarios/*/` | Catalog / nail-patterns / failure demos |
| Validator | `src/validator/` | Independent checks |
| Validator CLI | `packages/validator/bin/validate.mjs` | Artifact-only re-check |
| Evidence | `src/evidence/` | Bundle + finalize pack |
| Safety / redaction | `src/safety/` | Paths, checkpoints, secret redaction, URL allowlists |
| Retry | `src/retry/` | Failure kinds, budgets, circuit breaker |
| Docker runner | `docker/`, `scripts/docker-stack.sh` | Compose: pipeline + postgres + redis |
| GHA | `.github/workflows/pipeline.yml` | `workflow_dispatch`, allowlisted tasks |

`packages/{scenario,safety,evidence,agent-adapter}` are **layout shims** for the Architecture package map; implementation code is under `src/`.

## 3. Repository layout

```text
vendure-ai-pipeline/
  src/                 # Control plane implementation
  packages/validator/  # validate.mjs + restore-checkpoint.mjs
  fixtures/tasks/      # Sample JSON tasks
  docker/              # Dockerfile + compose.yaml (internal network)
  scripts/             # start/stop/check/cleanup + scenario runners
  evaluation-demo/     # Public demo (incomplete catalog.mjs in tree)
  artifacts/           # Default evidence (gitignored)
  test/
  docs/
  .github/workflows/pipeline.yml
```

## 4. Isolation model

| Surface | Isolation |
| --- | --- |
| Compose stack | `internal: true` bridge — no container egress, no published ports |
| Host CLI / `start.sh --task` | Process on host; disposable workspace dir; SSRF allowlist for validator HTTP |
| GHA | `ubuntu-latest`; task path allowlist; default `PIPELINE_ALLOW_NETWORK=false` |

Compose is **not** `network_mode: none`; services can talk to each other (Postgres/Redis/pipeline). See [DOCKER_SETUP.md](./DOCKER_SETUP.md) and [SECURITY_LIMITATIONS.md](./SECURITY_LIMITATIONS.md).

## 5. Validation model

| Mode | Meaning | Exit |
| --- | --- | --- |
| `acceptance` | Checks must pass | 0 if `PASS`, else 1 |
| `baseline` | Starter should fail acceptance | 0 if `BASELINE_BLOCKED_EXPECTED`, else 1 |
| `full` | Reserved / same exit rules; not a separate long-chain gate in Phase 1 | — |

Check types implemented: `evidence_present`, workspace file checks, `application_health`, `http_response`, `graphql_request`, `browser_playwright`, `database_state` (json_fixture / optional postgres), `path_invariant`, `redis_ping`, `postgres_ready`.

HTTP destinations: loopback + `PIPELINE_NETWORK_ALLOWLIST`. Stack probes: `PIPELINE_STACK_HOST_ALLOWLIST`.

## 6. Retry and safe-stop

- Budgets: `PIPELINE_MAX_IDENTICAL_RETRIES`, `PIPELINE_MAX_TOTAL_ATTEMPTS`, timeout-specific limits in `RetryPolicy`
- Recoverable kinds may retry the agent; unsafe / auth / validation-for-PASS do not chase green via agent retries
- Secret-like / production indicators in agent text → safe-stop `BLOCK`

## 7. Agents

| Mode | Behavior |
| --- | --- |
| `mock` (default) | Deterministic fixture agent; no LLM |
| `openhands` | Spawns OpenHands CLI with scrubbed env; **not** a hard OS sandbox |
| Scenario agents | Catalog / nail-patterns / failure demos — purpose-built for demos |

Public catalog demo defaults to its scenario agent unless `PIPELINE_AGENT_MODE=openhands`.

## 8. Evidence

Canonical Phase 1 evidence root: `artifacts/<runId>/` (compatible fields with evaluation-demo `results/` shape: `run-manifest`, `status`, logs, diff/summary/rollback).

Artifact CLI: `node packages/validator/bin/validate.mjs --run-dir …` — ignores agent summary; refuses forgeable `PASS` without validation check JSON.

## 9. Out of Phase 1

Deferred items remain listed in [PHASE1_SCOPE.md](./PHASE1_SCOPE.md) §3 and [LIMITATIONS.md](./LIMITATIONS.md): full Vendure storefront journeys, Stripe/Mailpit, Terraform, skill-doctor, etc.

## 10. Smoke commands

```bash
npm ci && npm test && npm run build
./scripts/start.sh && ./scripts/check.sh
npm run scenario:public-catalog
node packages/validator/bin/validate.mjs --run-dir artifacts/$(ls -1t artifacts | head -1)
./scripts/cleanup.sh
```
