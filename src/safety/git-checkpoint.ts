import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import type { RunStatus } from '../models/types.js';
import {
  createWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
  type CheckpointMeta,
} from './workspace-checkpoint.js';

const CHECKPOINT_REF = 'refs/pipeline/checkpoint';
const OUTCOME_FILE = 'rollback-outcome.json';

export type RollbackAction = 'preserve' | 'rollback';

export interface PreAgentCheckpointResult {
  readonly filesystem: CheckpointMeta;
  readonly git: GitCheckpointState;
}

export interface GitCheckpointState {
  readonly available: boolean;
  readonly checkpointRef: string | null;
  readonly message: string;
}

export interface RollbackOutcome {
  readonly action: RollbackAction;
  readonly status: RunStatus;
  readonly gitDiffCaptured: boolean;
  readonly workspaceRestored: boolean;
  readonly preserved: boolean;
  readonly reason: string;
  readonly checkpointRef: string | null;
}

/**
 * Phase 1 rollback policy (simple):
 *
 *   Before agent modification → git checkpoint (+ filesystem snapshot)
 *   After successful run      → commit / preserve
 *   After unrecoverable failure → git diff + git reset / restore workspace
 */
export function createPreAgentCheckpoint(input: {
  readonly workspaceDir: string;
  readonly artifactDir: string;
  readonly now?: () => Date;
}): PreAgentCheckpointResult {
  const filesystem = createWorkspaceCheckpoint(input);
  const git = ensureGitCheckpoint(input.workspaceDir);
  writeRollbackGuide({
    artifactDir: input.artifactDir,
    git,
    phase: 'pre-agent',
  });
  writeJson(join(input.artifactDir, 'checkpoint-meta.json'), {
    ...filesystem,
    git,
    checkpointRef: git.checkpointRef,
  });
  return { filesystem, git };
}

/**
 * Apply Phase 1 preserve-or-rollback after the independent validator decides.
 * PASS / BASELINE_BLOCKED_EXPECTED → preserve.
 * Anything else → capture diff and restore workspace to the pre-agent checkpoint.
 */
export function applyRollbackPolicy(input: {
  readonly status: RunStatus;
  readonly workspaceDir: string;
  readonly artifactDir: string;
  readonly agentDiff?: string;
}): RollbackOutcome {
  const success = input.status === 'PASS' || input.status === 'BASELINE_BLOCKED_EXPECTED';
  if (success) {
    return preserveSuccessfulRun(input);
  }
  return rollbackUnrecoverableFailure(input);
}

function preserveSuccessfulRun(input: {
  readonly status: RunStatus;
  readonly workspaceDir: string;
  readonly artifactDir: string;
}): RollbackOutcome {
  const git = inspectGit(input.workspaceDir);
  if (git.available) {
    runGit(input.workspaceDir, ['add', '-A']);
    runGit(input.workspaceDir, [
      '-c',
      'user.email=pipeline-checkpoint@local',
      '-c',
      'user.name=pipeline-checkpoint',
      'commit',
      '--allow-empty',
      '-m',
      `pipeline-preserve: ${input.status}`,
    ]);
  }

  const outcome: RollbackOutcome = {
    action: 'preserve',
    status: input.status,
    gitDiffCaptured: existsSync(join(input.artifactDir, 'git-diff.patch')) ||
      existsSync(join(input.artifactDir, 'git.diff')) ||
      existsSync(join(input.artifactDir, 'diff.patch')),
    workspaceRestored: false,
    preserved: true,
    reason:
      'Successful run — workspace changes preserved in evidence (git-diff.patch) and local pipeline-preserve commit when git is available. Disposable workspace may still be cleaned when cleanupWorkspace=true.',
    checkpointRef: git.checkpointRef,
  };
  writeOutcome(input.artifactDir, outcome);
  writeRollbackGuide({
    artifactDir: input.artifactDir,
    git,
    phase: 'preserve',
    outcome,
  });
  return outcome;
}

function rollbackUnrecoverableFailure(input: {
  readonly status: RunStatus;
  readonly workspaceDir: string;
  readonly artifactDir: string;
  readonly agentDiff?: string;
}): RollbackOutcome {
  const git = inspectGit(input.workspaceDir);
  let gitDiffCaptured = false;
  let workspaceRestored = false;

  // Always capture a reviewable diff before resetting.
  const diffFromGit =
    git.available && git.checkpointRef
      ? runGit(input.workspaceDir, ['diff', git.checkpointRef]).stdout
      : git.available
        ? runGit(input.workspaceDir, ['diff']).stdout
        : '';
  const diffBody =
    (input.agentDiff && input.agentDiff.trim().length > 0 ? input.agentDiff : diffFromGit) ||
    'No git diff captured for this run.\n';
  writeText(join(input.artifactDir, 'git-diff.patch'), diffBody);
  writeText(join(input.artifactDir, 'git.diff'), diffBody);
  if (!existsSync(join(input.artifactDir, 'diff.patch'))) {
    writeText(join(input.artifactDir, 'diff.patch'), diffBody);
  }
  gitDiffCaptured = true;

  if (git.available && git.checkpointRef) {
    const reset = runGit(input.workspaceDir, ['reset', '--hard', git.checkpointRef]);
    const clean = runGit(input.workspaceDir, ['clean', '-fd']);
    workspaceRestored = reset.ok && clean.ok;
  }

  if (!workspaceRestored) {
    try {
      restoreWorkspaceCheckpoint({
        workspaceDir: input.workspaceDir,
        artifactDir: input.artifactDir,
      });
      workspaceRestored = true;
    } catch {
      workspaceRestored = false;
    }
  }

  const outcome: RollbackOutcome = {
    action: 'rollback',
    status: input.status,
    gitDiffCaptured,
    workspaceRestored,
    preserved: false,
    reason: workspaceRestored
      ? `Unrecoverable ${input.status} — git diff captured; workspace restored to pre-agent checkpoint.`
      : `Unrecoverable ${input.status} — git diff captured; workspace restore failed or checkpoint missing (discard disposable workspace).`,
    checkpointRef: git.checkpointRef,
  };
  writeOutcome(input.artifactDir, outcome);
  writeRollbackGuide({
    artifactDir: input.artifactDir,
    git,
    phase: 'rollback',
    outcome,
  });
  return outcome;
}

