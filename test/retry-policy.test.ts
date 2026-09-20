import assert from 'node:assert/strict';
import test from 'node:test';

import { RetryPolicy, buildFailureSignature } from '../src/retry/retry-policy.js';

test('RetryPolicy retries recoverable failures within identical budget', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 5 });
  const signature = buildFailureSignature({
    failureClass: 'recoverable',
    message: 'tool crashed',
    code: 'TOOL',
  });

  const first = policy.recordAttempt(signature, 'recoverable');
  const second = policy.recordAttempt(signature, 'recoverable');
  const third = policy.recordAttempt(signature, 'recoverable');

  assert.equal(first.shouldRetry, true);
  assert.equal(second.shouldRetry, true);
  assert.equal(third.shouldRetry, false);
  assert.match(third.reason, /Identical failure/);
});

test('RetryPolicy stops immediately on non_recoverable and auth_required', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 5 });
  const nonRecoverable = policy.recordAttempt('nr', 'non_recoverable');
  assert.equal(nonRecoverable.shouldRetry, false);

  policy.reset();
  const auth = policy.recordAttempt('auth', 'auth_required');
  assert.equal(auth.shouldRetry, false);
});

test('RetryPolicy respects total attempt budget across different signatures', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 5, maxTotalAttempts: 3 });
  assert.equal(policy.recordAttempt('a', 'recoverable').shouldRetry, true);
  assert.equal(policy.recordAttempt('b', 'recoverable').shouldRetry, true);
  assert.equal(policy.recordAttempt('c', 'recoverable').shouldRetry, false);
});
