import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAgentAdapter } from '../src/agent/mock-adapter.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { TaskRunner } from '../src/execution/task-runner.js';
import { createLogger } from '../src/logging/logger.js';
import type { EvidenceManifest } from '../src/models/types.js';
import { createRunId } from '../src/safety/execution-context.js';
import { minimalTask } from './helpers/minimal-task.js';

function configFor(root: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    mode: 'acceptance',
    artifactsDir: join(root, 'runs'),
    workspaceDir: join(root, 'workspace'),
    maxIdenticalRetries: 3,
    maxTotalAttempts: 5,
    allowNetwork: false,
    logLevel: 'error',
    writeAllowlist: ['src'],
    agentMode: 'mock',
    agentTimeoutMs: 60_000,
    openhandsCommand: 'openhands',
    mockAgentBehavior: 'success',
    ...overrides,
  };
}

const CLIENT_FILES = [
  'task.json',
  'scenario.json',
  'execution.log',
  'agent.log',
  'git-diff.patch',
  'validation.json',
  'recovery.json',
  'rollback.md',
  'final-report.html',
] as const;

const CLIENT_DIRS = ['api', 'graphql', 'screenshots', 'playwright', 'database'] as const;

const REQUIRED_FILES = [
  'result.json',
  'task.json',
  'execution.log',
  'validation.json',
  'test-results.json',
  'git.diff',
  'summary.html',
  'rollback.md',
  'evidence-manifest.json',
] as const;

const FINAL_REPORT_QUESTIONS = [
  'WHAT WAS REQUESTED?',
  'WHAT DID THE AGENT DO?',
  'WHAT CHANGED?',
  'WHAT WAS TESTED?',
  'WHAT ACTUALLY PASSED?',
  'WHAT FAILED?',
  'WAS ANY RETRY PERFORMED?',
  'WHY?',
  'WAS ROLLBACK NEEDED?',
  'FINAL RESULT?',
] as const;

function assertEvidencePack(runDir: string, expectedStatus: 'PASS' | 'BLOCK'): EvidenceManifest {
  assert.ok(existsSync(runDir), `run directory missing: ${runDir}`);
  for (const name of REQUIRED_FILES) {
    assert.ok(existsSync(join(runDir, name)), `missing evidence file: ${name}`);
  }
  for (const name of CLIENT_FILES) {
    assert.ok(existsSync(join(runDir, name)), `missing client evidence file: ${name}`);
  }
  for (const name of CLIENT_DIRS) {
    assert.ok(existsSync(join(runDir, name)), `missing client evidence dir: ${name}`);
  }
  assert.ok(existsSync(join(runDir, 'api-responses')));

  const result = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8')) as {
    status: string;
    verdictBasis: string;
    agentClaimedSuccessIgnored: boolean;
  };
  assert.equal(result.status, expectedStatus);
  assert.equal(result.agentClaimedSuccessIgnored, true);
  assert.ok(result.verdictBasis.length > 0);

  const summary = readFileSync(join(runDir, 'summary.html'), 'utf8');
  assert.ok(summary.includes(expectedStatus));
  assert.ok(summary.includes('Agent claimed success'));

  const finalReport = readFileSync(join(runDir, 'final-report.html'), 'utf8');
  for (const question of FINAL_REPORT_QUESTIONS) {
    assert.ok(finalReport.includes(question), `final-report.html missing ${question}`);
  }
  assert.ok(finalReport.includes(expectedStatus));

  const recovery = JSON.parse(readFileSync(join(runDir, 'recovery.json'), 'utf8')) as {
    attemptCount: number;
    maxRetries: number;
    retriesPerformed: boolean;
  };
  assert.equal(recovery.maxRetries, 3);
  assert.ok(recovery.attemptCount >= 1);

  const scenario = JSON.parse(readFileSync(join(runDir, 'scenario.json'), 'utf8')) as {
    taskId: string;
    goal: string;
  };
  assert.ok(scenario.taskId.length > 0);
  assert.ok(scenario.goal.length > 0);

  const manifest = JSON.parse(
    readFileSync(join(runDir, 'evidence-manifest.json'), 'utf8'),
  ) as EvidenceManifest;
  assert.equal(manifest.status, expectedStatus);
  assert.ok(manifest.entries.length >= REQUIRED_FILES.length);
  for (const name of ['task.json', 'final-report.html', 'recovery.json', 'git-diff.patch'] as const) {
    const entry = manifest.entries.find((item) => item.path === name);
    assert.ok(entry, `manifest missing ${name}`);
    assert.equal(entry.present, true);
  }
  return manifest;
}

