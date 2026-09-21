# Safety kernel

Code-owned boundary around the Agent. The Agent may work only inside a disposable run workspace with an explicit action/command allowlist. It must **not** get unrestricted host or MiniPC filesystem access.

```text
                    ┌──────────────────────┐
                    │   Safety Kernel      │
                    │  (fail closed)       │
                    └──────────┬───────────┘
                               │
              workspace/runs/<run-id>/
                               │
         allow: read/write source, tests,
         approved commands, browser, test DB
                               │
         deny: production, host FS, SSH,
         arbitrary credentials, destructive
         host commands, unlimited network,
         unlimited retries, unrestricted MiniPC
```

## Workspace

Default layout (matches client isolation intent):

```text
./workspace/runs/<run-id>/     # agent cwd + allowlisted writes
./artifacts/<run-id>/          # evidence pack
```

Configured by `PIPELINE_WORKSPACE_DIR` (default `./workspace/runs`). Each run gets `resolve(PIPELINE_WORKSPACE_DIR, runId)`.

Paths outside that directory are rejected (`HOST_FILESYSTEM` / `PATH_ESCAPE`).

## Allowed actions

| Action | Meaning |
| --- | --- |
| `read_source` | Read inside the run workspace |
| `write_source` | Write only under `writeAllowlist` |
| `run_tests` | Test runners via approved commands |
| `run_approved_commands` | Basename allowlist (node, npm, openhands, …) |
| `run_browser` | Playwright checks (validator / fake launcher) |
| `query_test_database` | Allowlisted postgres/redis / json fixtures |

## Forbidden by default

| Denial | Enforcement |
| --- | --- |
| Production | Text/command indicators → safe-stop |
| Host filesystem | Path must stay under run workspace |
| SSH / SCP | Command + output scanners |
| Arbitrary credentials | Env scrub + secret redaction; secret-like output → BLOCK |
| Destructive host commands | Pattern deny (`rm -rf`, `sudo`, `mkfs`, …) |
| Unlimited network | `PIPELINE_ALLOW_NETWORK=false` + SSRF allowlists |
| Unlimited retries | Caps on identical/total attempts |
| Unrestricted MiniPC FS | Explicitly forbidden; no MiniPC in command lines |

## Modules

| Module | Role |
| --- | --- |
| `src/safety/policy.ts` | Allow/deny policy constants |
| `src/safety/safety-kernel.ts` | Kernel API |
| `src/safety/command-guard.ts` | `GuardingProcessRunner` for agent spawns |
| `src/safety/execution-context.ts` | Per-run context + path guards |
| `src/safety/redaction.ts` | Secrets / URL allowlists |
| `src/task/task-safety.ts` | Task-card preflight |

OpenHands CLI invocations go through `GuardingProcessRunner` (approved `openhands` basename, cwd must be the run workspace).

## Explicit non-goals

- Hard OS sandbox for OpenHands (seccomp / nested VM) — **not** claimed
- Cryptographic evidence signing
- Granting MiniPC or production credentials to the agent

See [SECURITY_LIMITATIONS.md](./SECURITY_LIMITATIONS.md) and [LIMITATIONS.md](./LIMITATIONS.md).
