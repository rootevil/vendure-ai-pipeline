import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import type { TaskDefinition } from '../models/types.js';
import { loadTaskDefinitionFromJsonFile, TaskDefinitionError } from './task-definition.js';

const TASK_MD_COMPANIONS: Record<string, string> = {
  'evaluation-demo/task.md': 'fixtures/tasks/vendure-public-catalog-e2e.json',
  'task.md': 'fixtures/tasks/vendure-public-catalog-e2e.json',
};

/**
 * Load a machine task from JSON, or compile a known markdown task card
 * to its companion fixture (human goal → stage manifest).
 */
export function loadTaskDefinitionFromPath(taskPath: string, repoRoot = process.cwd()): TaskDefinition {
  const absolute = resolve(taskPath);
  if (absolute.endsWith('.json')) {
    return loadTaskDefinitionFromJsonFile(absolute);
  }

  if (absolute.endsWith('.md')) {
    const companion = resolveTaskMdCompanion(absolute, repoRoot);
    if (!companion) {
      throw new TaskDefinitionError(
        `No scenario compiler mapping for markdown task card: ${taskPath}. ` +
          'Provide a JSON task or use evaluation-demo/task.md.',
      );
    }
    const task = loadTaskDefinitionFromJsonFile(companion);
    // Keep human card path discoverable in evidence.
    return {
      ...task,
      sourcePaths: uniquePaths([taskPath.replace(/\\/g, '/'), ...task.sourcePaths]),
    };
  }

  throw new TaskDefinitionError(`Unsupported task card type: ${taskPath} (use .json or .md)`);
}

function resolveTaskMdCompanion(absoluteMd: string, repoRoot: string): string | null {
  const normalizedRoot = resolve(repoRoot);
  const rel = absoluteMd.startsWith(normalizedRoot)
    ? absoluteMd.slice(normalizedRoot.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
    : basename(absoluteMd);

  const mapped = TASK_MD_COMPANIONS[rel] ?? TASK_MD_COMPANIONS[basename(absoluteMd)];
  if (mapped) {
    const candidate = resolve(normalizedRoot, mapped);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Side-by-side companion: task.md → task.json in same directory
  const sibling = join(dirname(absoluteMd), 'task.json');
  if (existsSync(sibling)) {
    return sibling;
  }

  // Front-matter style marker: <!-- task-json: path -->
  try {
    const text = readFileSync(absoluteMd, 'utf8');
    const match = text.match(/<!--\s*task-json:\s*([^\s]+)\s*-->/i);
    if (match?.[1]) {
      const marked = resolve(normalizedRoot, match[1]);
      if (existsSync(marked)) {
        return marked;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((p) => p.replace(/\\/g, '/')))];
}
