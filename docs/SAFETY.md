# Safety kernel

Code-owned boundaries for the adaptive pipeline. The Agent may plan and edit inside the allowlist; it may **not** expand scope, mint PASS, or skip evidence.

## Responsibilities

| Concern | Behavior |
| --- | --- |
| Task identity | Zod-parsed `task.json` / compiled card; run id per attempt |
| Write scope | `writeAllowlist` + `PIPELINE_WRITE_ALLOWLIST`; path traversal rejected |
| Network | Fail closed unless allowlisted loopback / `PIPELINE_NETWORK_ALLOWLIST` / stack host allowlist |
| Secrets | Redaction on logs/diffs; secret-like / production indicators → safe-stop |
| Retries | Only recoverable kinds; circuit breaker opens on budget exhaustion |
| Irreversible / unsafe | No repair loop; `BLOCK` with evidence |
| Rollback | Disposable workspace + `rollback.md`; Docker `cleanup.sh` for stack volumes |
| PASS authority | Independent validator / artifact CLI only |

## Modules

| Façade | Role |
| --- | --- |
| `src/safety/permissions.ts` | Write/network permission checks |
| `src/safety/resource-limits.ts` | Timeouts / attempt budgets from config + task |
| `src/safety/dangerous-actions.ts` | Unsafe pattern classification hooks |
| `src/safety/rollback.ts` | Checkpoint + rollback notes |
| `src/execution/sandbox.ts` | Execution context / sandbox boundary |

## Explicit non-goals (this slice)

- Hard OS sandbox for OpenHands (seccomp / nested VM)
- Cryptographic signing of evidence
- Unrestricted minipc / SSH / production credentials

See [SECURITY_LIMITATIONS.md](./SECURITY_LIMITATIONS.md) and [LIMITATIONS.md](./LIMITATIONS.md).
