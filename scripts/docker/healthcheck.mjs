#!/usr/bin/env node
/**
 * Container health probe for the pipeline runtime image.
 * Exit 0 when the process tree and (optionally) Postgres/Redis are ready.
 * Never prints credentials.
 */
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

const full = process.argv.includes('--full');

function ok(message) {
  process.stdout.write(`${JSON.stringify({ status: 'ok', message })}\n`);
}

function fail(message, code = 1) {
  process.stderr.write(`${JSON.stringify({ status: 'fail', message })}\n`);
  process.exit(code);
}

function canRead(path) {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, env = process.env) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    env,
    timeout: 8_000,
  });
}

if (!canRead('/app/dist/cli/index.js')) {
  fail('pipeline CLI build artifact missing at /app/dist/cli/index.js');
}

const help = run(process.execPath, ['/app/dist/cli/index.js', 'help']);
if (help.status !== 0) {
  fail(`pipeline CLI help failed with exit ${String(help.status)}`);
}

if (full || process.env.PIPELINE_HEALTH_REQUIRE_DEPS === 'true') {
  const pgHost = process.env.PGHOST ?? 'postgres';
  const pgPort = process.env.PGPORT ?? '5432';
  const pgUser = process.env.PGUSER ?? 'pipeline';
  const pgDatabase = process.env.PGDATABASE ?? 'pipeline';

  const pg = run('pg_isready', ['-h', pgHost, '-p', pgPort, '-U', pgUser, '-d', pgDatabase]);
  if (pg.status !== 0) {
    fail(`postgres not ready (${pgHost}:${pgPort}/${pgDatabase})`);
  }

  const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379/0';
  let redisHost = 'redis';
  let redisPort = '6379';
  try {
    const parsed = new URL(redisUrl);
    redisHost = parsed.hostname || redisHost;
    redisPort = parsed.port || redisPort;
  } catch {
    fail('REDIS_URL is invalid');
  }

  const redis = run('redis-cli', ['-h', redisHost, '-p', redisPort, 'ping']);
  if (redis.status !== 0 || !(redis.stdout ?? '').includes('PONG')) {
    fail(`redis not ready (${redisHost}:${redisPort})`);
  }

  ok('pipeline CLI, postgres, and redis are healthy');
  process.exit(0);
}

ok('pipeline CLI is healthy');
process.exit(0);
