#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker/compose.yaml"
ENV_FILE="${ROOT_DIR}/.env.docker"
ENV_EXAMPLE="${ROOT_DIR}/.env.docker.example"

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
    die "Docker is not installed."
  fi
  if [[ -z "${DOCKER_HOST:-}" ]] && [[ -S "${HOME}/.colima/docker.sock" ]]; then
    export DOCKER_HOST="unix://${HOME}/.colima/docker.sock"
    log "Using Colima docker socket via DOCKER_HOST=${DOCKER_HOST}"
  fi
  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is not reachable. On macOS with Colima: 'colima start' then export DOCKER_HOST=unix://\$HOME/.colima/docker.sock"
  fi
}

ensure_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    log "Created ${ENV_FILE} from example (disposable local placeholders only)."
  fi
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
  else
    die "Neither 'docker compose' nor 'docker-compose' is available."
  fi
}

service_health() {
  local service="$1"
  compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null |
    awk -v svc="${service}" '$1 == svc {print $2; exit}' || true
}

wait_healthy() {
  local service="$1"
  local timeout_s="${2:-120}"
  local started
  started="$(date +%s)"
  while true; do
    local health=""
    health="$(service_health "${service}")"
    if [[ "${health}" == "healthy" ]]; then
      log "${service} is healthy"
      return 0
    fi

    if compose exec -T "${service}" true >/dev/null 2>&1; then
      case "${service}" in
        pipeline)
          if compose exec -T pipeline node /app/scripts/docker/healthcheck.mjs --full >/dev/null 2>&1; then
            log "${service} probe passed"
            return 0
          fi
          ;;
        postgres)
          if compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
            log "${service} probe passed"
            return 0
          fi
          ;;
        redis)
          if compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
            log "${service} probe passed"
            return 0
          fi
          ;;
      esac
    fi

    local now
    now="$(date +%s)"
    if ((now - started > timeout_s)); then
      compose ps || true
      compose logs --tail=80 "${service}" || true
      die "Timed out waiting for ${service} to become healthy"
    fi
    sleep 3
  done
}

assert_clean_volumes_absent() {
  local project='vendure-ai-pipeline'
  local remaining
  remaining="$(
    docker volume ls --format '{{.Name}}' |
      grep -E "^${project}_(postgres_data|redis_data|pipeline_artifacts|pipeline_workspace)$" || true
  )"
  if [[ -n "${remaining}" ]]; then
    die "Expected disposable volumes to be removed after cleanup; still present:
${remaining}"
  fi
  log 'Disposable volumes are absent (clean state).'
}

cmd="${1:-}"
ensure_docker
case "${cmd}" in
  start)
    ensure_env_file
    log 'Building and starting isolated stack...'
    compose pull postgres redis
    compose build pipeline
    compose up -d --remove-orphans
    wait_healthy postgres 90
    wait_healthy redis 90
    wait_healthy pipeline 180
    compose ps
    log 'Stack is up.'
    ;;
  stop)
    ensure_env_file
    log 'Stopping stack (volumes retained)...'
    compose stop
    compose ps -a || true
    log 'Stack stopped.'
    ;;
  check)
    ensure_env_file
    wait_healthy postgres 30
    wait_healthy redis 30
    wait_healthy pipeline 30
    compose exec -T pipeline node /app/scripts/docker/healthcheck.mjs --full
    log 'Health check passed.'
    ;;
  cleanup)
    ensure_env_file
    log 'Shutting down and removing disposable volumes...'
    compose down --volumes --remove-orphans
    assert_clean_volumes_absent
    log 'Clean state restored (named volumes removed).'
    ;;
  *)
    cat <<'EOF'
Usage: scripts/docker-stack.sh <start|stop|check|cleanup>

  start    Build images, start postgres/redis/pipeline, wait until healthy
  stop     Stop containers (keep volumes)
  check    Verify health probes
  cleanup  Stop containers and delete disposable volumes (fresh state)
EOF
    exit 1
    ;;
esac
