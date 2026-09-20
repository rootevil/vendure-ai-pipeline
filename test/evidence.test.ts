import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAgentAdapter } from '../src/agent/mock-adapter.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { TaskRunner } from '../src/execution/task-runner.js';
import { createLogger } from '../src/logging/logger.js';
import type { EvidenceManifest } from '../src/models/types.js';
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

function assertEvidencePack(runDir: string, expectedStatus: 'PASS' | 'BLOCK'): EvidenceManifest {
  assert.ok(existsSync(runDir), `run directory missing: ${runDir}`);
  for (const name of REQUIRED_FILES) {
    assert.ok(existsSync(join(runDir, name)), `missing evidence file: ${name}`);
  }
  assert.ok(existsSync(join(runDir, 'screenshots')));
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
  assert.ok(summary.includes('Agent claimed success is never used'));

  const manifest = JSON.parse(
    readFileSync(join(runDir, 'evidence-manifest.json'), 'utf8'),
  ) as EvidenceManifest;
  assert.equal(manifest.status, expectedStatus);
  assert.ok(manifest.entries.length >= REQUIRED_FILES.length);
  for (const name of REQUIRED_FILES) {
    const entry = manifest.entries.find((item) => item.path === name);
    assert.ok(entry, `manifest missing ${name}`);
    assert.equal(entry.present, true);
    assert.ok(entry.type.length > 0);
    assert.ok(entry.description.length > 0);
  }
  return manifest;
}

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

    const html = readFileSync(join(result.artifactDir, 'summary.html'), 'utf8');
    assert.ok(html.includes('missing-change'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
