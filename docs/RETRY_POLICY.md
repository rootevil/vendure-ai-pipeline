# Retry policy

There is no open loop:

```text
while (failure) retry()   // not implemented
```

```text
MAX_RETRIES = 3
```

The same failure on the third occurrence is **CIRCUIT_BREAK**. The circuit stays open for the rest of the run.

## Classification

| Failure | Action |
| --- | --- |
| Temporary container failure | `RETRY` (until the same failure hits 3) |
| Browser timeout | `RETRY_ONCE` |
| Code bug | `AGENT_REPAIR` (bounded; not a blind retry) |
| Dependency error | `AGENT_INVESTIGATE` |
| Missing credential | `AUTH_REQUIRED` |
| Business ambiguity | `CLIENT_DECISION` |
| Dangerous operation | `BLOCK` |
| Same failure 3 times | `CIRCUIT_BREAK` |
| Production target | `BLOCK` |

`AUTH_REQUIRED`, `CLIENT_DECISION`, `BLOCK`, and `CIRCUIT_BREAK` do not retry.

## Code

| Module | Role |
| --- | --- |
| `src/retry/classified-policy.ts` | `MAX_RETRIES` and the category table |
| `src/retry/retry-policy.ts` | Counts identical failures and opens the circuit |
| `src/retry/circuit-breaker.ts` | Fail-closed circuit (open until the run resets) |

PASS still comes only from the independent validator. A circuit break cannot be retried into a pass.
