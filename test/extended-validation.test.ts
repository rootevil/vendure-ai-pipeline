import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  runExtendedValidation,
} from '../src/validators/extended-validation.js';
import {
  LOAD_TEST_TOOLS,
  UnconfiguredLoadTestAdapter,
} from '../src/validators/load/load-test-adapter.js';
import {
  RED_TEAM_TOOLS,
  UnconfiguredRedTeamAdapter,
} from '../src/validators/security/red-team-adapter.js';
import type { LoadTestAdapter } from '../src/validators/load/load-test-adapter.js';

test('MVP load and red-team adapters are extension points, not formal acceptance', async () => {
  const load = new UnconfiguredLoadTestAdapter();
  const red = new UnconfiguredRedTeamAdapter();
  assert.deepEqual(load.possibleTools, ['artillery', 'k6']);
  assert.deepEqual(red.possibleTools, ['semgrep', 'trivy', 'codeql', 'sqlmap']);
  assert.deepEqual([...LOAD_TEST_TOOLS], [...load.possibleTools]);
  assert.deepEqual([...RED_TEAM_TOOLS], [...red.possibleTools]);

  const root = mkdtempSync(join(tmpdir(), 'extended-pass-'));
  try {
    const report = await runExtendedValidation({
      runId: 'r1',
      artifactDir: root,
      workspaceDir: root,
      businessStatus: 'PASS',
    });
    assert.equal(report.load.status, 'NOT_RUN');
    assert.equal(report.load.implemented, false);
    assert.equal(report.security.status, 'NOT_RUN');
    assert.equal(report.security.implemented, false);
    assert.equal(report.blocksBusinessPass, false);
    assert.match(report.summary, /not formal/i);
    assert.ok(existsSync(join(root, 'load', 'result.json')));
    assert.ok(existsSync(join(root, 'security', 'result.json')));
    const saved = JSON.parse(readFileSync(join(root, 'extended-validation.json'), 'utf8')) as {
      businessStatus: string;
    };
    assert.equal(saved.businessStatus, 'PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a configured load adapter FAIL blocks; NOT_RUN does not', async () => {
  const failing: LoadTestAdapter = {
    name: 'fake-k6',
    possibleTools: ['k6'],
    async run() {
      return {
        status: 'FAIL',
        implemented: true,
        tool: 'k6',
        summary: 'synthetic threshold missed',
      };
    },
  };
  const root = mkdtempSync(join(tmpdir(), 'extended-fail-'));
  try {
    const report = await runExtendedValidation({
      runId: 'r2',
      artifactDir: root,
      workspaceDir: root,
      businessStatus: 'PASS',
      loadTest: failing,
    });
    assert.equal(report.blocksBusinessPass, true);
    assert.equal(report.security.implemented, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
