import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface WorkspaceSnapshot {
  readonly files: ReadonlyMap<string, string>;
}

const IGNORE_DIR_NAMES = new Set(['.git', 'node_modules', 'artifacts', 'dist', '.openhands']);

export function snapshotWorkspace(rootDir: string): WorkspaceSnapshot {
  const files = new Map<string, string>();
  walk(rootDir, rootDir, files);
  return { files };
}

export function diffSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): { changedFiles: string[]; diff: string } {
  const changedFiles: string[] = [];
  const lines: string[] = [];

  const keys = new Set([...before.files.keys(), ...after.files.keys()]);
  for (const key of [...keys].sort()) {
    const prev = before.files.get(key);
    const next = after.files.get(key);
    if (prev === next) {
      continue;
    }
    changedFiles.push(key);
    if (prev === undefined) {
      lines.push(`+++ added ${key}`);
    } else if (next === undefined) {
      lines.push(`--- removed ${key}`);
    } else {
      lines.push(`*** modified ${key}`);
    }
  }

  return {
    changedFiles,
    diff: lines.length > 0 ? `${lines.join('\n')}\n` : '',
  };
}

function walk(rootDir: string, current: string, files: Map<string, string>): void {
  if (!existsSync(current)) {
    return;
  }
  const entries = readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      walk(rootDir, absolute, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const rel = relative(rootDir, absolute).split(sep).join('/');
    try {
      const content = readFileSync(absolute);
      const hash = createHash('sha256').update(content).digest('hex');
      const size = statSync(absolute).size;
      files.set(rel, `${size}:${hash}`);
    } catch {
      // Skip unreadable files
    }
  }
}
