import { spawnSync } from 'node:child_process';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';

/**
 * Ping Redis via redis-cli (available in the Docker runtime image).
 */
export async function runRedisPingCheck(
  step: Extract<ValidationStep, { type: 'redis_ping' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const url = step.url ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0';
  const expected = `redis-cli PONG for ${url}`;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname || '127.0.0.1';
    const port = parsed.port || '6379';
    const result = spawnSync('redis-cli', ['-h', host, '-p', port, 'ping'], {
      encoding: 'utf8',
      timeout: step.timeoutMs,
    });
    const stdout = (result.stdout ?? '').trim();
    const passed = result.status === 0 && stdout.includes('PONG');
    return createCheckResult({
      checkName: step.id,
      status: passed ? 'PASS' : 'FAIL',
      expected,
      actual: passed ? 'PONG' : `status=${String(result.status)} stdout=${stdout} stderr=${(result.stderr ?? '').trim()}`,
      output: JSON.stringify({ url, host, port, stdout, stderr: result.stderr ?? '' }, null, 2),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  } catch (error) {
    return createCheckResult({
      checkName: step.id,
      status: 'ERROR',
      expected,
      actual: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? (error.stack ?? error.message) : String(error),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }
}

/**
 * Probe Postgres via pg_isready (available in the Docker runtime image).
 */
export async function runPostgresReadyCheck(
  step: Extract<ValidationStep, { type: 'postgres_ready' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const connectionString =
    step.connectionString ?? process.env.DATABASE_URL ?? process.env.PGHOST ?? '';
  const expected = 'pg_isready reports accepting connections';

  try {
    if (/prod|production/i.test(connectionString)) {
      return createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: 'Refusing production-looking connection string',
        output: 'blocked',
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }

    const args = buildPgIsReadyArgs(connectionString);
    const result = spawnSync('pg_isready', args, {
      encoding: 'utf8',
      timeout: step.timeoutMs,
      env: process.env,
    });
    const stdout = (result.stdout ?? '').trim();
    const passed = result.status === 0;
    return createCheckResult({
      checkName: step.id,
      status: passed ? 'PASS' : 'FAIL',
      expected,
      actual: passed ? stdout || 'accepting connections' : `status=${String(result.status)} ${stdout} ${(result.stderr ?? '').trim()}`,
      output: JSON.stringify({ args, stdout, stderr: result.stderr ?? '' }, null, 2),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  } catch (error) {
    return createCheckResult({
      checkName: step.id,
      status: 'ERROR',
      expected,
      actual: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? (error.stack ?? error.message) : String(error),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }
}

function buildPgIsReadyArgs(connectionString: string): string[] {
  if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) {
    try {
      const parsed = new URL(connectionString);
      const args = ['-h', parsed.hostname || '127.0.0.1', '-p', parsed.port || '5432'];
      if (parsed.username) {
        args.push('-U', decodeURIComponent(parsed.username));
      }
      const db = parsed.pathname.replace(/^\//, '');
      if (db) {
        args.push('-d', db);
      }
      return args;
    } catch {
      // fall through to env-based defaults
    }
  }

  const args: string[] = [];
  const host = process.env.PGHOST ?? '127.0.0.1';
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ?? 'pipeline';
  const database = process.env.PGDATABASE ?? 'pipeline';
  args.push('-h', host, '-p', port, '-U', user, '-d', database);
  return args;
}
