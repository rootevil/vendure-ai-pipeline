import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig, ConfigError } from '../src/config/load-config.js';

test('loadConfig applies defaults when env is empty', () => {
  const config = loadConfig({});
  assert.equal(config.mode, 'acceptance');
  assert.equal(config.artifactsDir, './artifacts');
  assert.equal(config.workspaceDir, './workspace/runs');
  assert.equal(config.maxIdenticalRetries, 3);
  assert.equal(config.maxTotalAttempts, 5);
  assert.equal(config.allowNetwork, false);
  assert.equal(config.logLevel, 'info');
  assert.deepEqual(config.writeAllowlist, []);
  assert.equal(config.agentMode, 'mock');
  assert.equal(config.agentTimeoutMs, 120_000);
  assert.equal(config.openhandsCommand, 'openhands');
  assert.equal(config.mockAgentBehavior, 'success');
});

test('loadConfig parses boolean and CSV allowlist', () => {
  const config = loadConfig({
    PIPELINE_MODE: 'baseline',
    PIPELINE_ALLOW_NETWORK: 'true',
    PIPELINE_WRITE_ALLOWLIST: 'src, app ,evaluation-demo/app',
    PIPELINE_MAX_IDENTICAL_RETRIES: '2',
    PIPELINE_MAX_TOTAL_ATTEMPTS: '4',
    PIPELINE_LOG_LEVEL: 'debug',
    PIPELINE_RUN_ID: 'fixed-run',
    PIPELINE_AGENT_MODE: 'openhands',
    PIPELINE_AGENT_TIMEOUT_MS: '60000',
    PIPELINE_OPENHANDS_COMMAND: 'openhands',
    PIPELINE_MOCK_AGENT_BEHAVIOR: 'failure',
  });
  assert.equal(config.mode, 'baseline');
  assert.equal(config.allowNetwork, true);
  assert.deepEqual(config.writeAllowlist, ['src', 'app', 'evaluation-demo/app']);
  assert.equal(config.maxIdenticalRetries, 2);
  assert.equal(config.maxTotalAttempts, 4);
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.runId, 'fixed-run');
  assert.equal(config.agentMode, 'openhands');
  assert.equal(config.agentTimeoutMs, 60_000);
  assert.equal(config.mockAgentBehavior, 'failure');
});

test('loadConfig rejects identical retries above total attempts', () => {
  assert.throws(
    () =>
      loadConfig({
        PIPELINE_MAX_IDENTICAL_RETRIES: '5',
        PIPELINE_MAX_TOTAL_ATTEMPTS: '3',
      }),
    (error: unknown) => error instanceof ConfigError,
  );
});

test('loadConfig rejects invalid integers', () => {
  assert.throws(
    () => loadConfig({ PIPELINE_MAX_IDENTICAL_RETRIES: '0' }),
    (error: unknown) => error instanceof ConfigError,
  );
});
