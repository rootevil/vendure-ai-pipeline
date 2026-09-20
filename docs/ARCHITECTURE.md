# Architecture

Senior-architect proposal for a reusable autonomous engineering and validation pipeline. **Design only — no implementation in this document’s phase.**

Guiding constraints: Docker-first, isolated execution, bounded retries, independent validation, evidence collection, safe failure/stop, no production access, no secrets in git, **validator (not the AI agent) decides PASS/BLOCK**.

Reuse-first: prefer OpenHands (or equivalent maintained OSS agent runtime), Playwright, Docker/Compose, GitHub Actions, Node test runner, and the public demo’s evidence shape. Do not rebuild agent frameworks, browsers, or orchestrators from scratch.

## 1. Design principles

1. **Thin control plane, thick reuse.** Own only identity, scope, permissions, retries, evidence integrity, and the validator. Delegate coding/debugging to OpenHands (or peer).
2. **Evidence over narration.** Artifacts and exit codes decide outcomes.
3. **Isolation by default.** Each run gets a disposable workspace and a container network policy (none or explicit allowlist).
4. **Fail closed.** Missing identity, secrets policy violation, path escape, or exhausted retries → `BLOCK` or `AUTH_REQUIRED`, never silent continue.
5. **Public demo is the contract shape.** Extend `evaluation-demo` patterns (`run-manifest`, `status.json`, baseline vs acceptance) rather than inventing a parallel evidence language.

## 2. Proposed components

| Component | Responsibility | Reuse |
| --- | --- | --- |
| **Task Ingress** | Accept NL task card + pinned revisions; write `scenario.json` | Schema inspired by `evaluation-demo/task.md` |
| **Scenario Compiler** | Expand goal → stages, assertions, evidence requirements, cleanup, circuit-break | Small TS module; optional LLM assist with schema validation |
| **Safety Kernel** | Path allowlist, secret redaction, irreversible-op gate, retry budget | Custom thin code (required) |
| **Agent Runtime Adapter** | Drive coding/debug loop inside workspace | **OpenHands** (preferred) or documented alternative |
| **Tool Adapters** | Git, filesystem, Node test, later GraphQL/Playwright/Postgres | OSS CLIs/MCPs; mount only when scenario requests capability |
| **Runner** | Build/run/cleanup via Docker Compose | Extend demo `Dockerfile` / `compose.yaml` (`network_mode: none`) |
| **Evidence Relayer** | Collect logs, diff, screenshots, manifests into `artifacts/<run_id>/` | Pattern from `evaluation-demo/scripts/verify.mjs` |
| **Independent Validator** | Read artifacts + scenario; emit `PASS` / `BLOCK` / `BASELINE_BLOCKED_EXPECTED` | Evolve demo verifier into standalone package |
| **Control Surface** | `workflow_dispatch` + local CLI | GitHub Actions |

### What we deliberately do not build in Phase 1

- Custom multi-agent “Buzz” message bus (optional Phase 2; start with single OpenHands session + branch jobs later)
- Full MCP catalog from the client research list
- Production deployers, minipc remote-control shells, HyperQueue resource brokers

## 3. Repository structure (target)

```text
vendure-ai-pipeline/
  docs/                          # Client briefing + this architecture set
  evaluation-demo/               # Mirrored public demo (reference + first gate)
  docker/
    Dockerfile
    compose.yaml
  packages/
    scenario/                    # Task card → scenario.json
    safety/                      # Path/secret/retry guards
    evidence/                    # Bundle writers (manifest, status, rollback)
    validator/                   # Independent PASS/BLOCK (no LLM)
    agent-adapter/               # OpenHands (or peer) invocation
  scripts/
    start.sh
    stop.sh
    check.sh
    cleanup.sh
  .github/workflows/
    pipeline.yml                 # workflow_dispatch
  .env.example
  README.md
```

Phase 0 contains `docs/` + mirrored `evaluation-demo/` only. Packages above are created in later milestones.

## 4. Execution flow

```text
1. Start (CLI or workflow_dispatch)
     inputs: task card path, git SHA pins, mode (baseline|acceptance|full)
2. Safety Kernel preflight
     identity, workspace, disk budget, network policy, secret scan of env
3. Scenario Compiler
     emit scenario.json + evidence checklist
4. Provision Runner
     docker compose up; mount empty workspace; checkout pinned sources
5. Agent Runtime (bounded)
     read scenario → edit allowlisted files → run tests → on failure:
       classify → retry if recoverable and budget remains → else stop
6. Evidence Relayer
     write artifacts/<run_id>/{run-manifest.json,status.json,stdout.log,
       stderr.log,diff.patch,change-summary.md,rollback.md,...}
7. Independent Validator
     compare artifacts to scenario checklist
     decide PASS | BLOCK | BASELINE_BLOCKED_EXPECTED
8. Cleanup
     stop containers; wipe workspace; retain artifacts only
```