function ensureGitCheckpoint(workspaceDir: string): GitCheckpointState {
  mkdirSync(workspaceDir, { recursive: true });
  if (!isGitAvailable()) {
    return {
      available: false,
      checkpointRef: null,
      message: 'git binary not available; filesystem checkpoint only',
    };
  }

  if (!existsSync(join(workspaceDir, '.git'))) {
    const init = runGit(workspaceDir, ['init']);
    if (!init.ok) {
      return {
        available: false,
        checkpointRef: null,
        message: `git init failed: ${init.stderr || init.stdout}`,
      };
    }
  }

  // Local identity only — never touches the contractor repo git config.
  runGit(workspaceDir, ['config', 'user.email', 'pipeline-checkpoint@local']);
  runGit(workspaceDir, ['config', 'user.name', 'pipeline-checkpoint']);

  runGit(workspaceDir, ['add', '-A']);
  const commit = runGit(workspaceDir, [
    '-c',
    'user.email=pipeline-checkpoint@local',
    '-c',
    'user.name=pipeline-checkpoint',
    'commit',
    '--allow-empty',
    '-m',
    'pipeline-checkpoint: pre-agent',
  ]);
  if (!commit.ok && !/nothing to commit/i.test(commit.stderr + commit.stdout)) {
    // Still try to set the ref from HEAD if a prior commit exists.
  }

  const head = runGit(workspaceDir, ['rev-parse', 'HEAD']);
  if (!head.ok) {
    return {
      available: false,
      checkpointRef: null,
      message: `git checkpoint commit failed: ${commit.stderr || head.stderr}`,
    };
  }

  const updateRef = runGit(workspaceDir, ['update-ref', CHECKPOINT_REF, head.stdout.trim()]);
  if (!updateRef.ok) {
    return {
      available: true,
      checkpointRef: head.stdout.trim(),
      message: 'checkpoint recorded as HEAD (update-ref failed)',
    };
  }

  return {
    available: true,
    checkpointRef: CHECKPOINT_REF,
    message: `pre-agent checkpoint at ${CHECKPOINT_REF}`,
  };
}

function inspectGit(workspaceDir: string): GitCheckpointState {
  if (!isGitAvailable() || !existsSync(join(workspaceDir, '.git'))) {
    return {
      available: false,
      checkpointRef: null,
      message: 'no git checkpoint in workspace',
    };
  }
  const refCheck = runGit(workspaceDir, ['rev-parse', '--verify', CHECKPOINT_REF]);
  if (refCheck.ok) {
    return {
      available: true,
      checkpointRef: CHECKPOINT_REF,
      message: `checkpoint ref ${CHECKPOINT_REF}`,
    };
  }
  const head = runGit(workspaceDir, ['rev-parse', 'HEAD']);
  return {
    available: head.ok,
    checkpointRef: head.ok ? head.stdout.trim() : null,
    message: head.ok ? 'using HEAD as checkpoint' : 'git repo without usable HEAD',
  };
}

function writeRollbackGuide(input: {
  readonly artifactDir: string;
  readonly git: GitCheckpointState;
  readonly phase: 'pre-agent' | 'preserve' | 'rollback';
  readonly outcome?: RollbackOutcome;
}): void {
  const lines = [
    '# Rollback',
    '',
    'Phase 1 policy (simple):',
    '',
    '1. **Before agent modification** — git checkpoint (+ filesystem `workspace-checkpoint/`)',
    '2. **After successful run** — commit / preserve (evidence keeps the patch)',
    '3. **After unrecoverable failure** — git diff, then git reset / restore workspace',
    '',
    'Do not mutate client main or production.',
    '',
    `Git checkpoint: ${input.git.available ? input.git.message : 'filesystem only — ' + input.git.message}`,
    '',
  ];

  if (input.phase === 'pre-agent') {
    lines.push(
      'A pre-agent checkpoint was taken.',
      '',
      'Restore manually if needed:',
      '',
      '```bash',
      `node packages/validator/bin/restore-checkpoint.mjs --run-dir ${input.artifactDir}`,
      '```',
      '',
    );
  } else if (input.phase === 'preserve' && input.outcome) {
    lines.push(
      `Outcome: **preserve** (${input.outcome.status}).`,
      input.outcome.reason,
      '',
      'Evidence: `git-diff.patch`, `rollback-outcome.json`.',
      '',
    );
  } else if (input.phase === 'rollback' && input.outcome) {
    lines.push(
      `Outcome: **rollback** (${input.outcome.status}).`,
      input.outcome.reason,
      '',
      `- Diff captured: ${String(input.outcome.gitDiffCaptured)}`,
      `- Workspace restored: ${String(input.outcome.workspaceRestored)}`,
      '',
      'Evidence: `git-diff.patch`, `rollback-outcome.json`, `workspace-checkpoint/`.',
      '',
    );
  }

  writeText(join(input.artifactDir, 'rollback.md'), lines.join('\n'));
}

function writeOutcome(artifactDir: string, outcome: RollbackOutcome): void {
  writeJson(join(artifactDir, OUTCOME_FILE), outcome);
}

function isGitAvailable(): boolean {
  const result = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function runGit(
  cwd: string,
  args: readonly string[],
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path: string, value: string): void {
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}
