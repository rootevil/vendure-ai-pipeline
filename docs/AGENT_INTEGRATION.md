# Agent Integration

The pipeline reuses **OpenHands** as the open-source coding agent runtime. This repository does not implement an LLM or autonomous agent from scratch.

## Modes

| `PIPELINE_AGENT_MODE` | Behavior |
| --- | --- |
| `mock` (default) | Deterministic in-process agent for tests/CI; no external LLM/API |
| `openhands` | Spawns `openhands --headless --json -f task-brief.md` in the run workspace |
| `noop` | Explicit no-op (always non-recoverable) |

## Contracts

- The agent receives a structured task brief (`task-brief.md`) derived from the task definition.
- Workspace writes must stay inside the write allowlist; path escapes fail closed.
- Stdout/stderr are captured; workspace changes are snapshotted as a diff.
- `PIPELINE_AGENT_TIMEOUT_MS` kills the OpenHands process (SIGKILL) on timeout.
- Controller retry budgets still apply to recoverable agent failures.
- Optional `agent-result.json` shape:

```json
{ "summary": "string", "claimed_success": true, "changed_files": ["src/file.ts"] }
```

Fields such as `status`, `pipeline_status`, `pass`, or `block` are rejected. The **validator** alone decides Pipeline `PASS` / `BLOCK`.

## Local usage

```bash
# no LLM required
PIPELINE_AGENT_MODE=mock npm run pipeline -- run --task fixtures/tasks/public-catalog.json

# requires OpenHands CLI + runtime LLM credentials injected outside git
PIPELINE_AGENT_MODE=openhands PIPELINE_AGENT_TIMEOUT_MS=180000 \
  npm run pipeline -- run --task fixtures/tasks/public-catalog.json
```
