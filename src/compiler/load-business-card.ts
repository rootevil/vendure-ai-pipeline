import { readFileSync } from 'node:fs';

import {
  BusinessTaskCardSchema,
  type BusinessTaskCard,
} from './business-task-card.js';
import { TaskDefinitionError } from '../task/task-definition.js';

/**
 * Load a client-style business task card from YAML.
 * Prefer this over a full YAML dependency for the fixed card shape.
 */
export function loadBusinessTaskCardFromYaml(path: string): BusinessTaskCard {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskDefinitionError(`Unable to read task card at ${path}: ${message}`);
  }
  return parseBusinessTaskCardYaml(text, path);
}

export function parseBusinessTaskCardYaml(text: string, source = 'task.yaml'): BusinessTaskCard {
  const id = matchScalar(text, 'id');
  const title = matchOptionalScalar(text, 'title');
  const goal = matchFoldedOrScalar(text, 'goal');
  const acceptance = matchStringList(text, 'acceptance');
  const target = matchNestedScalar(text, 'environment', 'target') ?? 'isolated-vendure';
  const baseUrl = matchNestedScalar(text, 'environment', 'baseUrl');
  const storefrontUrl = matchNestedScalar(text, 'environment', 'storefrontUrl');
  const shopApiUrl = matchNestedScalar(text, 'environment', 'shopApiUrl');
  const adminApiUrl = matchNestedScalar(text, 'environment', 'adminApiUrl');
  const mode = matchOptionalScalar(text, 'mode') as BusinessTaskCard['mode'] | undefined;
  const timeoutRaw = matchOptionalScalar(text, 'timeoutMs');
  const writeAllowlist = matchOptionalStringList(text, 'writeAllowlist');

  if (!id || !goal || acceptance.length === 0) {
    throw new TaskDefinitionError(
      `Business task card at ${source} requires id, goal, and a non-empty acceptance list`,
    );
  }

  const raw: Record<string, unknown> = {
    id,
    goal,
    acceptance,
    environment: {
      target,
      ...(baseUrl ? { baseUrl } : {}),
      ...(storefrontUrl ? { storefrontUrl } : {}),
      ...(shopApiUrl ? { shopApiUrl } : {}),
      ...(adminApiUrl ? { adminApiUrl } : {}),
    },
  };
  if (title) raw.title = title;
  if (mode) raw.mode = mode;
  if (timeoutRaw) raw.timeoutMs = Number(timeoutRaw);
  if (writeAllowlist) raw.writeAllowlist = writeAllowlist;

  const parsed = BusinessTaskCardSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TaskDefinitionError(
      `Invalid business task card (${source}): ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/** True when YAML looks like a business goal card (not a companion pointer / full TaskDefinition dump). */
export function looksLikeBusinessTaskCard(text: string): boolean {
  return (
    /^\s*id:\s*\S+/m.test(text) &&
    /^\s*goal:\s*/m.test(text) &&
    /^\s*acceptance:\s*$/m.test(text) &&
    !/^\s*companion:\s*/m.test(text) &&
    !/^\s*validationSteps:\s*/m.test(text)
  );
}

function matchScalar(text: string, key: string): string | null {
  const m = text.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!m?.[1] || m[1] === '>' || m[1] === '|') {
    return null;
  }
  return stripQuotes(m[1]);
}

function matchOptionalScalar(text: string, key: string): string | undefined {
  return matchScalar(text, key) ?? undefined;
}

function matchFoldedOrScalar(text: string, key: string): string | null {
  const block = text.match(
    new RegExp(`^\\s*${key}:\\s*([>|])\\s*\\n((?:^[ \\t].*\\n?)*)`, 'm'),
  );
  if (block) {
    const style = block[1];
    const body = block[2] ?? '';
    const lines = body.split('\n').map((line) => line.replace(/^[ \\t]{2}/, '').replace(/\t/g, '  '));
    // Strip common indent
    const indents = lines
      .filter((l) => l.trim().length > 0)
      .map((l) => l.match(/^ */)?.[0].length ?? 0);
    const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
    const stripped = lines.map((l) => l.slice(minIndent));
    if (style === '>') {
      return stripped
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return stripped.join('\n').trim();
  }
  return matchScalar(text, key);
}

function matchStringList(text: string, key: string): string[] {
  const block = text.match(new RegExp(`^\\s*${key}:\\s*\\n((?:^[ \\t]*-\\s+.*\\n?)+)`, 'm'));
  if (!block?.[1]) {
    return [];
  }
  return block[1]
    .split('\n')
    .map((line) => line.match(/^[ \t]*-\s+(.*)$/)?.[1]?.trim())
    .filter((v): v is string => Boolean(v))
    .map(stripQuotes);
}

function matchOptionalStringList(text: string, key: string): string[] | undefined {
  const list = matchStringList(text, key);
  return list.length > 0 ? list : undefined;
}

function matchNestedScalar(text: string, parent: string, key: string): string | undefined {
  const block = text.match(
    new RegExp(`^\\s*${parent}:\\s*\\n((?:^[ \\t]+.*\\n?)+)`, 'm'),
  );
  if (!block?.[1]) {
    return undefined;
  }
  const m = block[1].match(new RegExp(`^[ \\t]+${key}:\\s*(.+)\\s*$`, 'm'));
  return m?.[1] ? stripQuotes(m[1].trim()) : undefined;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
