import { readFileSync } from 'node:fs';

import { TaskDefinitionSchema, type TaskDefinition } from '../models/types.js';

export class TaskDefinitionError extends Error {
  override readonly name = 'TaskDefinitionError';
}

export function parseTaskDefinition(raw: unknown): TaskDefinition {
  const parsed = TaskDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TaskDefinitionError(
      `Invalid task definition: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

export function loadTaskDefinitionFromJsonFile(path: string): TaskDefinition {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskDefinitionError(`Unable to read task definition at ${path}: ${message}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskDefinitionError(`Task definition is not valid JSON (${path}): ${message}`);
  }

  return parseTaskDefinition(json);
}
