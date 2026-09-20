import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyFailure } from '../src/retry/failure-classifier.js';
import { RetryPolicy, buildFailureSignature } from '../src/retry/retry-policy.js';

test('RetryPolicy retries recoverable implementation failures within identical budget', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 5 });
  const signature = buildFailureSignature({
    failureClass: 'recoverable',
    failureKind: 'recoverable_implementation',
    message: 'implementation bug',
    code: 'MOCK_RETRYABLE',
  });

  const first = policy.recordAttempt(signature, 'recoverable_implementation');
  const second = policy.recordAttempt(signature, 'recoverable_implementation');
  const third = policy.recordAttempt(signature, 'recoverable_implementation');

  assert.equal(first.shouldRetry, true);
  assert.equal(first.action, 'retry_agent');
  assert.equal(second.shouldRetry, true);
  assert.equal(third.shouldRetry, false);
  assert.equal(third.failureKind, 'repeated');
  assert.equal(third.circuitState, 'open');
  assert.match(third.reason, /budget/);
});

test('RetryPolicy retries transient infrastructure failures within budget then stops', () => {
  const policy = new RetryPolicy({
    maxIdenticalRetries: 5,
    maxTotalAttempts: 10,
    maxTransientRetries: 2,
  });
  const signature = 'transient|tool_crash';

  assert.equal(policy.recordAttempt(signature, 'transient_infrastructure').shouldRetry, true);
  const second = policy.recordAttempt(signature, 'transient_infrastructure');
  assert.equal(second.shouldRetry, false);
  assert.equal(second.circuitState, 'open');
  assert.equal(second.failureKind, 'repeated');
});

test('RetryPolicy retries timeouts within budget then opens circuit', () => {
  const policy = new RetryPolicy({
    maxIdenticalRetries: 4,
    maxTotalAttempts: 10,
    maxTimeoutRetries: 2,
  });
  const signature = 'timeout|agent';
  assert.equal(policy.recordAttempt(signature, 'timeout').shouldRetry, true);
  assert.equal(policy.recordAttempt(signature, 'timeout').shouldRetry, false);
  assert.equal(policy.circuitState, 'open');
});

test('RetryPolicy stops immediately on unsafe/unknown and does not retry', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 5 });
  const decision = policy.recordAttempt('unsafe|secret', 'unsafe_unknown');
  assert.equal(decision.shouldRetry, false);
  assert.equal(decision.circuitState, 'open');
  assert.match(decision.reason, /Unsafe or unknown/);

  // Further attempts remain stopped by the open circuit.
  const next = policy.recordAttempt('other', 'recoverable_implementation');
  assert.equal(next.shouldRetry, false);
  assert.match(next.reason, /Circuit breaker open/);
});

test('RetryPolicy stops immediately on auth_required', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 5 });
  const auth = policy.decide({
    signature: 'auth',
    failureKind: 'unsafe_unknown',
    authRequired: true,
  });
  assert.equal(auth.shouldRetry, false);
  assert.equal(auth.action, 'stop_auth');
});

test('RetryPolicy respects total attempt budget across different signatures', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 5, maxTotalAttempts: 3 });
  assert.equal(policy.recordAttempt('a', 'recoverable_implementation').shouldRetry, true);
  assert.equal(policy.recordAttempt('b', 'recoverable_implementation').shouldRetry, true);
  assert.equal(policy.recordAttempt('c', 'recoverable_implementation').shouldRetry, false);
  assert.equal(policy.circuitState, 'open');
});

test('validation failures never retry the agent to obtain PASS', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 5, maxTotalAttempts: 10 });
  const decision = policy.recordValidationFailure('missing evidence: status.json');
  assert.equal(decision.shouldRetry, false);
  assert.equal(decision.failureKind, 'validation');
  assert.equal(decision.action, 'stop');
  assert.match(decision.reason, /evidence/);
  assert.equal(policy.circuitState, 'open');
});

test('legacy FailureClass recoverable still maps to retryable path', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 2, maxTotalAttempts: 5 });
  const first = policy.recordAttempt('legacy', 'recoverable');
  assert.equal(first.shouldRetry, true);
  assert.equal(first.failureKind, 'recoverable_implementation');
});

test('legacy FailureClass unknown fails closed (no retry)', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 5 });
  const decision = policy.recordAttempt('unk', 'unknown');
  assert.equal(decision.shouldRetry, false);
  assert.equal(decision.failureKind, 'unsafe_unknown');
});

test('classifyFailure maps codes to Phase 7 kinds', () => {
  assert.equal(
    classifyFailure({ failureClass: 'recoverable', failureCode: 'TOOL_CRASH' }),
    'transient_infrastructure',
  );
  assert.equal(
    classifyFailure({ failureClass: 'recoverable', failureCode: 'AGENT_TIMEOUT' }),
    'timeout',
  );
  assert.equal(
    classifyFailure({ failureClass: 'recoverable', failureCode: 'MOCK_RETRYABLE' }),
    'recoverable_implementation',
  );
  assert.equal(
    classifyFailure({ failureClass: 'non_recoverable', failureCode: 'MOCK_FAILURE' }),
    'unsafe_unknown',
  );
  assert.equal(classifyFailure({ isValidationFailure: true }), 'validation');
  assert.equal(classifyFailure({ isRepeated: true }), 'repeated');
  assert.equal(classifyFailure({ failureClass: 'unknown' }), 'unsafe_unknown');
});
