#!/usr/bin/env bash
# Run a Phase 1 task card on the host with evidence under ./artifacts/<runId>/.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

TASK=""
MODE="acceptance"

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
    *)
      echo "Usage: ./scripts/run-task.sh --task <path> [--mode acceptance|baseline]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${TASK}" ]]; then
  echo "Missing --task" >&2
  exit 1
fi

mkdir -p artifacts workspace/runs
export PIPELINE_MODE="${MODE}"
export PIPELINE_ARTIFACTS_DIR="${PIPELINE_ARTIFACTS_DIR:-./artifacts}"
export PIPELINE_WORKSPACE_DIR="${PIPELINE_WORKSPACE_DIR:-./workspace/runs}"

# Public catalog markdown card → full scenario (demo server + checks).
if [[ "${TASK}" == *'/task.md' ]] || [[ "${TASK}" == 'evaluation-demo/task.md' ]] || [[ "${TASK}" == 'task.md' ]]; then
  node --import tsx -e "
    import { runPublicCatalogScenario } from './src/scenarios/public-catalog/run-scenario.ts';
    import { mkdirSync } from 'node:fs';
    mkdirSync('artifacts', { recursive: true });
    mkdirSync('workspace/runs', { recursive: true });
    const r = await runPublicCatalogScenario({
      rootDir: process.cwd(),
      runId: process.env.PIPELINE_RUN_ID || undefined,
      keepWorkspace: false,
      useRealBrowser: process.env.PIPELINE_USE_REAL_BROWSER === '1',
    });
    console.log(JSON.stringify({
      status: r.result.status,
      exitCode: r.result.exitCode,
      artifactDir: r.result.artifactDir,
      runId: r.result.runId,
    }, null, 2));
    process.exit(r.result.exitCode);
  "
  exit $?
fi

# Nail-patterns path task shortcut
if [[ "${TASK}" == *nail-patterns* ]]; then
  npm run scenario:nail-patterns
  exit $?
fi

npm run pipeline -- run --task "${TASK}"
