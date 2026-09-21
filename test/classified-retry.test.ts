import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLASSIFIED_RETRY_TABLE,
  classifyRetryCategory,
  MAX_RETRIES,
} from '../src/retry/classified-policy.js';
import { RetryPolicy } from '../src/retry/retry-policy.js';

test('MAX_RETRIES is 3 and there is no unbounded retry disposition', () => {
  assert.equal(MAX_RETRIES, 3);
  for (const rule of CLASSIFIED_RETRY_TABLE) {
    assert.ok(rule.maxOccurrences <= MAX_RETRIES);
    assert.notEqual(rule.disposition, 'CIRCUIT_BREAK');
  }
});

test('classified retry table matches the client actions', () => {
  const byCategory = new Map(CLASSIFIED_RETRY_TABLE.map((rule) => [rule.category, rule.disposition]));
  assert.equal(byCategory.get('temporary_container_failure'), 'RETRY');
  assert.equal(byCategory.get('browser_timeout'), 'RETRY_ONCE');
  assert.equal(byCategory.get('code_bug'), 'AGENT_REPAIR');
  assert.equal(byCategory.get('dependency_error'), 'AGENT_INVESTIGATE');
  assert.equal(byCategory.get('missing_credential'), 'AUTH_REQUIRED');
  assert.equal(byCategory.get('business_ambiguity'), 'CLIENT_DECISION');
  assert.equal(byCategory.get('dangerous_operation'), 'BLOCK');
  assert.equal(byCategory.get('production_target'), 'BLOCK');
});

test('temporary container failure retries then CIRCUIT_BREAK on the 3rd hit', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 5, maxTotalAttempts: 10 });
  const input = {
    signature: 'container',
    failureKind: 'transient_infrastructure' as const,
    category: 'temporary_container_failure' as const,
  };
  assert.equal(policy.decide(input).disposition, 'RETRY');
  assert.equal(policy.decide(input).shouldRetry, true);
  const third = policy.decide(input);
  assert.equal(third.shouldRetry, false);
  assert.equal(third.disposition, 'CIRCUIT_BREAK');
  assert.equal(third.circuitState, 'open');
});

test('browser timeout retries once only', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 5, maxTotalAttempts: 10 });
  const input = {
    signature: 'browser',
    failureKind: 'timeout' as const,
    failureCode: 'BROWSER_TIMEOUT',
    message: 'playwright timed out',
  };
  const first = policy.decide(input);
  assert.equal(first.shouldRetry, true);
  assert.equal(first.disposition, 'RETRY_ONCE');
  assert.equal(classifyRetryCategory(input), 'browser_timeout');
  const second = policy.decide(input);
  assert.equal(second.shouldRetry, false);
  assert.equal(second.circuitState, 'open');
  assert.notEqual(second.disposition, 'RETRY');
});

test('code bug is agent repair, not an open retry loop', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 10 });
  const first = policy.decide({
    signature: 'bug',
    failureKind: 'recoverable_implementation',
    failureCode: 'CODE_BUG',
    message: 'code bug in catalog adapter',
  });
  assert.equal(first.disposition, 'AGENT_REPAIR');
  assert.equal(first.shouldRetry, true);
});

test('dependency error is agent investigate', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 10 });
  const decision = policy.decide({
    signature: 'dep',
    failureKind: 'recoverable_implementation',
    failureCode: 'MODULE_NOT_FOUND',
    message: 'cannot find module playwright',
  });
  assert.equal(decision.disposition, 'AGENT_INVESTIGATE');
  assert.equal(decision.category, 'dependency_error');
});

test('missing credential is AUTH_REQUIRED and does not retry', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 10 });
  const decision = policy.decide({
    signature: 'cred',
    failureKind: 'unsafe_unknown',
    failureClass: 'auth_required',
    failureCode: 'MISSING_CREDENTIAL',
    message: 'missing credential for shop api',
  });
  assert.equal(decision.shouldRetry, false);
  assert.equal(decision.disposition, 'AUTH_REQUIRED');
  assert.equal(decision.action, 'stop_auth');
});

test('business ambiguity is CLIENT_DECISION', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 10 });
  const decision = policy.decide({
    signature: 'biz',
    failureKind: 'unsafe_unknown',
    failureCode: 'BUSINESS_AMBIGUITY',
    message: 'acceptance unclear — client decision required',
  });
  assert.equal(decision.shouldRetry, false);
  assert.equal(decision.disposition, 'CLIENT_DECISION');
});

test('dangerous operation and production target BLOCK immediately', () => {
  const policy = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 10 });
  const dangerous = policy.decide({
    signature: 'danger',
    failureKind: 'unsafe_unknown',
    failureCode: 'DANGEROUS_OPERATION',
    message: 'dangerous irreversible delete',
  });
  assert.equal(dangerous.disposition, 'BLOCK');
  assert.equal(dangerous.shouldRetry, false);

  const policy2 = new RetryPolicy({ maxIdenticalRetries: 3, maxTotalAttempts: 10 });
  const production = policy2.decide({
    signature: 'prod',
    failureKind: 'unsafe_unknown',
    failureCode: 'PRODUCTION_TARGET',
    message: 'refusing production database',
  });
  assert.equal(production.disposition, 'BLOCK');
  assert.equal(production.category, 'production_target');
  assert.equal(production.shouldRetry, false);
});
