import type { ValidationCheckResult, ValidationStepResult } from '../models/types.js';
import { toStepResult } from '../validator/independent-validator.js';
import { createDefaultCheckContext, runIndependentCheck } from '../validator/run-checks.js';
import type { CheckRunnerContext } from '../validator/check-types.js';
import type { ExecutionContext } from '../safety/execution-context.js';
import type { TaskDefinition } from '../models/types.js';
import { join } from 'node:path';

/**
 * Runs task validationSteps as independent checks and returns rich step results.
 * Prefer IndependentValidator for PASS/BLOCK decisions.
 */
export async function runValidationSteps(input: {
  readonly task: TaskDefinition;
  readonly context: ExecutionContext;
  readonly presentEvidence: readonly string[];
  readonly changedFiles: readonly string[];
  readonly allowNetwork?: boolean;
  readonly fetchHttp?: CheckRunnerContext['fetchHttp'];
  readonly executeDatabase?: CheckRunnerContext['executeDatabase'];
  readonly launchBrowser?: CheckRunnerContext['launchBrowser'];
  readonly now?: () => Date;
}): Promise<ValidationStepResult[]> {
  const evidenceDir = join(input.context.artifactDir, 'validation');
  const ctx = createDefaultCheckContext({
    context: input.context,
    presentEvidence: input.presentEvidence,
    changedFiles: input.changedFiles,
    requiredEvidence: input.task.requiredEvidence,
    allowNetwork: input.allowNetwork ?? input.context.allowNetwork,
    evidenceDir,
    ...(input.fetchHttp !== undefined ? { fetchHttp: input.fetchHttp } : {}),
    ...(input.executeDatabase !== undefined ? { executeDatabase: input.executeDatabase } : {}),
    ...(input.launchBrowser !== undefined ? { launchBrowser: input.launchBrowser } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });

  const checks: ValidationCheckResult[] = [];
  for (const step of input.task.validationSteps) {
    checks.push(await runIndependentCheck(step, ctx));
  }
  return checks.map(toStepResult);
}

export function validationStepsPassed(results: readonly ValidationStepResult[]): boolean {
  return results.every((result) => result.passed);
}
