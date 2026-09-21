#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TASK=""
MODE="acceptance"
USE_REAL_BROWSER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)
      TASK="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-acceptance}"
      shift 2
      ;;
    --real-browser)
      USE_REAL_BROWSER=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      echo "Usage: ./scripts/start.sh [--task <path>] [--mode acceptance|baseline] [--real-browser]" >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

if [[ -n "${TASK}" ]]; then
  export PIPELINE_MODE="${MODE}"
  export PIPELINE_USE_REAL_BROWSER="${USE_REAL_BROWSER}"
  exec "${ROOT_DIR}/scripts/run-task.sh" --task "${TASK}" --mode "${MODE}"
fi

exec "${ROOT_DIR}/scripts/docker-stack.sh" start
