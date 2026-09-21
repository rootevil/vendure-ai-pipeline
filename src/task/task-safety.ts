import { isAbsolute } from 'node:path';

import type { AllowedTool, TaskDefinition, ValidationStep } from '../models/types.js';
import { TaskDefinitionError } from './task-definition.js';

const FORBIDDEN_TOOL_NAMES = new Set([
  'ssh',
  'production',
  'production_deploy',
  'unrestricted_shell',
  'shell',
  'network_fetch',
  'curl',
  'wget',
]);

const UNSAFE_PATH_PATTERN = /(^|\/)\.\.(\/|$)/;

export function assertTaskSafe(task: TaskDefinition): void {
  const errors: string[] = [];

  if (task.goal.trim().length === 0) {
    errors.push('goal must not be blank');
  }

  if (task.acceptanceCriteria.length === 0) {
    errors.push('acceptanceCriteria must contain at least one criterion');
  }

  if (task.timeoutMs < 100) {
    errors.push('timeoutMs must be at least 100ms');
  }

  for (const tool of task.allowedTools) {
    if (FORBIDDEN_TOOL_NAMES.has(tool)) {
      errors.push(`allowedTools contains forbidden tool: ${tool}`);
    }
  }

  // Reject unknown / smuggled tool strings that bypass the enum via casting.
  for (const tool of task.allowedTools as readonly string[]) {
    if (FORBIDDEN_TOOL_NAMES.has(tool)) {
      errors.push(`allowedTools contains unsafe tool name: ${tool}`);
    }
  }

  for (const path of [...task.writeAllowlist, ...task.sourcePaths]) {
    errors.push(...validateRelativeSafePath(path, 'path'));
  }

  for (const step of task.validationSteps) {
    errors.push(...validateStep(step, task.allowedTools));
  }

  if (task.allowedTools.includes('openhands') && task.allowedTools.includes('mock') === false) {
    // openhands alone is fine
  }

  if (errors.length > 0) {
    throw new TaskDefinitionError(`Unsafe or invalid task rejected: ${errors.join('; ')}`);
  }
}

function validateRelativeSafePath(path: string, label: string): string[] {
  const errors: string[] = [];
  if (path.trim().length === 0) {
    errors.push(`${label} must not be blank`);
    return errors;
  }
  if (isAbsolute(path) || path.includes('\0') || /^[A-Za-z]:[\\/]/.test(path)) {
    errors.push(`${label} must be a relative workspace path: ${path}`);
  }
  if (UNSAFE_PATH_PATTERN.test(path) || path.includes('\\')) {
    errors.push(`${label} must not contain path traversal or backslashes: ${path}`);
  }
  if (path.startsWith('~') || path.includes('$')) {
    errors.push(`${label} must not expand home/env references: ${path}`);
  }
  return errors;
}

function validateStep(step: ValidationStep, allowedTools: readonly AllowedTool[]): string[] {
  const errors: string[] = [];
  switch (step.type) {
    case 'evidence_present':
      break;
    case 'workspace_file_exists':
    case 'workspace_file_contains':
    case 'changed_files_include':
      errors.push(...validateRelativeSafePath(step.path, `validationSteps.${step.id}.path`));
      if (!allowedTools.includes('filesystem') && !allowedTools.includes('mock')) {
        errors.push(`validationSteps.${step.id} requires filesystem or mock in allowedTools`);
      }
      break;
    case 'application_health':
    case 'http_response':
    case 'graphql_request':
    case 'browser_playwright':
      errors.push(...validateHttpUrl(step.url, `validationSteps.${step.id}.url`));
      break;
    case 'database_state':
      if (step.driver === 'json_fixture') {
        if (!step.fixturePath) {
          errors.push(`validationSteps.${step.id} json_fixture requires fixturePath`);
        } else {
          errors.push(
            ...validateRelativeSafePath(step.fixturePath, `validationSteps.${step.id}.fixturePath`),
          );
        }
      }
      if (step.driver === 'postgres') {
        if (!step.connectionString) {
          errors.push(`validationSteps.${step.id} postgres requires connectionString`);
        } else if (/prod|production/i.test(step.connectionString)) {
          errors.push(`validationSteps.${step.id} refuses production-looking connection strings`);
        }
      }
      if (
        step.expectEquals === undefined &&
        step.expectRowCount === undefined &&
        step.expectContains === undefined
      ) {
        errors.push(`validationSteps.${step.id} requires at least one database expectation`);
      }
      break;
    case 'path_invariant':
      errors.push(...validateRelativeSafePath(step.root, `validationSteps.${step.id}.root`));
      for (const rel of step.requiredRelativePaths) {
        errors.push(
          ...validateRelativeSafePath(rel, `validationSteps.${step.id}.requiredRelativePaths`),
        );
      }
      if (!step.requiredRelativePaths.some((rel) => rel.includes('/'))) {
        errors.push(
          `validationSteps.${step.id} requiredRelativePaths must include at least one nested path`,
        );
      }
      break;
    case 'redis_ping':
    case 'postgres_ready':
      break;
    default: {
      const exhaustive: never = step;
      errors.push(`unsupported validation step: ${JSON.stringify(exhaustive)}`);
    }
  }
  return errors;
}

function validateHttpUrl(url: string, label: string): string[] {
  const errors: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    errors.push(`${label} is not a valid URL: ${url}`);
    return errors;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    errors.push(`${label} must use http or https: ${url}`);
  }
  if (parsed.username || parsed.password) {
    errors.push(`${label} must not include credentials: ${url}`);
  }
  return errors;
}
