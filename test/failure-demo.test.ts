import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLogger } from '../src/logging/logger.js';
import { runFailureDemo } from '../src/scenarios/public-catalog/failure-demo.js';

test('recoverable failure demo repairs then PASSes broader validation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'failure-recover-'));
  try {
    const demo = await runFailureDemo({
      mode: 'recoverable',
      rootDir: root,
      runId: 'recover-pass',
      keepWorkspace: true,
      maxRepairAttempts: 1,
      logger: createLogger({ level: 'error' }),
    });

    assert.equal(demo.mode, 'recoverable');
    assert.equal(demo.result.status, 'PASS');
    assert.equal(demo.result.exitCode, 0);
    assert.equal(demo.repairAttempts, 1);
    assert.ok(demo.steps.some((step) => step.name === 'inject-controlled-failure' && step.ok));
    assert.ok(demo.steps.some((step) => step.name === 'deliberate-failure' && step.ok));
    assert.ok(demo.steps.some((step) => step.name === 'targeted-validation-initial' && !step.ok));
    assert.ok(demo.steps.some((step) => step.name === 'capture-logs' && step.ok));
    assert.ok(demo.steps.some((step) => step.name === 'classify-failure'));
    assert.ok(demo.steps.some((step) => step.name === 'provide-repair-evidence' && step.ok));
    assert.ok(demo.steps.some((step) => step.name === 'agent-investigates' && step.ok));
    assert.ok(demo.steps.some((step) => step.name.startsWith('bounded-repair-attempt-')));
    assert.ok(demo.steps.some((step) => step.name === 'smallest-fix' && step.ok));
    assert.ok(
      demo.steps.some((step) => step.name === 'targeted-validation-after-repair-1' && step.ok),
    );
    assert.ok(demo.steps.some((step) => step.name === 'run-targeted-reproducer' && step.ok));
    assert.ok(demo.steps.some((step) => step.name === 'broader-validation' && step.ok));
    assert.ok(
      demo.steps.some((step) => step.name === 'run-regression-independent-validation' && step.ok),
    );

    assert.ok(existsSync(join(demo.result.artifactDir, 'failure-demo.json')));
    assert.ok(existsSync(join(demo.result.artifactDir, 'failed-state', 'failure-snapshot.json')));
    assert.ok(existsSync(join(demo.result.artifactDir, 'failed-state', 'catalog.mjs.failed')));
    assert.ok(existsSync(join(demo.result.artifactDir, 'result.json')));
    assert.ok(existsSync(join(demo.result.artifactDir, 'summary.html')));
    const payload = JSON.parse(
      readFileSync(join(demo.result.artifactDir, 'failure-demo.json'), 'utf8'),
    ) as {
      status: string;
      repairAttempts: number;
      deliberateFailure: { expected: string; actual: string };
      recoveryProcess: string[];
    };
    assert.equal(payload.status, 'PASS');
    assert.equal(payload.repairAttempts, 1);
    assert.ok(payload.deliberateFailure.expected.includes('storefront'));
    assert.ok(payload.recoveryProcess.includes('Classify failure'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unrecoverable failure demo stops with BLOCK and evidence (no repair)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'failure-unsafe-'));
  try {
    const demo = await runFailureDemo({
      mode: 'unrecoverable',
      rootDir: root,
      runId: 'unsafe-block',
      keepWorkspace: true,
      logger: createLogger({ level: 'error' }),
    });

    assert.equal(demo.mode, 'unrecoverable');
    assert.equal(demo.result.status, 'BLOCK');
    assert.equal(demo.result.exitCode, 1);
    assert.equal(demo.repairAttempts, 0);
    assert.ok(!demo.steps.some((step) => step.name.includes('repair-attempt')));
    assert.ok(
      demo.steps.some(
        (step) =>
          step.failureKind === 'unsafe_unknown' &&
          (step.name.includes('unsafe') ||
            step.name.includes('classify') ||
            step.name.includes('stop')),
      ),
    );
    assert.ok(existsSync(join(demo.result.artifactDir, 'failure-demo.json')));
    assert.ok(existsSync(join(demo.result.artifactDir, 'result.json')));
    const resultJson = JSON.parse(
      readFileSync(join(demo.result.artifactDir, 'result.json'), 'utf8'),
    ) as { status: string; verdictBasis: string };
    assert.equal(resultJson.status, 'BLOCK');
    assert.ok(
      resultJson.verdictBasis.toLowerCase().includes('fail') || resultJson.status === 'BLOCK',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
