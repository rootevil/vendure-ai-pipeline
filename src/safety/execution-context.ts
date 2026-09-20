import { mkdirSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import type { Logger } from '../logging/logger.js';
import type { PipelineConfig } from '../config/load-config.js';
import type { RunMode, TaskDefinition } from '../models/types.js';

export class SafetyError extends Error {
  override readonly name = 'SafetyError';
  constructor(
    message: string,
    readonly code:
      | 'PATH_ESCAPE'
      | 'NETWORK_DENIED'
      | 'SECRET_PATTERN'
      | 'PRODUCTION_INDICATOR'
      | 'IRREVERSIBLE_ACTION',
  ) {
    super(message);
  }
}

export interface ExecutionContext {
  readonly runId: string;
  readonly mode: RunMode;
  readonly task: TaskDefinition;
  readonly workspaceDir: string;
  readonly artifactDir: string;
  readonly writeAllowlist: readonly string[];
  readonly allowNetwork: boolean;
  readonly startedAt: string;
  readonly logger: Logger;
  resolveWorkspacePath(candidate: string): string;
  assertWritablePath(candidate: string): string;
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk_(live|test)_[A-Za-z0-9]+\b/,
];

const PRODUCTION_PATTERNS: readonly RegExp[] = [
  /\bproduction\b/i,
  /\bprod[_-]?db\b/i,
  /\blive[_-]?stripe\b/i,
];

export function createRunId(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function createExecutionContext(input: {
  readonly config: PipelineConfig;
  readonly task: TaskDefinition;
  readonly logger: Logger;
  readonly runId?: string;
  readonly now?: Date;
}): ExecutionContext {
  const now = input.now ?? new Date();
  const runId = input.runId ?? input.config.runId ?? createRunId(now);
  const workspaceDir = resolve(input.config.workspaceDir, runId);
  const artifactDir = resolve(input.config.artifactsDir, runId);
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });

  const writeAllowlist = uniqueNonEmpty([
    ...input.config.writeAllowlist,
    ...input.task.writeAllowlist,
  ]);

  const logger = input.logger.child({ runId, taskId: input.task.id, mode: input.config.mode });

  const resolveWorkspacePath = (candidate: string): string => {
    const absolute = isAbsolute(candidate)
      ? normalize(candidate)
      : resolve(workspaceDir, candidate);
    const rel = relative(workspaceDir, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new SafetyError(`Path escapes workspace: ${candidate}`, 'PATH_ESCAPE');
    }
    return absolute;
  };

  const assertWritablePath = (candidate: string): string => {
    const absolute = resolveWorkspacePath(candidate);
    if (writeAllowlist.length === 0) {
      return absolute;
    }
    const rel = relative(workspaceDir, absolute).split(sep).join('/');
    const allowed = writeAllowlist.some((entry) => {
      const normalizedEntry = entry.replace(/\\/g, '/').replace(/^\.\//, '');
      return rel === normalizedEntry || rel.startsWith(`${normalizedEntry}/`);
    });
    if (!allowed) {
      throw new SafetyError(`Write path is outside allowlist: ${rel}`, 'PATH_ESCAPE');
    }
    return absolute;
  };

  return {
    runId,
    mode: input.config.mode,
    task: input.task,
    workspaceDir,
    artifactDir,
    writeAllowlist,
    allowNetwork: input.config.allowNetwork,
    startedAt: now.toISOString(),
    logger,
    resolveWorkspacePath,
    assertWritablePath,
  };
}

export function assertNetworkAllowed(allowNetwork: boolean, requested: boolean): void {
  if (requested && !allowNetwork) {
    throw new SafetyError(
      'Network use requested but PIPELINE_ALLOW_NETWORK is false',
      'NETWORK_DENIED',
    );
  }
}

export function scanTextForSafetyViolations(text: string): SafetyError | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return new SafetyError('Secret-like pattern detected in output', 'SECRET_PATTERN');
    }
  }
  for (const pattern of PRODUCTION_PATTERNS) {
    if (pattern.test(text)) {
      return new SafetyError(
        'Production indicator detected; refusing to continue',
        'PRODUCTION_INDICATOR',
      );
    }
  }
  return null;
}

export function joinArtifact(context: ExecutionContext, name: string): string {
  return join(context.artifactDir, name);
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
