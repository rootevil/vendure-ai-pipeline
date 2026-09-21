# Validation

How PASS/BLOCK is decided, what evidence is required, and how to re-validate a run directory.

## Authority

**Only the independent validator decides the pipeline status.**  
Agent fields such as `claimedSuccess`, summaries, or “done” prose are informational and never grant `PASS`.

```text
Agent says SUCCESS
       ↓
Playwright
       ↓
GraphQL
       ↓
PostgreSQL / fixture DB
       ↓
Assertions
       ↓
PASS / BLOCK
```

In-process authority: `src/validator/independent-validator.ts` (used by `TaskRunner` / scenarios).  
Offline re-check: `packages/validator/bin/validate.mjs` → `validateRunDir()`.

Client-facing artifact: `artifacts/<runId>/validator-verdict.json` — built only from check evidence.

```json
{
  "status": "PASS",
  "checks": [
    { "name": "storefront loads", "status": "PASS" },
    { "name": "product visible", "status": "PASS" },
    { "name": "order created", "status": "PASS" },
    { "name": "database order exists", "status": "PASS" }
  ],
  "agentClaimIgnored": true,
  "agentClaimedSuccess": true,
  "summary": "Independent checks passed; agent claim was not used as authority"
}
```

If any critical assertion fails, overall `status` is `BLOCK` regardless of the agent self-report.

**Dual evidence:** browser screenshots alone are not enough. After Playwright, the checkout demo also runs independent GraphQL/API product and order queries — see [GRAPHQL_API_VALIDATION.md](./GRAPHQL_API_VALIDATION.md). Controlled DB queries (no free-form agent SQL) are documented in [DATABASE_VALIDATION.md](./DATABASE_VALIDATION.md).

## Status vocabulary

| Status | Meaning | Typical process exit |
| --- | --- | --- |
| `PASS` | Required evidence present and independent checks succeeded | 0 |
| `BLOCK` | Failed/missing checks, unsafe stop, or exhausted retries | 1 |
| `BASELINE_BLOCKED_EXPECTED` | Baseline mode correctly saw failing acceptance | 0 |
| `AUTH_REQUIRED` | Missing credential — stop, do not retry | 2 |
| `CLIENT_DECISION` | Business ambiguity — stop for the client | 1 |

Evaluation-demo verifier (`evaluation-demo/scripts/verify.mjs`) uses the same status strings for the public mini-demo.

## Check types (implemented)

| `validationSteps[].type` | What it asserts |
| --- | --- |
| `evidence_present` | Required evidence filenames exist |
| `workspace_file_exists` / `workspace_file_contains` | File in workspace |
| `changed_files_include` | Path appears in agent change set |
| `application_health` | HTTP health endpoint |
| `http_response` | Status + optional body substring |
| `graphql_request` | GraphQL errors / data path |
| `browser_playwright` | Title/selector/text (+ screenshot name) |
| `browser_journey` | Multi-step Playwright flow; numbered screenshots + `playwright-results.json` |
| `database_state` | `json_fixture` or `postgres` via **controlledQueryId** only (read-only SELECT; expected vs actual) |
| `path_invariant` | Nested fixture tree not flattened |
| `redis_ping` / `postgres_ready` | Stack dependency probes (allowlisted hosts) |

HTTP checks require `PIPELINE_ALLOW_NETWORK=true` **or** a scenario that enables network for loopback. Destinations must pass the SSRF allowlist (loopback + `PIPELINE_NETWORK_ALLOWLIST`).

## Evidence pack

Default root: `artifacts/<runId>/`.

Minimum files commonly required by tasks:

- `run-manifest.json`, `status.json`
- `stdout.log`, `stderr.log`
- `change-summary.md`, `rollback.md`, `summary.md`

Also produced when applicable: `result.json`, `report.json`, `validation.json`, `validation-results.json`, `validator-verdict.json`, `playwright-results.json`, `summary.html`, `evidence-manifest.json`, `diff.patch` / `git.diff`, `screenshots/`, `api-responses/`, `workspace-checkpoint/`.

Logs and diffs are **redacted** for secret-like patterns before write.

## Offline validator CLI

```bash
node packages/validator/bin/validate.mjs --run-dir artifacts/<run_id>
```

Behavior:

1. Ignores agent-summary success language.  
2. Requires `status.json` + required evidence files.  
3. For `PASS`, requires `validation-results.json` or `validation.json` with ≥1 check and zero `FAIL`/`ERROR`.  
4. Exit 0 only for `PASS` or `BASELINE_BLOCKED_EXPECTED`.

This is **not** a cryptographic attestation — see [SECURITY_LIMITATIONS.md](./SECURITY_LIMITATIONS.md).

## Modes

| Mode | Validator expectation |
| --- | --- |
| `acceptance` | Tests/checks must pass for `PASS` |
| `baseline` | Failing acceptance → `BASELINE_BLOCKED_EXPECTED` when evidence complete |
| `full` | Same machinery; no separate Phase 1 long-chain suite |

## Public demo verification

```bash
node evaluation-demo/scripts/run-demo.mjs           # reference PASS (temp copy)
bash evaluation-demo/scripts/verify.sh --baseline   # incomplete tree → expected block
```

Tree `evaluation-demo/app/src/catalog.mjs` is incomplete by design. The catalog **scenario** seeds incomplete then applies the reference adapter inside an isolated workspace.

## Agent cannot bypass validation

| Attempt | Outcome |
| --- | --- |
| Agent claims success | Handed to validator; claim ignored for PASS |
| Forge `status.json` alone | Artifact CLI blocks without check JSON |
| Skip required evidence | `BLOCK` |
| Fail a check | `BLOCK` (`validator-verdict.json` status `BLOCK`) |

Side effects on an unsandboxed host agent are a **safety** concern (limitations doc), not a validator trust rule.

## Related

- [QUICKSTART.md](./QUICKSTART.md)  
- [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md)  
- [FAILURE_DEMO.md](./FAILURE_DEMO.md)  
- [PUBLIC_CATALOG_SCENARIO.md](./PUBLIC_CATALOG_SCENARIO.md)  
