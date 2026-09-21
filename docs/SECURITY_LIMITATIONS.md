# Phase 1 Security Limitations

This document records **remaining** safety limitations after Phase 11 hardenings.
Practical fail-closed controls that fit Phase 1 scope were implemented in code;
items below are deferred, environmental, or intentionally soft for the public demo.

## What Phase 1 now enforces (summary)

| Area | Control |
| --- | --- |
| Filesystem | Non-empty write allowlist (fail closed); reject `..` / absolute agent paths; screenshot names are simple filenames |
| Network (HTTP/GQL/browser) | Loopback + `PIPELINE_NETWORK_ALLOWLIST` only (SSRF guard) |
| Stack deps | Redis/Postgres hosts limited to `PIPELINE_STACK_HOST_ALLOWLIST` |
| Agent env | Secret-like env keys stripped before OpenHands spawn |
| Logs / evidence | Secret redaction + stdout/stderr size caps |
| Retries | Classified actions with `MAX_RETRIES = 3` and a fail-closed circuit breaker. No unbounded `while (failure) retry()` loop. |
| Timeouts | Agent and process runner kill on timeout; HTTP/browser steps have `timeoutMs` |
| Resources | Compose CPU/mem/PID limits; process output hard cap (~4MB) then SIGKILL |
| Cleanup / restore | Pre-agent git checkpoint + filesystem snapshot; preserve on PASS; `git diff` + reset/restore on unrecoverable failure |
| Production | Stronger connection-string heuristics; refuse prod-like Redis/Postgres targets |
| Validator bypass | Artifact CLI refuses `PASS` without `validation*.json` check audit |
| GHA | Task path allowlist; task passed via env (not shell interpolation); default `PIPELINE_ALLOW_NETWORK=false` |

## Remaining limitations

### 1. OpenHands is not a hard sandbox

The OpenHands adapter runs a local CLI with `cwd` set to the disposable workspace and scrubbed env, but **without** seccomp, AppArmor, gVisor, or a nested container. A compromised or malicious agent can still attempt host OS operations available to the pipeline process user.

**Mitigation today:** Prefer `PIPELINE_AGENT_MODE=mock` for CI/public demos; run coding agents only inside the Compose stack or an owner-controlled ephemeral VM.

**Phase 2+:** Execute OpenHands inside the pipeline container (or Firecracker/Vercel Sandbox) with read-only rootfs and no host mounts beyond the workspace volume.

### 2. Host / GHA runners are not Docker-isolated

`./scripts/start.sh --task` and GitHub Actions run on the host/ubuntu-latest, not behind Compose `internal: true`. Loopback SSRF guards apply, but there is no network namespace isolation equivalent to the Compose stack.

**Mitigation today:** Keep GHA task paths allowlisted; do not inject production secrets into the job; treat uploaded artifacts as sensitive.

### 3. Symlink / realpath edge cases

Write allowlisting is lexical (`relative` / prefix). A symlink created inside the workspace that points outside may still confuse tools that follow links.

**Phase 2+:** `realpath` / `lstat` checks before every write and after agent runs.

### 4. Evidence integrity is not cryptographic

The artifact validator requires check JSON to accompany `PASS`, but files are not signed or hash-chained. An attacker with write access to `artifacts/<runId>/` can still rewrite both `status.json` and `validation-results.json` consistently.

**Phase 2+:** Hash manifest signed by the independent validator process; verify in CLI and CI.

### 5. LLM credentials may still be required for OpenHands

Scrubbing drops `*TOKEN*`, `*PASSWORD*`, `DATABASE_URL`, etc. If OpenHands needs provider keys, operators must inject them through a narrowly named channel outside the scrub patterns—or accept that Phase 1 public demos use mock agents only.

### 6. Redis remains unauthenticated on the internal Compose network

Disposable Redis has no `requirepass`. Acceptable only because the network is `internal: true` and credentials are non-production placeholders.

### 7. Production detection is heuristic

Keyword / host allowlists reduce accidental production contact; they are not a guarantee against cleverly named hosts or tunnels.

### 8. Unlimited retries / missing timeouts — status

Already bounded in Phase 7 (`maxIdenticalRetries`, `maxTotalAttempts`, timeout budgets, circuit breaker). No Phase 1 gap remaining beyond misconfiguration of those env vars to very large values (still finite).

### 9. Agent cannot grant PASS

In-process `IndependentValidator` ignores agent prose. Agents can still **cause** unsafe side effects on the host (see §1); they cannot flip the validator decision without forging evidence files (§4).

### 10. P1-12 documentation boundary

No production deploy, private client credentials, or unrestricted minipc/SSH adapters are shipped. Enforcement is by absence of those adapters plus heuristics—not a formal policy engine.

## Operator checklist

1. Use Compose for any untrusted or OpenHands run: `./scripts/start.sh` then run tasks inside the stack when possible.  
2. Never put production `DATABASE_URL` / API keys in `.env.docker` or GHA logs.  
3. Keep `PIPELINE_ALLOW_NETWORK=false` unless the scenario needs loopback; extend `PIPELINE_NETWORK_ALLOWLIST` deliberately.  
4. Treat `artifacts/` uploads as potentially sensitive even after redaction.  
5. Do not widen the GHA task-path allowlist without a security review.

## Related documents

- [`docs/SECURITY_REPORT.md`](./SECURITY_REPORT.md) — Phase 11 audit findings (pre/post hardening context)  
- [`docs/PHASE1_SCOPE.md`](./PHASE1_SCOPE.md) — P1-12 security boundary  
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — fail-closed design intent  
- [`docs/DOCKER_SETUP.md`](./DOCKER_SETUP.md) — Compose isolation guarantees  
