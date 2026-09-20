import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAgentAdapter } from '../src/agent/mock-adapter.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { TaskRunner } from '../src/execution/task-runner.js';
import { createLogger } from '../src/logging/logger.js';
import {
  loadTaskDefinitionFromJsonFile,
  parseTaskDefinition,
} from '../src/task/task-definition.js';
import { TaskDefinitionError } from '../src/task/task-definition.js';
import { minimalTask } from './helpers/minimal-task.js';

function configFor(root: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    mode: 'acceptance',
    artifactsDir: join(root, 'artifacts'),
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

test('complete flow: hello-change task PASSes with report and cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-flow-'));
  try {
    const task = loadTaskDefinitionFromJsonFile(
      join(process.cwd(), 'fixtures/tasks/hello-change.json'),
    );
    const runner = new TaskRunner({
      config: configFor(root, { runId: 'hello-run' }),
      logger: createLogger({ level: 'error' }),
      agent: new MockAgentAdapter({ behavior: 'success' }),
      runTests: async () => 0,
    });

    const result = await runner.execute(task);
    assert.equal(result.status, 'PASS');
    assert.equal(result.exitCode, 0);
    assert.equal(result.workspaceCleaned, true);
    assert.ok(result.report);
    assert.ok(existsSync(join(result.artifactDir, 'report.json')));
    assert.ok(existsSync(join(result.artifactDir, 'report.md')));
    assert.ok(result.report?.flow.includes('parse/validate task'));
    assert.ok(result.report?.flow.includes('generate report'));
    assert.ok(result.validationSteps.every((step) => step.passed));
    assert.ok(result.changedFiles.some((file) => file.includes('hello.txt')));
    assert.equal(existsSync(join(root, 'workspace', 'hello-run')), false);

    const report = JSON.parse(readFileSync(join(result.artifactDir, 'report.json'), 'utf8')) as {
      status: string;
      acceptanceCriteria: string[];
    };
    assert.equal(report.status, 'PASS');
    assert.ok(report.acceptanceCriteria.length >= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects tasks with path traversal before execution', () => {
  assert.throws(
    () =>
      parseTaskDefinition(
        minimalTask({
          writeAllowlist: ['../outside'],
        }),
      ),
    (error: unknown) => error instanceof TaskDefinitionError,
  );
});

test('rejects tasks with absolute write paths', () => {
  assert.throws(
    () =>
      parseTaskDefinition(
        minimalTask({
          writeAllowlist: ['/etc/passwd'],
        }),
      ),
    (error: unknown) => error instanceof TaskDefinitionError,
  );
});

test('rejects tasks missing acceptance criteria', () => {
  assert.throws(
    () =>
      parseTaskDefinition({
        ...minimalTask(),
        acceptanceCriteria: [],
      }),
    (error: unknown) => error instanceof TaskDefinitionError,
  );
});

test('validation step failure blocks even if agent claimed success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-block-'));
  try {
    const task = minimalTask({
      id: 'expect-missing-change',
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
    assert.ok(result.validationSteps.some((step) => step.id === 'missing-change' && !step.passed));
    assert.ok(existsSync(join(result.artifactDir, 'report.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
