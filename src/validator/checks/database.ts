import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';
import { resolveControlledQuery } from '../controlled-sql.js';
import { valueContains, valuesEqual } from '../database-executor.js';

export async function runDatabaseStateCheck(
  step: Extract<ValidationStep, { type: 'database_state' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const resolvedQuery = resolveQueryLabel(step);
  const expectedParts: string[] = [
    `${step.driver} ${resolvedQuery.label}`,
  ];
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
    if (!step.query && !step.controlledQueryId) {
      return createCheckResult({
        checkName: step.id,
        status: 'ERROR',
        expected,
        actual: 'database_state requires query or controlledQueryId',
        output: '',
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }
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
    if (step.driver === 'postgres' && !step.controlledQueryId) {
      return createCheckResult({
        checkName: step.id,
        status: 'ERROR',
        expected,
        actual: 'postgres driver requires controlledQueryId (no free-form SQL)',
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
      query: step.query ?? resolvedQuery.sql,
      params: step.params ?? [],
      ...(step.controlledQueryId !== undefined
        ? { controlledQueryId: step.controlledQueryId }
        : {}),
      workspaceDir: ctx.context.workspaceDir,
    });

    const actualValue = result.value !== undefined ? result.value : result.rows;
    const failures: string[] = [];
    if (step.expectEquals !== undefined) {
      if (!valuesEqual(step.expectEquals, actualValue)) {
        failures.push(
          `expectedEquals mismatch: expected=${JSON.stringify(step.expectEquals)} actual=${JSON.stringify(actualValue)}`,
        );
      }
    }
    if (step.expectRowCount !== undefined && result.rowCount !== step.expectRowCount) {
      failures.push(`rowCount ${result.rowCount} !== ${step.expectRowCount}`);
    }
    if (step.expectContains !== undefined) {
      if (!valueContains(actualValue, step.expectContains)) {
        failures.push(
          `expectContains mismatch: needle=${JSON.stringify(step.expectContains)} actual=${JSON.stringify(actualValue)}`,
        );
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
      actual: passed
        ? `rowCount=${result.rowCount}; actual=${JSON.stringify(actualValue)}`
        : failures.join('; '),
      output: JSON.stringify(
        {
          controlledQueryId: step.controlledQueryId ?? null,
          sql: resolvedQuery.sql || null,
          params: step.params ?? [],
          expectedEquals: step.expectEquals ?? null,
          actual: actualValue,
          rowCount: result.rowCount,
          rows: result.rows,
        },
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

function resolveQueryLabel(step: Extract<ValidationStep, { type: 'database_state' }>): {
  readonly label: string;
  readonly sql: string;
} {
  if (step.controlledQueryId) {
    try {
      const controlled = resolveControlledQuery(step.controlledQueryId);
      return {
        label: `controlled:${controlled.id} ${JSON.stringify(controlled.sql)} params=${JSON.stringify(step.params ?? [])}`,
        sql: controlled.sql,
      };
    } catch {
      return {
        label: `controlled:${step.controlledQueryId}`,
        sql: '',
      };
    }
  }
  return {
    label: `query ${JSON.stringify(step.query ?? '')}`,
    sql: step.query ?? '',
  };
}
