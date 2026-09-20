#!/usr/bin/env node
/**
 * Keeps the pipeline runner container alive for health checks and interactive runs.
 * Disposable non-production helper — not a production process manager.
 */
import { spawnSync } from 'node:child_process';

const intervalMs = Number.parseInt(process.env.PIPELINE_KEEPALIVE_INTERVAL_MS ?? '15000', 10);

function probe() {
  const result = spawnSync(process.execPath, ['/app/scripts/docker/healthcheck.mjs'], {
    encoding: 'utf8',
    env: process.env,
    timeout: 10_000,
  });
  const payload = {
    ts: new Date().toISOString(),
    status: result.status === 0 ? 'healthy' : 'unhealthy',
    exitCode: result.status,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

probe();
setInterval(probe, Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 15_000);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
