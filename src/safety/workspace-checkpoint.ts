import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const CHECKPOINT_DIRNAME = 'workspace-checkpoint';
const META_FILE = 'checkpoint-meta.json';

export interface CheckpointMeta {
  readonly createdAt: string;
  readonly sourceWorkspaceDir: string;
  readonly entryCount: number;
}

/**
 * Snapshot the disposable workspace into artifactDir/workspace-checkpoint/.
 * Used for rollback/restore after unsafe or exhausted runs.
 */
export function createWorkspaceCheckpoint(input: {
  readonly workspaceDir: string;
  readonly artifactDir: string;
  readonly now?: () => Date;
}): CheckpointMeta {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const target = join(input.artifactDir, CHECKPOINT_DIRNAME);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });

  let entryCount = 0;
  if (existsSync(input.workspaceDir)) {
    for (const name of readdirSync(input.workspaceDir)) {
      if (name === '.git' || name === 'node_modules') {
        continue;
      }
      cpSync(join(input.workspaceDir, name), join(target, name), {
        recursive: true,
        force: true,
      });
      entryCount += 1;
    }
  }

  const meta: CheckpointMeta = {
    createdAt: now,
    sourceWorkspaceDir: input.workspaceDir,
    entryCount,
  };
  writeFileSync(join(input.artifactDir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(input.artifactDir, 'rollback.md'),
    [
      '# Rollback',
      '',
      'Discard the disposable workspace for this runId and retain only this evidence directory.',
      'Do not mutate client main.',
      '',
      'A filesystem checkpoint was written to `workspace-checkpoint/`.',
      'Restore with:',
      '',
      '```bash',
      `node packages/validator/bin/restore-checkpoint.mjs --run-dir ${input.artifactDir}`,
      '```',
      '',
    ].join('\n'),
    'utf8',
  );
  return meta;
}

export function restoreWorkspaceCheckpoint(input: {
  readonly workspaceDir: string;
  readonly artifactDir: string;
  /** Optional roots the workspace must remain under (fail closed). */
  readonly allowedRoots?: readonly string[];
}): CheckpointMeta {
  const checkpointDir = join(input.artifactDir, CHECKPOINT_DIRNAME);
  if (!existsSync(checkpointDir) || !statSync(checkpointDir).isDirectory()) {
    throw new Error(`Checkpoint missing under ${checkpointDir}`);
  }

  const workspaceDir = resolve(input.workspaceDir);
  assertWorkspaceUnderAllowedRoots(workspaceDir, input.allowedRoots);

  mkdirSync(workspaceDir, { recursive: true });
  for (const name of readdirSync(workspaceDir)) {
    rmSync(join(workspaceDir, name), { recursive: true, force: true });
  }
  let entryCount = 0;
  for (const name of readdirSync(checkpointDir)) {
    cpSync(join(checkpointDir, name), join(workspaceDir, name), {
      recursive: true,
      force: true,
    });
    entryCount += 1;
  }

  const metaPath = join(input.artifactDir, META_FILE);
  if (existsSync(metaPath)) {
    return JSON.parse(readFileSync(metaPath, 'utf8')) as CheckpointMeta;
  }
  return {
    createdAt: new Date().toISOString(),
    sourceWorkspaceDir: workspaceDir,
    entryCount,
  };
}

export function assertWorkspaceUnderAllowedRoots(
  workspaceDir: string,
  allowedRoots?: readonly string[],
): void {
  const roots =
    allowedRoots && allowedRoots.length > 0
      ? allowedRoots.map((root) => resolve(root))
      : [
          resolve(process.env.PIPELINE_WORKSPACE_DIR ?? './workspace'),
          resolve(tmpdir()),
          resolve(process.cwd(), 'workspace'),
        ];
  const underRoot = roots.some((root) => {
    const rel = relative(root, workspaceDir);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
  if (!underRoot) {
    throw new Error(
      `Refusing checkpoint restore outside allowed workspace roots: ${workspaceDir}`,
    );
  }
}
