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

import {
  applyRollbackPolicy,
  createPreAgentCheckpoint,
} from '../src/safety/git-checkpoint.js';

test('pre-agent checkpoint creates git ref and filesystem snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'git-checkpoint-'));
  const workspace = join(root, 'workspace');
  const artifacts = join(root, 'artifacts');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(workspace, 'seed.txt'), 'before\n');

  const result = createPreAgentCheckpoint({
    workspaceDir: workspace,
    artifactDir: artifacts,
  });

  assert.ok(existsSync(join(artifacts, 'workspace-checkpoint', 'seed.txt')));
  assert.ok(existsSync(join(artifacts, 'rollback.md')));
  assert.ok(existsSync(join(artifacts, 'checkpoint-meta.json')));
  assert.equal(result.filesystem.entryCount >= 1, true);
  // git should be available on CI/dev macOS
  assert.equal(result.git.available, true);
  assert.ok(result.git.checkpointRef);

  rmSync(root, { recursive: true, force: true });
});

test('successful run preserves; unrecoverable failure restores workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'rollback-policy-'));
  const workspace = join(root, 'workspace');
  const artifacts = join(root, 'artifacts');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(workspace, 'seed.txt'), 'before\n');

  createPreAgentCheckpoint({ workspaceDir: workspace, artifactDir: artifacts });
  writeFileSync(join(workspace, 'seed.txt'), 'mutated\n');
  writeFileSync(join(workspace, 'extra.txt'), 'new\n');

  const preserved = applyRollbackPolicy({
    status: 'PASS',
    workspaceDir: workspace,
    artifactDir: artifacts,
  });
  assert.equal(preserved.action, 'preserve');
  assert.equal(preserved.preserved, true);
  assert.equal(preserved.workspaceRestored, false);
  assert.equal(readFileSync(join(workspace, 'seed.txt'), 'utf8'), 'mutated\n');
  assert.ok(existsSync(join(artifacts, 'rollback-outcome.json')));

  // Re-checkpoint after preserve so failure path has a clean baseline again.
  createPreAgentCheckpoint({ workspaceDir: workspace, artifactDir: artifacts });
  writeFileSync(join(workspace, 'seed.txt'), 'broken\n');
  writeFileSync(join(workspace, 'extra2.txt'), 'more\n');

  const rolled = applyRollbackPolicy({
    status: 'BLOCK',
    workspaceDir: workspace,
    artifactDir: artifacts,
    agentDiff: 'diff --git a/seed.txt b/seed.txt\n',
  });
  assert.equal(rolled.action, 'rollback');
  assert.equal(rolled.preserved, false);
  assert.equal(rolled.gitDiffCaptured, true);
  assert.equal(rolled.workspaceRestored, true);
  assert.ok(existsSync(join(artifacts, 'git-diff.patch')));
  assert.equal(readFileSync(join(workspace, 'seed.txt'), 'utf8'), 'mutated\n');
  assert.equal(existsSync(join(workspace, 'extra2.txt')), false);

  const guide = readFileSync(join(artifacts, 'rollback.md'), 'utf8');
  assert.match(guide, /Before agent modification/i);
  assert.match(guide, /rollback/i);

  rmSync(root, { recursive: true, force: true });
});
