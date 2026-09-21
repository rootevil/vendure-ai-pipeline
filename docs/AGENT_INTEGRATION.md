# Agent Integration

Reuse **OpenHands** (or an equivalent existing agent runtime). This repository does **not** build an autonomous coding engine from scratch.

## Architecture

```text
Pipeline
   ↓
Agent Adapter          (src/agent/*)
   ↓
OpenHands / selected runtime
   ↓
Coding Agent
   ↓
Workspace               (workspace/runs/<run-id>/)
```

```text
Agent claimedSuccess  ──ignored──▶  Independent Validator  ──decides──▶  PASS | BLOCK
                                         │
                    Playwright / GraphQL / DB / HTTP assertions
                                         │
                              validator-verdict.json
```

**Agent success ≠ Pipeline PASS.** That distinction is mandatory. The final PASS/BLOCK decision comes from evidence/validation only — see [VALIDATION.md](./VALIDATION.md).

## Modes

| `PIPELINE_AGENT_MODE` | Behavior |
| --- | --- |
| `mock` (default) | Deterministic in-process agent for tests/CI; no LLM |
| `openhands` | Spawns OpenHands CLI in the run workspace via `GuardingProcessRunner` |
| `noop` | Explicit no-op |

## Adapter gives the Agent (`agent-request.json` + `task-brief.md`)

| Field | Source |
| --- | --- |
| task | `taskId`, `title`, `goal`, stages |
| repository / workspace | `workspace/runs/<run-id>/` |
| acceptance criteria | task card / compiled metrics |
| available tools | `allowedTools` |
| time limit | `PIPELINE_AGENT_TIMEOUT_MS` / task `timeoutMs` |
| retry limit | `retryPolicy.maxIdenticalRetries` / `maxTotalAttempts` |
| write allowlist | safety kernel allowlist |
| `pipelineAuthority` | always `independent_validator_only` |

## Adapter receives / returns (`AgentReport`)

| Field | Meaning |
| --- | --- |
| `changedFiles` | Workspace snapshot diff (allowlist enforced) |
| `commandsExecuted` | CLI invocations recorded by the adapter/agent |
| `stdout` / `stderr` | Captured process output (redacted) |
| `errors` | Codes/messages from the attempt |
| `finalReport` / `summary` | Agent narrative |
| `claimedSuccess` | Informational only — **never** Pipeline PASS |

Optional on-disk envelope `agent-result.json`:

```json
{
  "summary": "string",
  "claimed_success": true,
  "changed_files": ["src/file.ts"],
  "commands_executed": ["npm test"],
  "errors": []
}
```

Fields such as `status`, `pipeline_status`, `pass`, or `block` are **rejected**.

## Local usage

```bash
# no LLM required
PIPELINE_AGENT_MODE=mock npm run pipeline -- run --task fixtures/tasks/hello-change.json

# requires OpenHands CLI + runtime LLM credentials injected outside git
PIPELINE_AGENT_MODE=openhands PIPELINE_AGENT_TIMEOUT_MS=180000 \
  npm run pipeline -- run --task fixtures/tasks/hello-change.json
```

## Code map

| Module | Role |
| --- | --- |
| `src/agent/agent-request.ts` | Request/report contracts |
| `src/agent/agent-adapter.ts` | Adapter interface + `agentOutcome` helper |
| `src/agent/openhands-adapter.ts` | OpenHands CLI adapter |
| `src/agent/mock-adapter.ts` | Deterministic test double |
| `src/agent/task-prompt.ts` | Brief + `agent-request.json` writer |
| `src/agent/agent-factory.ts` | Mode selection |

See [SAFETY.md](./SAFETY.md), [VALIDATION.md](./VALIDATION.md).
