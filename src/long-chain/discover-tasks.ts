import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TASK_FILE = /^task-(\d+)\.ya?ml$/i;

/**
 * Discover long-chain task cards under tasks/:
 *   tasks/task-01.yaml, task-02.yaml, task-03.yaml, …
 *
 * Discovery is by filename pattern only — never by business id branching.
 */
export function discoverLongChainTasks(tasksDir = 'tasks', repoRoot = process.cwd()): readonly string[] {
  const root = resolve(repoRoot, tasksDir);
  if (!existsSync(root)) {
    return [];
  }
  const entries = readdirSync(root)
    .map((name) => {
      const match = TASK_FILE.exec(name);
      if (!match) {
        return null;
      }
      return { name, slot: Number.parseInt(match[1] ?? '0', 10) };
    })
    .filter((entry): entry is { name: string; slot: number } => entry !== null)
    .sort((a, b) => a.slot - b.slot);

  return entries.map((entry) => join(root, entry.name));
}
