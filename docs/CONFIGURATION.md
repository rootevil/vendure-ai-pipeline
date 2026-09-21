# Configuration

All pipeline settings are environment variables. Prefer `.env` for host runs and `.env.docker` for Compose (gitignored). Templates: `.env.example`, `.env.docker.example`.

**Never commit secrets.** LLM/API keys for OpenHands must be injected at runtime only.

## Host pipeline (`.env` / process env)

| Variable | Default | Description |
| --- | --- | --- |
| `PIPELINE_MODE` | `acceptance` | `acceptance` \| `baseline` \| `full` |
| `PIPELINE_ARTIFACTS_DIR` | `./artifacts` | Evidence root |
| `PIPELINE_WORKSPACE_DIR` | `./workspace/runs` | Disposable run workspaces root (`<root>/<runId>/`) |
| `PIPELINE_MAX_IDENTICAL_RETRIES` | `3` | Max identical failure signatures before circuit open |
| `PIPELINE_MAX_TOTAL_ATTEMPTS` | `5` | Hard cap on agent attempts |
| `PIPELINE_ALLOW_NETWORK` | `false` | When false, HTTP/GraphQL/browser checks fail closed |
| `PIPELINE_NETWORK_ALLOWLIST` | _(empty)_ | Extra hosts for validator HTTP (loopback always allowed) |
| `PIPELINE_STACK_HOST_ALLOWLIST` | `redis,postgres,127.0.0.1,localhost,::1` | Hosts for `redis_ping` / `postgres_ready` / postgres driver |
| `PIPELINE_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `PIPELINE_RUN_ID` | _(generated)_ | Optional fixed run id |
| `PIPELINE_WRITE_ALLOWLIST` | `src,app,evaluation-demo/app` | CSV relative roots merged with task allowlist |
| `PIPELINE_AGENT_MODE` | `mock` | `mock` \| `openhands` \| `noop` |
| `PIPELINE_AGENT_TIMEOUT_MS` | `120000` | Agent process timeout |
| `PIPELINE_OPENHANDS_COMMAND` | `openhands` | CLI binary name/path |
| `PIPELINE_MOCK_AGENT_BEHAVIOR` | `success` | `success` \| `failure` \| `timeout` \| `retryable` \| `malformed` \| `forbidden_verdict` |
| `PIPELINE_USE_REAL_BROWSER` | unset | `1` to use real Playwright in catalog scenario |
| `PIPELINE_SKIP_PLAYWRIGHT_INSTALL` | unset | `1` skips postinstall browser download |

Task JSON also carries `timeoutMs`, `retryPolicy`, `writeAllowlist`, `validationSteps`, and `cleanupWorkspace`.

## Docker stack (`.env.docker`)

Used by `scripts/docker-stack.sh` / Compose. Placeholders only:

| Variable | Role |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Disposable DB |
| `DATABASE_URL` / `REDIS_URL` | In-network URLs (`postgres`, `redis` hosts) |
| `PG*` | Passed into pipeline container for healthchecks |
| `PIPELINE_*` | Same semantics as host; Compose sets `PIPELINE_ALLOW_NETWORK=false` by default |
| `PIPELINE_HEALTH_REQUIRE_DEPS` | When `true`, container healthcheck also pings Postgres/Redis (Compose default) |

Compose sets `PIPELINE_HEALTH_REQUIRE_DEPS=true` so the pipeline healthcheck pings Postgres and Redis.

## Modes

| Mode | Intended use |
| --- | --- |
| `acceptance` | Normal demo / CI — require passing checks |
| `baseline` | Prove incomplete starter fails acceptance (`BASELINE_BLOCKED_EXPECTED`) |
| `full` | Accepted by schema; Phase 1 does not add a separate long-chain gate |

## Network policy (Phase 1)

1. **Compose:** containers cannot reach the internet (`internal: true`).  
2. **Validator HTTP:** only `127.0.0.1` / `localhost` / `::1` plus `PIPELINE_NETWORK_ALLOWLIST`.  
3. **Stack probes:** only `PIPELINE_STACK_HOST_ALLOWLIST`.  
4. **Scenarios** (catalog / failure demos) set `allowNetwork: true` in-process for **loopback** demo servers — they do not enable arbitrary egress.

## Agent modes

| Value | Requirements | Notes |
| --- | --- | --- |
| `mock` | None | Default; deterministic |
| `openhands` | OpenHands CLI on `PATH` (+ provider keys as needed) | Env scrubbed of secret-like keys; not a hard sandbox |
| `noop` | None | Explicitly does nothing useful |

## GitHub Actions

Workflow inputs: `task`, `mode`. Task must be:

- `evaluation-demo/task.md`, or  
- `fixtures/tasks/<name>.json` (alphanumeric / `._-` only)

Default job sets `PIPELINE_ALLOW_NETWORK=false` and `PIPELINE_AGENT_MODE=mock`.

## Related

- [QUICKSTART.md](./QUICKSTART.md)  
- [DOCKER_SETUP.md](./DOCKER_SETUP.md)  
- [SECURITY_LIMITATIONS.md](./SECURITY_LIMITATIONS.md)  
