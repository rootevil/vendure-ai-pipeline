import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';
import { valueContains, valuesEqual } from '../database-executor.js';

export async function runDatabaseStateCheck(
  step: Extract<ValidationStep, { type: 'database_state' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const expectedParts: string[] = [`${step.driver} query ${JSON.stringify(step.query)}`];
  if (step.expectEquals !== undefined) {
    expectedParts.push(`equals ${JSON.stringify(step.expectEquals)}`);
  }
  if (step.expectRowCount !== undefined) {
    expectedParts.push(`rowCount=${step.expectRowCount}`);
  }
  if (step.expectContains !== undefined) {
    expectedParts.push(`contains ${JSON.stringify(step.expectContains)}`);
  }
  const expected = expectedParts.join('; ');

  try {
    if (step.driver === 'json_fixture' && !step.fixturePath) {
      return createCheckResult({
        checkName: step.id,
        status: 'ERROR',
        expected,
        actual: 'fixturePath is required for json_fixture driver',
        output: '',
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }
    if (step.driver === 'postgres' && !step.connectionString) {
      return createCheckResult({
        checkName: step.id,
        status: 'ERROR',
        expected,
        actual: 'connectionString is required for postgres driver',
        output: '',
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }

    const result = await ctx.executeDatabase({
      driver: step.driver,
      ...(step.fixturePath !== undefined ? { fixturePath: step.fixturePath } : {}),
      ...(step.connectionString !== undefined ? { connectionString: step.connectionString } : {}),
      query: step.query,
      workspaceDir: ctx.context.workspaceDir,
    });

    const failures: string[] = [];
    if (step.expectEquals !== undefined) {
      const actualValue = result.value !== undefined ? result.value : result.rows;
      if (!valuesEqual(step.expectEquals, actualValue)) {
        failures.push(`expectedEquals mismatch`);
      }
    }
    if (step.expectRowCount !== undefined && result.rowCount !== step.expectRowCount) {
      failures.push(`rowCount ${result.rowCount} !== ${step.expectRowCount}`);
    }
    if (step.expectContains !== undefined) {
      const haystack = result.value !== undefined ? result.value : result.rows;
      if (!valueContains(haystack, step.expectContains)) {
        failures.push('expectContains mismatch');
      }
    }
    if (
      step.expectEquals === undefined &&
      step.expectRowCount === undefined &&
      step.expectContains === undefined
    ) {
      failures.push('database_state requires at least one expectation');
    }

    const passed = failures.length === 0;
    return createCheckResult({
      checkName: step.id,
      status: passed ? 'PASS' : 'FAIL',
      expected,
      actual: passed ? `rowCount=${result.rowCount}` : failures.join('; '),
      output: JSON.stringify(
        { rowCount: result.rowCount, value: result.value, rows: result.rows },
        null,
        2,
      ).slice(0, 4000),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  } catch (error) {
    return createCheckResult({
      checkName: step.id,
      status: 'ERROR',
      expected,
      actual: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? (error.stack ?? error.message) : String(error),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }
}
