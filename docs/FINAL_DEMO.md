# Final client demonstration

Exact walkthrough for the client. One command runs the six demos in order:

```bash
docker compose up -d   # optional stack
npm run demo:final
```

This is a **pipeline** demonstration (Task → Scenario → Agent → Validators → Evidence → Recovery → Safe stop), not a folder of unrelated scripts.

## Sequence

### Demo 1 — Business goal

Type / card:

> A customer should be able to purchase a product from the storefront.

Pipeline generates:

- technical task
- acceptance criteria
- validation plan (browser / API / database checks, cleanup, rollback, stop conditions)

Source card: `tasks/final-demo-goal.yaml`.

### Demo 2 — Autonomous execution

```text
Agent starts
↓
reads repository
↓
plans
↓
changes code
↓
runs tests
```

### Demo 3 — Real validation

```text
Playwright   — storefront → product → cart → checkout
GraphQL      — independent Shop API queries
PostgreSQL   — controlled SELECT id, state FROM "order" WHERE code = $1
```

### Demo 4 — Evidence

Open `runs/<id>/` and review screenshots, logs, and `validation.json` / `final-report.html`.

### Demo 5 — Recovery

Controlled bug:

```text
FAIL → diagnose → repair → retry → PASS
```

### Demo 6 — Safe stop

Unrecoverable / exhausted retries:

```text
retry limit → circuit breaker → BLOCK → evidence → rollback
```

Demo 6 is expected to **BLOCK**. Overall `demo:final` exits 0 only when demos 1–5 pass and demo 6 correctly blocks.

## What this does **not** claim

- Formal three long-chain client gate PASS
- Formal Artillery/k6/Semgrep acceptance (interfaces only)
- Live OpenHands LLM coding (default path uses scenario/mock agents)
- Production / minipc / private client credentials

See [LIMITATIONS.md](./LIMITATIONS.md).

## Related commands

| Command | Role |
| --- | --- |
| `npm run demo:final` | Full six-demo walkthrough |
| `npm run demo:success` | Short PASS path |
| `npm run demo:recovery` | Recovery only |
| `npm run demo:block` | Circuit-break BLOCK only |
| `npm run pipeline -- tasks/demo-task.yaml` | Stage-log catalog demo |

## Clean-room prerequisites

Node ≥ 20, `npm ci`, optional Docker (`docker compose up -d`). No production secrets.
