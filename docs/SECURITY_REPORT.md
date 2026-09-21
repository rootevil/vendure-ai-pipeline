# Phase 11 — Enterprise Security & Safety Audit

**Scope:** Full Phase 1 control plane on `main` (`e15b485` and predecessors).  
**Method:** Dedicated Security Review subagent could not run (empty branch diff vs `main`); audit performed against the committed tree, `docs/PHASE1_SCOPE.md` (esp. P1-12), and `docs/ARCHITECTURE.md` security sections.  
**Date:** 2026-09-21.  
**Stance:** No fixes in this phase — findings only.

## Executive verdict

**NO-GO** for an enterprise / untrusted-task security gate. Compose defaults (`internal` network, non-root user, no Docker socket) are sound for contractor-local demos, but the control plane still treats isolation as soft application checks: host/GHA/OpenHands paths are effective RCE, write-allowlisting is bypassable, the artifact CLI can be forged into PASS, and several validator steps ignore network policy (SSRF / SQL side effects). Until those are fail-closed, P1-01 / P1-04 / P1-07 / P1-11 / P1-12 are **not met** for untrusted tasks or production-adjacent use.

## Findings

| Severity | Location | Finding |
| --- | --- | --- |
| Critical | `src/validator/validate-run-dir.ts:41` | Artifact CLI trusts forgeable `status.json`; missing check audit is not a hard fail → minted PASS |
| Critical | `src/agent/openhands-adapter.ts:55` | OpenHands spawned with full `process.env`, no sandbox/jail → host RCE / secret exfil |
| Critical | `src/agent/openhands-adapter.ts:127` | Uses agent-reported `changed_files`; `..` paths skip allowlist → write-policy bypass |
| Critical | `src/validator/checks/service-ping.ts:10` | `redis_ping` / `postgres_ready` / postgres `database_state` ignore `PIPELINE_ALLOW_NETWORK` |
| High | `src/validator/http-fetcher.ts:27` | SSRF: no destination allowlist (localhost, RFC1918, cloud metadata reachable when network on) |
| High | `.github/workflows/pipeline.yml:64` | `TASK='${{ inputs.task }}'` → workflow_dispatch shell injection; GHA sets `PIPELINE_ALLOW_NETWORK=true` on bare runner |
| High | `packages/validator/bin/restore-checkpoint.mjs:45` | Checkpoint restore wipes/writes arbitrary `--workspace` / meta path with no root allowlist |
| High | `src/validator/database-executor.ts:30` | Weak prod-string filter + raw SQL from task card |
| High | `docker/compose.yaml` vs ARCHITECTURE | Docs imply `network_mode: none`; Compose is `internal: true`; GHA/host skip Docker entirely |
| High | `src/controller/pipeline-controller.ts:65` | `assertNetworkAllowed(..., false)` is a dead gate (never denies agent phase) |
| Medium | `src/safety/execution-context.ts:88` | Empty write-allowlist fails open |
| Medium | `src/safety/execution-context.ts:77` | Lexical path checks only — symlink escape possible |
| Medium | `src/task/task-card.ts:61` | Untrusted markdown → task JSON without integrity/signing |
| Medium | `src/validator/checks/browser.ts:65` | `screenshotName` not path-validated → evidence dir traversal |
| Medium | `docker/compose.yaml:35` | Redis unauthenticated on internal network |
| Medium | `src/agent/openhands-adapter.ts:59` | Full env inheritance (PGPASSWORD, LLM keys, tokens) into agent |
| Medium | `src/safety/execution-context.ts:128` | Secret scan on agent text only — not diffs/files; evidence may leak secrets to GHA artifacts |
| Medium | evidence pack / `validate-run-dir.ts` | No hashes/signatures binding checks → status (tamper-evident PASS missing) |
| Low | `.env.docker.example:22` | Static disposable DB credentials (expected locally; risk if stack exposed) |
| Low | `package.json` | Caret ranges despite lockfile — unlock drift risk |
| Low | `src/config/load-config.ts:67` | Unconstrained `PIPELINE_OPENHANDS_COMMAND` |
| Low | safety kernel | `IRREVERSIBLE_ACTION` unused; P1-12 partly documentation-only |
| Info | `docker/Dockerfile` | `curl` in runtime image increases blast radius if egress enabled |

## Positive controls

- Compose `internal: true`, non-root `USER pipeline`, no Docker socket mount  
- GHA `permissions: contents: read`, no `pull_request_target`  
- In-process `IndependentValidator` ignores agent prose  
- Forbidden tools list in `task-safety.ts`; lockfile present  
- Path-escape tests for basic workspace boundaries  

## Recommended fix order (not implemented)

1. Harden GHA task input (env var + allowlisted paths only); default network off; prefer Compose job  
2. Integrity-bind evidence (hashes) and make validator CLI recompute or refuse unsigned PASS  
3. Enforce write-allowlist from filesystem snapshot only; reject `..` / absolute reported paths  
4. Sandbox OpenHands (container/seccomp); scrub env; never inherit secrets  
5. Destination allowlists for HTTP/GraphQL/browser; gate redis/postgres checks on network policy  
6. Constrain checkpoint restore to pipeline workspace roots  
7. Fail closed on empty allowlist; `realpath` checks; validate `screenshotName`

## Gate mapping

| ID | Security reading |
| --- | --- |
| P1-01 | Partial — Compose OK; host/GHA not isolated |
| P1-04 | Fail for OpenHands/host — allowlist bypassable |
| P1-07 | Fail for artifact CLI forgeability |
| P1-11 | Fail — injection + network-on bare runner |
| P1-12 | Partial — documented, not fully enforced at runtime |