test('createRunId uses YYYY-MM-DD-NNN and increments per day', () => {
  const root = mkdtempSync(join(tmpdir(), 'runid-'));
  try {
    const now = new Date('2026-09-21T12:00:00.000Z');
    const first = createRunId(now, root);
    assert.equal(first, '2026-09-21-001');
    mkdirSync(join(root, first), { recursive: true });
    const second = createRunId(now, root);
    assert.equal(second, '2026-09-21-002');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PASS run writes complete evidence pack under runs/<runId>/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'evidence-pass-'));
  try {
    const task = minimalTask({
      id: 'evidence-pass',
      cleanupWorkspace: true,
      validationSteps: [
        { id: 'evidence', type: 'evidence_present' },
        { id: 'hello-exists', type: 'workspace_file_exists', path: 'src/hello.txt' },
        {
          id: 'hello-marker',
          type: 'workspace_file_contains',
          path: 'src/hello.txt',
          contains: 'HELLO_PIPELINE',
        },
      ],
    });
    const runner = new TaskRunner({
      config: configFor(root, { runId: 'pass-run' }),
      logger: createLogger({ level: 'error' }),
      agent: new MockAgentAdapter({ behavior: 'success' }),
      runTests: async () => 0,
    });

    const result = await runner.execute(task);
    assert.equal(result.status, 'PASS');
    assert.equal(result.artifactDir, join(root, 'runs', 'pass-run'));
    assert.ok(result.evidenceManifest);

    const manifest = assertEvidencePack(result.artifactDir, 'PASS');
    assert.equal(manifest.runId, 'pass-run');
    assert.ok(readdirSync(join(root, 'runs')).includes('pass-run'));

    const taskJson = JSON.parse(readFileSync(join(result.artifactDir, 'task.json'), 'utf8')) as {
      id: string;
    };
    assert.equal(taskJson.id, 'evidence-pass');

    const validation = JSON.parse(
      readFileSync(join(result.artifactDir, 'validation.json'), 'utf8'),
    ) as { status: string; checks: unknown[] };
    assert.equal(validation.status, 'PASS');
    assert.ok(validation.checks.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK run writes complete evidence pack explaining the failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'evidence-block-'));
  try {
    const task = minimalTask({
      id: 'evidence-block',
      cleanupWorkspace: true,
      validationSteps: [
        { id: 'evidence', type: 'evidence_present' },
        { id: 'missing-change', type: 'changed_files_include', path: 'src/never-written.txt' },
      ],
    });
    const runner = new TaskRunner({
      config: configFor(root, { runId: 'block-run' }),
      logger: createLogger({ level: 'error' }),
      agent: new MockAgentAdapter({ behavior: 'success' }),
      runTests: async () => 0,
    });

    const result = await runner.execute(task);
    assert.equal(result.status, 'BLOCK');
    assert.equal(result.artifactDir, join(root, 'runs', 'block-run'));

    const manifest = assertEvidencePack(result.artifactDir, 'BLOCK');
    assert.ok(manifest.entries.some((entry) => entry.path === 'result.json' && entry.present));

    const resultJson = JSON.parse(
      readFileSync(join(result.artifactDir, 'result.json'), 'utf8'),
    ) as {
      failedChecks: Array<{ checkName: string; actual: string }>;
      verdictBasis: string;
    };
    assert.ok(resultJson.failedChecks.some((check) => check.checkName === 'missing-change'));
    assert.ok(resultJson.verdictBasis.toLowerCase().includes('failed'));

    const html = readFileSync(join(result.artifactDir, 'final-report.html'), 'utf8');
    assert.ok(html.includes('missing-change'));
    assert.ok(html.includes('WHAT FAILED?'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
