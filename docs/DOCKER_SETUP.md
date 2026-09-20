# Docker Isolation Setup

This repository runs the Phase 1 pipeline control plane inside an isolated, non-production Docker Compose stack with disposable Postgres and Redis.

## What you get

| Service | Role |
| --- | --- |
| `pipeline` | Built from `docker/Dockerfile`; runs the TypeScript CLI keep-alive + health probe |
| `postgres` | PostgreSQL 16 (Alpine), internal network only |
| `redis` | Redis 7 (no AOF/RDB persistence), internal network only |

Guarantees for this phase:

- reproducible multi-stage Node 20 image build (lockfile + pinned base tags)
- compose network is `internal: true` (no egress from containers)
- no host port publishes for Postgres/Redis/pipeline
- CPU, memory, and PID limits plus log rotation
- health checks on every service
- disposable named volumes removed by `./scripts/cleanup.sh`
- credentials in `.env.docker` are **local disposable placeholders only**

## Prerequisites

- Docker Engine with Compose v2 (`docker compose`) **or** `docker-compose`
- On macOS without Docker Desktop, Colima works:

```bash
brew install colima docker docker-compose
colima start --cpu 2 --memory 4 --disk 20
export DOCKER_HOST=unix://$HOME/.colima/docker.sock
# If pulls fail with docker-credential-desktop missing, remove "credsStore":"desktop"
# from ~/.docker/config.json (public image pulls do not need it).
```

## First-time setup

```bash
cp .env.docker.example .env.docker   # if missing; start.sh also copies automatically
chmod +x scripts/*.sh
./scripts/start.sh
./scripts/check.sh
```

## Everyday commands

```bash
./scripts/start.sh     # build + up + wait healthy
./scripts/check.sh     # re-run health probes
./scripts/stop.sh      # stop containers, keep volumes
./scripts/cleanup.sh   # down + delete volumes (fresh state)
```

npm shortcuts:

```bash
npm run docker:start
npm run docker:check
npm run docker:stop
npm run docker:cleanup
```

Equivalent Compose entrypoint:

```bash
docker compose -f docker/compose.yaml --env-file .env.docker up -d --build
docker compose -f docker/compose.yaml --env-file .env.docker ps
docker compose -f docker/compose.yaml --env-file .env.docker down --volumes
```

## Verify a clean restart

```bash
./scripts/cleanup.sh
./scripts/start.sh
./scripts/check.sh
./scripts/stop.sh
./scripts/cleanup.sh
./scripts/start.sh
./scripts/check.sh
./scripts/cleanup.sh
```

A second start after cleanup must recreate empty volumes and still become healthy.

## Security notes

- Do not put production secrets, API keys, SSH keys, or live payment credentials in `.env.docker`
- `.env.docker` is gitignored; commit only `.env.docker.example`
- Compose network has no outbound internet; image pulls happen on the host before containers start
- This stack is contractor-local / non-production only (`PIPELINE_ENV=nonprod`)

## Layout

```text
docker/Dockerfile
docker/compose.yaml
.dockerignore
.env.docker.example
scripts/docker/healthcheck.mjs
scripts/docker/keep-alive.mjs
scripts/docker-stack.sh
scripts/start.sh
scripts/stop.sh
scripts/check.sh
scripts/cleanup.sh
docs/DOCKER_SETUP.md
```
