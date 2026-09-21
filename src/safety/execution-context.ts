import { mkdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import type { Logger } from '../logging/logger.js';
import type { PipelineConfig } from '../config/load-config.js';
import type { RunMode, TaskDefinition } from '../models/types.js';
import { defaultSafetyKernel, type SafetyKernel } from './safety-kernel.js';

export class SafetyError extends Error {
  override readonly name = 'SafetyError';
  constructor(
    message: string,
    readonly code:
      | 'PATH_ESCAPE'
      | 'NETWORK_DENIED'
      | 'SECRET_PATTERN'
      | 'PRODUCTION_INDICATOR'
      | 'IRREVERSIBLE_ACTION'
      | 'FORBIDDEN_ACTION'
      | 'COMMAND_DENIED'
      | 'HOST_FILESYSTEM'
      | 'RETRY_LIMIT'
      | 'SSH_DENIED'
      | 'MINIPC_DENIED',
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
  readonly safetyKernel: SafetyKernel;
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
  readonly safetyKernel?: SafetyKernel;
}): ExecutionContext {
  const kernel = input.safetyKernel ?? defaultSafetyKernel;
  const now = input.now ?? new Date();
  const runId = input.runId ?? input.config.runId ?? createRunId(now);

  kernel.assertRetryBudgets(input.config.maxIdenticalRetries, input.config.maxTotalAttempts);
  kernel.assertActionAllowed('write_source');
  kernel.assertActionAllowed('read_source');

  const workspaceDir = kernel.resolveRunWorkspace(input.config.workspaceDir, runId);
  const artifactDir = resolve(input.config.artifactsDir, runId);
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });

  const writeAllowlist = uniqueNonEmpty([
    ...input.config.writeAllowlist,
    ...input.task.writeAllowlist,
  ]);

  const logger = input.logger.child({ runId, taskId: input.task.id, mode: input.config.mode });

  const resolveWorkspacePath = (candidate: string): string => {
    return kernel.assertPathInsideWorkspace(workspaceDir, candidate);
  };

  const assertWritablePath = (candidate: string): string => {
    if (
      candidate.includes('..') ||
      candidate.includes('\0') ||
      candidate.includes('\\') ||
      candidate.startsWith('~/')
    ) {
      throw new SafetyError(`Write path is unsafe: ${candidate}`, 'PATH_ESCAPE');
    }
    const absolute = resolveWorkspacePath(candidate);
    if (writeAllowlist.length === 0) {
      throw new SafetyError(
        'Write allowlist is empty; refusing all writes (fail closed)',
        'PATH_ESCAPE',
      );
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
    safetyKernel: kernel,
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
  if (/\b(ssh\s+\S+|scp\s+\S+|unrestricted\s+minipc|minipc\s+root)\b/i.test(text)) {
    return new SafetyError(
      'SSH or unrestricted MiniPC access indicator detected',
      'SSH_DENIED',
    );
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
