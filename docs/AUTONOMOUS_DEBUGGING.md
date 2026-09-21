# Autonomous debugging

This is the impressive recovery demo: a deliberate catalog/storefront failure, then the client-required recovery loop.

## Deliberate failure

| | |
| --- | --- |
| **Expected** | Product appears on storefront (active Soft Pink Almond + Rose Gold French; GraphQL `totalItems=2`) |
| **Actual** | Buggy adapter leaks inactive `Archived Sample` / wrong catalog shape — storefront + API fail targeted checks |

Controlled bug: `evaluation-demo/app/src/catalog.buggy.mjs`.

## Recovery process

```text
Failure
  ↓
Capture logs / preserve failed state
  ↓
Classify failure
  ↓
Agent investigates
  ↓
Inspect code/config
  ↓
Make smallest reversible fix
  ↓
Run targeted reproducer
  ↓
Run regression / independent validation
  ↓
Circuit-break repeated failures
```

Client requirements covered:

| Requirement | How |
| --- | --- |
| Preserve failed state | `artifacts/<runId>/failed-state/` (logs, snapshot, `catalog.mjs.failed`) before repair |
| Classify failure | `classify-failure` → `recoverable_implementation` (or unsafe stop) |
| Choose reversible step | Repair brief `reversibleStep` + disposable workspace |
| Research when necessary | Agent reads `.pipeline/repair-brief.json` + inspects catalog |
| Modify code | Smallest fix: swap in published reference adapter |
| Rerun reproducer | Targeted acceptance + GraphQL + storefront checks |
| Regression | Broader independent validator |
| Circuit-break repeats | `RetryPolicy` / identical failure budget |

**Agent claim never grants PASS** — broader independent validation decides.

## Run

```bash
npm run scenario:failure-recoverable
# alias:
npm run scenario:autonomous-debugging

npm run scenario:failure-unrecoverable   # unsafe → BLOCK, no repair
```

Inspect:

```bash
cat <artifactDir>/failure-demo.json
ls <artifactDir>/failed-state/
```

`failure-demo.json` includes `deliberateFailure`, `recoveryProcess`, and the step timeline.

## Related

- [FAILURE_DEMO.md](./FAILURE_DEMO.md)
- [VALIDATION.md](./VALIDATION.md)
- [FINAL_DEMO.md](./FINAL_DEMO.md)
