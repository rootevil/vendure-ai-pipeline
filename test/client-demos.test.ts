import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blockDemoLines,
  recoveryDemoLines,
  successDemoLines,
} from '../src/cli/client-demos.js';

test('success demo flow is Task → Agent → Tests → Browser → API → DB → PASS', () => {
  assert.deepEqual(
    successDemoLines({
      status: 'PASS',
      checkNames: ['acceptance-tests', 'browser-catalog', 'api-products', 'graphql-products', 'db-state'],
    }),
    ['Task', '→ Agent', '→ Tests', '→ Browser', '→ API', '→ DB', '→ PASS'],
  );
});

test('recovery demo flow ends in PASS only from the real status', () => {
  assert.deepEqual(
    recoveryDemoLines({
      status: 'PASS',
      stepNames: [
        'deliberate-failure',
        'classify-failure',
        'agent-investigates',
        'smallest-fix',
        'run-regression-independent-validation',
      ],
    }),
    ['Task', '→ Agent', '→ Failure', '→ Diagnosis', '→ Fix', '→ Retest', '→ PASS'],
  );
});

test('block demo shows retries exhausted, circuit breaker, BLOCK, and evidence', () => {
  assert.deepEqual(
    blockDemoLines({
      status: 'BLOCK',
      attempts: [
        { failureKind: 'transient_infrastructure' },
        { failureKind: 'transient_infrastructure' },
        { failureKind: 'repeated' },
      ],
      evidencePresent: true,
    }),
    ['Failure', '→ retries exhausted', '→ circuit breaker', '→ BLOCK', '→ evidence'],
  );
});
