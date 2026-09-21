import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { TaskDefinition } from '../models/types.js';
import { loadTaskDefinitionFromPath } from '../task/task-card.js';
import { loadTaskDefinitionFromJsonFile, TaskDefinitionError } from '../task/task-definition.js';
import { compileBusinessTaskCard } from './compile-business-card.js';
import { compileTechnicalScenario } from './compile-technical-scenario.js';
import { loadBusinessTaskCardFromYaml, looksLikeBusinessTaskCard } from './load-business-card.js';
import type { TechnicalScenario } from './technical-scenario.js';
import { technicalScenarioToTaskDefinition } from './technical-scenario-to-task.js';

export interface CompileResult {
  readonly technical: TechnicalScenario | null;
  readonly task: TaskDefinition;
}

/**
 * Compile a task path into a machine TaskDefinition.
 * Business YAML cards also produce a client-shaped technical scenario.
 */
export function compileScenarioFromPath(taskPath: string, repoRoot = process.cwd()): TaskDefinition {
  return compileScenarioBundleFromPath(taskPath, repoRoot).task;
}

/**
 * Full compile: technical-task.json shape (when applicable) + runnable TaskDefinition.
 */
export function compileScenarioBundleFromPath(
  taskPath: string,
  repoRoot = process.cwd(),
): CompileResult {
  const absolute = resolve(taskPath);

  if (absolute.endsWith('.yaml') || absolute.endsWith('.yml')) {
    const text = readFileSync(absolute, 'utf8');
    const rel = toRepoRelative(absolute, repoRoot);

    if (looksLikeBusinessTaskCard(text)) {
      const card = loadBusinessTaskCardFromYaml(absolute);
      const technical = compileTechnicalScenario(card);
      const task = technicalScenarioToTaskDefinition(technical, [rel]);
      return { technical, task };
    }

    const companionJson = absolute.replace(/\.ya?ml$/i, '.json');
    if (existsSync(companionJson)) {
      const task = loadTaskDefinitionFromJsonFile(companionJson);
      return {
        technical: null,
        task: {
          ...task,
          sourcePaths: unique([rel, ...task.sourcePaths]),
        },
      };
    }

    const companionFromYaml = readYamlCompanionPointer(absolute, repoRoot, text);
    if (companionFromYaml) {
      const task = loadTaskDefinitionFromJsonFile(companionFromYaml);
      return {
        technical: null,
        task: {
          ...task,
          sourcePaths: unique([rel, ...task.sourcePaths]),
        },
      };
    }

    throw new TaskDefinitionError(
      `Unrecognized YAML task card: ${taskPath}. ` +
        'Use a business card (id/goal/acceptance) or a companion JSON TaskDefinition.',
    );
  }

  const task = loadTaskDefinitionFromPath(absolute, repoRoot);
  return { technical: null, task };
}

export { loadTaskDefinitionFromPath } from '../task/task-card.js';
export {
  parseTaskDefinition,
  loadTaskDefinitionFromJsonFile,
  TaskDefinitionError,
} from '../task/task-definition.js';
export { compileBusinessTaskCard, compileBusinessTaskCardToTechnical } from './compile-business-card.js';
export { compileTechnicalScenario } from './compile-technical-scenario.js';
export { technicalScenarioToTaskDefinition } from './technical-scenario-to-task.js';
export {
  loadBusinessTaskCardFromYaml,
  parseBusinessTaskCardYaml,
  looksLikeBusinessTaskCard,
} from './load-business-card.js';
export {
  BusinessTaskCardSchema,
  type BusinessTaskCard,
} from './business-task-card.js';
export {
  TechnicalScenarioSchema,
  TechnicalCheckSchema,
  type TechnicalScenario,
  type TechnicalCheck,
} from './technical-scenario.js';

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
