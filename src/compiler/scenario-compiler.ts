import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { TaskDefinition } from '../models/types.js';
import { loadTaskDefinitionFromPath } from '../task/task-card.js';
import { loadTaskDefinitionFromJsonFile, TaskDefinitionError } from '../task/task-definition.js';
import { compileBusinessTaskCard } from './compile-business-card.js';
import { loadBusinessTaskCardFromYaml, looksLikeBusinessTaskCard } from './load-business-card.js';

/**
 * Compile a task path into a machine TaskDefinition.
 *
 * - Business YAML cards (`goal` + `acceptance`) → expanded technical metrics
 * - YAML with `companion:` or sibling `.json` → load companion TaskDefinition
 * - `.md` / `.json` → existing loaders
 */
export function compileScenarioFromPath(taskPath: string, repoRoot = process.cwd()): TaskDefinition {
  const absolute = resolve(taskPath);

  if (absolute.endsWith('.yaml') || absolute.endsWith('.yml')) {
    const text = readFileSync(absolute, 'utf8');

    if (looksLikeBusinessTaskCard(text)) {
      const card = loadBusinessTaskCardFromYaml(absolute);
      const task = compileBusinessTaskCard(card);
      return {
        ...task,
        sourcePaths: unique([toRepoRelative(absolute, repoRoot), ...task.sourcePaths]),
      };
    }

    const companionJson = absolute.replace(/\.ya?ml$/i, '.json');
    if (existsSync(companionJson)) {
      const task = loadTaskDefinitionFromJsonFile(companionJson);
      return {
        ...task,
        sourcePaths: unique([toRepoRelative(absolute, repoRoot), ...task.sourcePaths]),
      };
    }

    const companionFromYaml = readYamlCompanionPointer(absolute, repoRoot, text);
    if (companionFromYaml) {
      const task = loadTaskDefinitionFromJsonFile(companionFromYaml);
      return {
        ...task,
        sourcePaths: unique([toRepoRelative(absolute, repoRoot), ...task.sourcePaths]),
      };
    }

    throw new TaskDefinitionError(
      `Unrecognized YAML task card: ${taskPath}. ` +
        'Use a business card (id/goal/acceptance) or a companion JSON TaskDefinition.',
    );
  }

  return loadTaskDefinitionFromPath(absolute, repoRoot);
}

export { loadTaskDefinitionFromPath } from '../task/task-card.js';
export {
  parseTaskDefinition,
  loadTaskDefinitionFromJsonFile,
  TaskDefinitionError,
} from '../task/task-definition.js';
export { compileBusinessTaskCard } from './compile-business-card.js';
export {
  loadBusinessTaskCardFromYaml,
  parseBusinessTaskCardYaml,
  looksLikeBusinessTaskCard,
} from './load-business-card.js';
export {
  BusinessTaskCardSchema,
  type BusinessTaskCard,
} from './business-task-card.js';

function readYamlCompanionPointer(
  absoluteYaml: string,
  repoRoot: string,
  text: string,
): string | null {
  const match = text.match(/^\s*companion:\s*(\S+)\s*$/m);
  if (!match?.[1]) {
    return null;
  }
  const rel = match[1].replace(/^['"]|['"]$/g, '');
  const candidates = [resolve(repoRoot, rel), resolve(dirname(absoluteYaml), rel), join(repoRoot, rel)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function toRepoRelative(absolute: string, repoRoot: string): string {
  const normalizedRoot = resolve(repoRoot);
  if (absolute.startsWith(normalizedRoot)) {
    return absolute.slice(normalizedRoot.length).replace(/^[/\\]/, '').replace(/\\/g, '/');
  }
  return absolute.replace(/\\/g, '/');
}

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths.map((p) => p.replace(/\\/g, '/')))];
}
