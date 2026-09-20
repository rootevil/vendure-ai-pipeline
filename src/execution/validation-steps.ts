import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExecutionContext } from '../safety/execution-context.js';
import type { TaskDefinition, ValidationStepResult } from '../models/types.js';

export function runValidationSteps(input: {
  readonly task: TaskDefinition;
  readonly context: ExecutionContext;
  readonly presentEvidence: readonly string[];
  readonly changedFiles: readonly string[];
}): ValidationStepResult[] {
  return input.task.validationSteps.map((step) => {
    switch (step.type) {
      case 'evidence_present': {
        const required = step.files ?? input.task.requiredEvidence;
        const missing = required.filter((name) => !input.presentEvidence.includes(name));
        return {
          id: step.id,
          type: step.type,
          passed: missing.length === 0,
          detail:
            missing.length === 0
              ? 'All required evidence files are present'
              : `Missing evidence: ${missing.join(', ')}`,
        };
      }
      case 'workspace_file_exists': {
        let absolute: string;
        try {
          absolute = input.context.resolveWorkspacePath(step.path);
        } catch (error) {
          return {
            id: step.id,
            type: step.type,
            passed: false,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
        const exists = existsSync(absolute);
        return {
          id: step.id,
          type: step.type,
          passed: exists,
          detail: exists ? `Found ${step.path}` : `Missing workspace file ${step.path}`,
        };
      }
      case 'workspace_file_contains': {
        let absolute: string;
        try {
          absolute = input.context.resolveWorkspacePath(step.path);
        } catch (error) {
          return {
            id: step.id,
            type: step.type,
            passed: false,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
        if (!existsSync(absolute)) {
          return {
            id: step.id,
            type: step.type,
            passed: false,
            detail: `Missing workspace file ${step.path}`,
          };
        }
        const content = readFileSync(absolute, 'utf8');
        const found = content.includes(step.contains);
        return {
          id: step.id,
          type: step.type,
          passed: found,
          detail: found
            ? `File ${step.path} contains expected text`
            : `File ${step.path} does not contain expected text`,
        };
      }
      case 'changed_files_include': {
        const normalized = step.path.replace(/^\.\//, '');
        const found = input.changedFiles.some(
          (file) => file === normalized || file.endsWith(`/${normalized}`),
        );
        return {
          id: step.id,
          type: step.type,
          passed: found,
          detail: found
            ? `Change set includes ${step.path}`
            : `Change set does not include ${step.path}`,
        };
      }
      default: {
        const exhaustive: never = step;
        return {
          id: 'unknown',
          type: 'unknown',
          passed: false,
          detail: `Unsupported step ${JSON.stringify(exhaustive)}`,
        };
      }
    }
  });
}

export function validationStepsPassed(results: readonly ValidationStepResult[]): boolean {
  return results.every((result) => result.passed);
}

export function workspaceFile(context: ExecutionContext, relativePath: string): string {
  return join(context.workspaceDir, relativePath);
}
