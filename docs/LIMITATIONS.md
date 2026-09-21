# Limitations (Phase 1 handover)

Honest non-claims for operators and reviewers. Security-specific residuals: [SECURITY_LIMITATIONS.md](./SECURITY_LIMITATIONS.md). Scope freeze: [PHASE1_SCOPE.md](./PHASE1_SCOPE.md).

## Product / scope

| Claim people might assume | Actual Phase 1 reality |
| --- | --- |
| Full Vendure Batch 1+2 migration | **Not** implemented; deferred |
| Live Shop/Admin + Stripe + Mailpit E2E | **Not** implemented |
| Three long-chain client capability gates | **Not** Phase 1 acceptance |
| Buzz multi-role permanent agents | **Not** implemented |
| Production deploy / private client repos | **Out of scope** |
| Unrestricted minipc / SSH | **Out of scope** |
| Formal load test (Artillery, k6) | **Interface only** — `NOT_RUN`, not acceptance |
| Formal red-team (Semgrep, Trivy, CodeQL, sqlmap) | **Interface only** — `NOT_RUN`, not acceptance |

## Runtime / agents

| Topic | Limitation |
| --- | --- |
| Default agent | `mock` — no LLM coding |
| Public catalog demo | Uses a **scenario agent** that applies the published reference adapter; not a free-form OpenHands solve unless you set `PIPELINE_AGENT_MODE=openhands` |
| OpenHands | Thin CLI adapter only; **not** a hard OS sandbox |
| Browser checks | Fake launcher by default; real Chromium needs install + `PIPELINE_USE_REAL_BROWSER=1` |
| Task cards | Business YAML (`goal`/`acceptance`) compiles to metrics; Markdown is known-card mapping only — not a free-form LLM PM |
| Safety kernel | Control-plane allow/deny + `workspace/runs/<id>`; **not** a hard OS sandbox for OpenHands / MiniPC |

## Isolation

| Topic | Limitation |
| --- | --- |
| Compose | `internal: true` (service mesh), **not** `network_mode: none` |
| Host / GHA task runs | Not inside the Compose network namespace |
| Evidence integrity | No cryptographic signing of PASS |

## Data services

| Topic | Limitation |
| --- | --- |
| Postgres / Redis in Compose | Disposable placeholders; Redis unauthenticated on internal net |
| `database_state` postgres driver | Optional `pg` package; hosts must be stack-allowlisted |
| BullMQ / real Vendure DB migrations | **Not** Phase 1 |

## Packages layout

Architecture originally sketched full packages under `packages/*`. **Implementation lives in `src/`**; `packages/` exposes the validator CLI and thin package.json shims.

## What Phase 1 does deliver

- Reusable control loop: task → isolated workspace → agent → independent validation → evidence → PASS/BLOCK  
- Docker stack with healthchecks and cleanup  
- Public catalog + nail-patterns + failure demos  
- Bounded retries, path/network fail-closed guards appropriate to Phase 1  
- `workflow_dispatch` entry with allowlisted tasks  

If a README or demo script seems to promise more than this file, **this file wins**.
