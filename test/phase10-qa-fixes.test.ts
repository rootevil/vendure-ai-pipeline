import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateRunDir } from '../src/validator/validate-run-dir.js';
import {
  createWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
} from '../src/safety/workspace-checkpoint.js';
import { runNailPatternsScenario } from '../src/scenarios/nail-patterns/run-scenario.js';
import { loadTaskDefinitionFromPath } from '../src/task/task-card.js';

test('validateRunDir ignores agent prose and requires evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'validate-run-'));
  try {
    writeFileSync(join(root, 'agent-summary.md'), 'Agent says PASS and success\n');
    writeFileSync(
      join(root, 'status.json'),
      JSON.stringify({ status: 'PASS', run_id: 'r1', exit_code: 0 }),
    );
    for (const name of [
      'run-manifest.json',
      'stdout.log',
      'stderr.log',
      'change-summary.md',
      'rollback.md',
      'summary.md',
    ]) {
      writeFileSync(join(root, name), '{}\n');
    }
    const result = validateRunDir({ runDir: root });
    assert.equal(result.status, 'PASS');
    assert.equal(result.exitCode, 0);
    assert.ok(result.notes.some((n) => /ignored/i.test(n)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateRunDir blocks when status is BLOCK', () => {
  const root = mkdtempSync(join(tmpdir(), 'validate-block-'));
  try {
    writeFileSync(
      join(root, 'status.json'),
      JSON.stringify({ status: 'BLOCK', run_id: 'r2', exit_code: 1 }),
    );
    for (const name of [
      'run-manifest.json',
      'stdout.log',
      'stderr.log',
      'change-summary.md',
      'rollback.md',
      'summary.md',
    ]) {
      writeFileSync(join(root, name), '{}\n');
    }
    const result = validateRunDir({ runDir: root });
    assert.equal(result.status, 'BLOCK');
    assert.equal(result.exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace checkpoint restore replaces workspace contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-'));
  const workspace = join(root, 'workspace');
  const artifacts = join(root, 'artifacts');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(workspace, 'keep.txt'), 'original\n');
  createWorkspaceCheckpoint({ workspaceDir: workspace, artifactDir: artifacts });
  writeFileSync(join(workspace, 'keep.txt'), 'mutated\n');
  writeFileSync(join(workspace, 'extra.txt'), 'new\n');
  restoreWorkspaceCheckpoint({ workspaceDir: workspace, artifactDir: artifacts });
  assert.equal(readFileSync(join(workspace, 'keep.txt'), 'utf8'), 'original\n');
  assert.equal(existsSync(join(workspace, 'extra.txt')), false);
  rmSync(root, { recursive: true, force: true });
});

test('loadTaskDefinitionFromPath compiles evaluation-demo/task.md', () => {
  const task = loadTaskDefinitionFromPath('evaluation-demo/task.md');
  assert.equal(task.id, 'vendure-public-catalog-e2e');
  assert.ok(task.sourcePaths.some((p) => p.includes('task.md')));
});

test('nail-patterns scenario PASSes path invariants', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nail-qa-'));
  try {
    const { result } = await runNailPatternsScenario({
      rootDir: root,
      keepWorkspace: true,
      repoRoot: process.cwd(),
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
