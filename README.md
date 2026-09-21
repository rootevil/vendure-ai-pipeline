# vendure-ai-pipeline

Contractor Phase 1 **autonomous engineering and validation pipeline skeleton** for Vendure-related work.

It accepts a bounded task, runs an agent inside an isolated workspace, collects evidence, and lets an **independent validator** decide `PASS` / `BLOCK`. It is **not** the full client Vendure Batch 1+2 migration, and it does **not** claim production or minipc access.

## What is implemented

| Capability | Status |
| --- | --- |
| Task JSON schema + CLI (`vendure-pipeline run`) | Yes |
| Markdown task card for `evaluation-demo/task.md` (maps to catalog scenario) | Yes |
| Mock agent + OpenHands CLI adapter | Yes (default = mock) |
| Independent validation (health/HTTP/GraphQL/browser/DB/path checks) | Yes |
| Evidence packs under `artifacts/<runId>/` | Yes |
| Bounded retries + circuit breaker | Yes |
| Docker Compose stack (pipeline + Postgres + Redis, internal network) | Yes |
| Public catalog E2E scenario | Yes (scenario agent applies published reference adapter) |
| Nail-patterns path-invariant scenario | Yes |
| Recoverable / unrecoverable failure demos | Yes |
| GitHub Actions `workflow_dispatch` | Yes (allowlisted task paths) |
| Validator CLI `packages/validator/bin/validate.mjs` | Yes |

## What is not implemented

- Full OpenHands multi-role team / Buzz orchestration
- Live Vendure Shop/Admin + Stripe/Mailpit long-chain E2E
- Cryptographic evidence signing
- Hard sandbox for OpenHands (seccomp / nested VM)
- Private client repos, production, or unrestricted minipc/SSH

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) and [docs/SECURITY_LIMITATIONS.md](docs/SECURITY_LIMITATIONS.md).

## Handover path (new developer)

1. Clone → install → configure — [docs/QUICKSTART.md](docs/QUICKSTART.md)  
2. Environment variables — [docs/CONFIGURATION.md](docs/CONFIGURATION.md)  
3. Docker stack — [docs/DOCKER_SETUP.md](docs/DOCKER_SETUP.md)  
4. Run pipeline / demos — QUICKSTART § Pipeline & demos  
5. Evidence & PASS/BLOCK — [docs/VALIDATION.md](docs/VALIDATION.md)  
6. Failure/recovery — QUICKSTART § Failure demos + [docs/FAILURE_DEMO.md](docs/FAILURE_DEMO.md)  
7. Architecture — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)  
8. Evaluator clean-room demo — [docs/FINAL_DEMO.md](docs/FINAL_DEMO.md)  
9. Delivery gate — [docs/DELIVERY_CHECKLIST.md](docs/DELIVERY_CHECKLIST.md)  
10. Stuck? — [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

```bash
git clone <this-repo>
cd vendure-ai-pipeline
npm ci
cp .env.example .env          # optional local overrides; never commit secrets
./scripts/start.sh            # Docker stack (Colima: see DOCKER_SETUP)
./scripts/check.sh
npm run scenario:public-catalog
ls artifacts/                 # or temp path printed by the scenario
node packages/validator/bin/validate.mjs --run-dir artifacts/<run_id>
./scripts/cleanup.sh
```

## Layout

```text
src/pipeline|compiler|agent|execution|validators|recovery|evidence|safety|config
                      Adaptive control-loop façades (thin orchestration)
src/controller|task|validator|retry|scenarios
                      Core implementations behind the façades
tasks/                Human YAML cards + machine JSON companions
validators/           Pointer to offline artifact validator CLI
fixtures/tasks/       Additional JSON fixtures
docker/               Dockerfile + Compose (internal network)
scripts/              start/stop/check/cleanup, scenario runners
evaluation-demo/      Public client evaluation package
artifacts/ | runs/    Evidence roots (default: artifacts/)
tests/                Layout mirror; executable tests in test/
packages/             Validator CLI surface
docs/                 ARCHITECTURE, SAFETY, VALIDATION, LIMITATIONS, …
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the control-loop diagram and module map.

## Security boundary

Do not connect this repository to production, private client credentials, or unrestricted minipc/SSH. Default agent mode is `mock` (no LLM). Inject any OpenHands/LLM credentials at runtime only.

## License / ownership

Contractor-owned Phase 1 workspace. Client contract language lives under `docs/CONTRACT_*.md` and related briefing files for reference; Phase 1 delivery boundary is `docs/PHASE1_SCOPE.md`.
