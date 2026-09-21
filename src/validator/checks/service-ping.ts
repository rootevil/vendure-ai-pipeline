import { spawnSync } from 'node:child_process';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import {
  isAllowedStackDependencyHost,
  looksLikeProductionTarget,
} from '../../safety/redaction.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';

/**
 * Ping Redis via redis-cli (available in the Docker runtime image).
 * Host must be on PIPELINE_STACK_HOST_ALLOWLIST (default: redis, postgres, loopback).
 */
export async function runRedisPingCheck(
  step: Extract<ValidationStep, { type: 'redis_ping' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const url = step.url ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0';
  const expected = `redis-cli PONG for stack-allowlisted host`;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname || '127.0.0.1';
    const port = parsed.port || '6379';
    if (!isAllowedStackDependencyHost(host)) {
      return createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: `Host ${host} is not in PIPELINE_STACK_HOST_ALLOWLIST`,
        output: JSON.stringify({ url, host }, null, 2),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }
    if (looksLikeProductionTarget(url)) {
      return createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: 'Refusing production-looking Redis URL',
        output: 'blocked',
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }

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
      actual: passed
        ? 'PONG'
        : `status=${String(result.status)} stdout=${stdout} stderr=${(result.stderr ?? '').trim()}`,
      output: JSON.stringify({ host, port, stdout, stderr: result.stderr ?? '' }, null, 2),
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
  const expected = 'pg_isready reports accepting connections (stack-allowlisted host)';

  try {
    if (looksLikeProductionTarget(connectionString)) {
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
    const hostIdx = args.indexOf('-h');
    const host = hostIdx >= 0 ? (args[hostIdx + 1] ?? '127.0.0.1') : '127.0.0.1';
    if (!isAllowedStackDependencyHost(host)) {
      return createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: `Host ${host} is not in PIPELINE_STACK_HOST_ALLOWLIST`,
        output: JSON.stringify({ args }, null, 2),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }

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
      actual: passed
        ? stdout || 'accepting connections'
        : `status=${String(result.status)} ${stdout} ${(result.stderr ?? '').trim()}`,
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

  const host = process.env.PGHOST ?? '127.0.0.1';
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ?? 'pipeline';
  const database = process.env.PGDATABASE ?? 'pipeline';
  return ['-h', host, '-p', port, '-U', user, '-d', database];
}
