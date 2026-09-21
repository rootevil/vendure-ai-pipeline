# Load test and red-team interfaces

Formal load and red-team acceptance is **not** part of this MVP. The pipeline only reserves the stages and adapter interfaces.

```text
Business validation
        ↓
Load test          (LoadTestAdapter — not run)
        ↓
Security/red-team  (RedTeamAdapter — not run)
        ↓
Final report
```

## Layout

```text
src/validators/load/load-test-adapter.ts
src/validators/security/red-team-adapter.ts
src/validators/extended-validation.ts
```

| Interface | Possible tools (named, not executed) | MVP behavior |
| --- | --- | --- |
| `LoadTestAdapter` | Artillery, k6 | `UnconfiguredLoadTestAdapter` returns `NOT_RUN` |
| `RedTeamAdapter` | Semgrep, Trivy, CodeQL, sqlmap | `UnconfiguredRedTeamAdapter` returns `NOT_RUN` |

`NOT_RUN` does not grant PASS and does not revoke a business-validation PASS. A future adapter that returns `FAIL` does block.

Each run writes:

- `load/result.json`
- `security/result.json`
- `extended-validation.json`

Plug in a real adapter on `TaskRunner` via `loadTest` / `redTeam`. Until then, do not treat these files as formal load or security acceptance.