Critical rule: step 5 may write a narrative summary, but step 7 **overwrites** any agent-claimed success. If required files are missing, result is `BLOCK`.

## 5. Validation model

| Mode | Meaning | Exit |
| --- | --- | --- |
| `baseline` | Starter/incomplete state must fail acceptance assertions | 0 if `BASELINE_BLOCKED_EXPECTED`, else 1 |
| `acceptance` | All scenario assertions pass with required evidence | 0 if `PASS`, else 1 |
| `full` (Phase 2+) | Browser/API/DB evidence required per scenario | same |

Validator inputs: scenario.json, test exit codes, required artifact presence/hashes, optional schema checks. Validator must not call the LLM.

## 6. Retry and safe-stop policy

Recoverable (retry with budget, default N=3 identical signatures):

- transient tool/process crash
- flaky unit test with identical fix attempt not yet applied
- missing dependency installable inside allowlisted package manager

Non-recoverable (immediate stop):

- path escape / write outside workspace
- secret detected in output or staged files
- production host indicators
- missing credentials that cannot be inferred
- irreversible action requested (real payment, destructive prod)
- retry budget exhausted

Stop outputs must include: observation, attempts, why unsafe to continue, next human action, artifact path.

## 7. Security and isolation

- Default compose: `network_mode: none` for public/demo tasks (matches client demo).
- Phase 2 browser/API tasks: explicit egress allowlist only.
- Secrets via runtime injection (GitHub Actions secrets / local env), never committed.
- No `pull_request_target` with untrusted code + secrets.
- Contractor repo only until contract; no client minipc/production.

## 8. Mapping to client reference model

| Client reference layer | Our component |
| --- | --- |
| Buzz / coordination | Deferred; Phase 1 single-session + scripts |
| OpenHands / autonomous team | Agent Runtime Adapter |
| Codex coding backend | Optional backend behind OpenHands; not required for Phase 1 public demo |
| Code-owned safety/evidence kernel | Safety Kernel + Evidence Relayer |
| Independent validator | `packages/validator` |
| skill-doctor | Phase 2 optional retrospective |

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scope creep into full Vendure migration inside Phase 1 | Missed delivery | Hard freeze in `PHASE1_SCOPE.md` |
| Rebuilding OpenHands poorly | Fragile agent loop | Reuse OSS; thin adapter only |
| False PASS from agent prose | Client trust failure | Validator ignores prose; require artifacts |
| Demo evidence shape diverges from future private gate | Rework | Keep `run-manifest` / `status.json` fields stable |
| Disk pressure (client minipc ~85% full later) | Failed runs | Cleanup scripts; artifact retention policy |
| LLM/API cost undisclosed | Commercial breach | Disclose in quote; prefer owner-supplied keys later |
| Image fixture path breakage | Invalid Batch 2 prep | Never flatten `nail-patterns/` or `fixtures/美甲图案/` |

## 10. Exact implementation order (after Phase 0 docs)

1. **Milestone A** — Preserve/prove public demo scripts in this repo.
2. **Milestone B** — `docker/` runner + start/stop/check/cleanup; network none.
3. **Milestone C** — Extract/generalize validator + evidence package from `verify.mjs`.
4. **Milestone D** — Scenario schema + compiler for the catalog task.
5. **Milestone E** — Safety kernel (paths, retries, redaction).
6. **Milestone F** — OpenHands adapter wired to isolated workspace for catalog task.
7. **Milestone G** — Second bounded path/fixture task (nail-patterns structure check).
8. **Milestone H** — `workflow_dispatch` + artifact upload.
9. **Stop for review** — Phase 1 gate checklist in `PHASE1_SCOPE.md`; no Phase 2 coding until approved.

## 11. Milestone verification commands

See `docs/PHASE1_SCOPE.md` §6. Architecture-level smoke after packages exist:

```bash
docker compose -f docker/compose.yaml build
./scripts/start.sh --task evaluation-demo/task.md --mode baseline
node packages/validator/bin/validate.mjs --run-dir artifacts/$(ls -1t artifacts | head -1)
./scripts/cleanup.sh
```
