import assert from 'node:assert/strict';
import test from 'node:test';

import { demoTranscript, isDemoTaskPath } from '../src/cli/demo-transcript.js';

test('demo transcript matches the client stage log on PASS', () => {
  const lines = demoTranscript({
    status: 'PASS',
    checkNames: ['health', 'api-products', 'graphql-products', 'browser-catalog', 'db-state'],
  });
  assert.deepEqual(lines, [
    '[PIPELINE] Task received',
    '[COMPILER] Creating acceptance criteria',
    '[AGENT] Starting isolated workspace',
    '[AGENT] Inspecting repository',
    '[AGENT] Implementing changes',
    '[VALIDATOR] Running API checks',
    '[VALIDATOR] Running Playwright',
    '[VALIDATOR] Checking database',
    '[EVIDENCE] Collecting artifacts',
    '[RESULT] PASS',
  ]);
});

test('demo transcript omits validator stages that did not run', () => {
  const lines = demoTranscript({
    status: 'BLOCK',
    checkNames: ['evidence'],
  });
  assert.equal(lines.includes('[VALIDATOR] Running Playwright'), false);
  assert.equal(lines.at(-1), '[RESULT] BLOCK');
});

test('demo-task paths are recognized', () => {
  assert.equal(isDemoTaskPath('tasks/demo-task.yaml'), true);
  assert.equal(isDemoTaskPath('fixtures/tasks/hello-change.json'), false);
});
