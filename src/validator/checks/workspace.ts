import { existsSync, readFileSync } from 'node:fs';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';

export async function runWorkspaceCheck(
  step: Extract<
    ValidationStep,
    | { type: 'evidence_present' }
    | { type: 'workspace_file_exists' }
    | { type: 'workspace_file_contains' }
    | { type: 'changed_files_include' }
  >,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  switch (step.type) {
    case 'evidence_present': {
      const required = step.files ?? ctx.requiredEvidence;
      const missing = required.filter((name) => !ctx.presentEvidence.includes(name));
      const passed = missing.length === 0;
      return createCheckResult({
        checkName: step.id,
        status: passed ? 'PASS' : 'FAIL',
        expected: `Evidence present: ${required.join(', ')}`,
        actual: passed ? `Present: ${required.join(', ')}` : `Missing: ${missing.join(', ')}`,
        output: JSON.stringify({ required, present: ctx.presentEvidence, missing }, null, 2),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }
    case 'workspace_file_exists': {
      try {
        const absolute = ctx.context.resolveWorkspacePath(step.path);
        const exists = existsSync(absolute);
        return createCheckResult({
          checkName: step.id,
          status: exists ? 'PASS' : 'FAIL',
          expected: `File exists: ${step.path}`,
          actual: exists ? `Found ${step.path}` : `Missing ${step.path}`,
          output: absolute,
          evidenceDir: ctx.evidenceDir,
          evidenceFileName: evidenceFile,
          ...(ctx.now !== undefined ? { now: ctx.now } : {}),
        });
      } catch (error) {
        return createCheckResult({
          checkName: step.id,
          status: 'ERROR',
          expected: `File exists: ${step.path}`,
          actual: error instanceof Error ? error.message : String(error),
          output: error instanceof Error ? (error.stack ?? error.message) : String(error),
          evidenceDir: ctx.evidenceDir,
          evidenceFileName: evidenceFile,
          ...(ctx.now !== undefined ? { now: ctx.now } : {}),
        });
      }
    }
    case 'workspace_file_contains': {
      try {
        const absolute = ctx.context.resolveWorkspacePath(step.path);
        if (!existsSync(absolute)) {
          return createCheckResult({
            checkName: step.id,
            status: 'FAIL',
            expected: `File ${step.path} contains ${JSON.stringify(step.contains)}`,
            actual: `Missing file ${step.path}`,
            output: absolute,
            evidenceDir: ctx.evidenceDir,
            evidenceFileName: evidenceFile,
            ...(ctx.now !== undefined ? { now: ctx.now } : {}),
          });
        }
        const content = readFileSync(absolute, 'utf8');
        const found = content.includes(step.contains);
        return createCheckResult({
          checkName: step.id,
          status: found ? 'PASS' : 'FAIL',
          expected: `File ${step.path} contains ${JSON.stringify(step.contains)}`,
          actual: found ? 'Marker found' : 'Marker not found',
          output: content.slice(0, 2000),
          evidenceDir: ctx.evidenceDir,
          evidenceFileName: evidenceFile,
          ...(ctx.now !== undefined ? { now: ctx.now } : {}),
        });
      } catch (error) {
        return createCheckResult({
          checkName: step.id,
          status: 'ERROR',
          expected: `File ${step.path} contains ${JSON.stringify(step.contains)}`,
          actual: error instanceof Error ? error.message : String(error),
          output: error instanceof Error ? (error.stack ?? error.message) : String(error),
          evidenceDir: ctx.evidenceDir,
          evidenceFileName: evidenceFile,
          ...(ctx.now !== undefined ? { now: ctx.now } : {}),
        });
      }
    }
    case 'changed_files_include': {
      const normalized = step.path.replace(/^\.\//, '');
      const found = ctx.changedFiles.some(
        (file) => file === normalized || file.endsWith(`/${normalized}`),
      );
      return createCheckResult({
        checkName: step.id,
        status: found ? 'PASS' : 'FAIL',
        expected: `Changed files include ${step.path}`,
        actual: found ? `Found ${step.path}` : `Not in change set`,
        output: JSON.stringify(ctx.changedFiles, null, 2),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }
    default: {
      const exhaustive: never = step;
      throw new Error(`Unsupported workspace check: ${JSON.stringify(exhaustive)}`);
    }
  }
}
