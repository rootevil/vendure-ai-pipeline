import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';
import { readJsonPath, valuesEqual } from '../database-executor.js';
import { assertHttpUrl } from '../http-fetcher.js';

export async function runGraphqlRequestCheck(
  step: Extract<ValidationStep, { type: 'graphql_request' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const expectedParts = [step.expectNoErrors ? 'no GraphQL errors' : 'GraphQL response'];
  if (step.expectDataPath) {
    expectedParts.push(`data.${step.expectDataPath} present`);
  }
  if (step.expectDataEquals !== undefined) {
    expectedParts.push(`equals ${JSON.stringify(step.expectDataEquals)}`);
  }
  const expected = `GraphQL ${step.url}: ${expectedParts.join('; ')}`;

  if (!ctx.allowNetwork) {
    return createCheckResult({
      checkName: step.id,
      status: 'FAIL',
      expected,
      actual: 'Network disabled for this run',
      output: 'PIPELINE_ALLOW_NETWORK is false; graphql_request requires network',
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }

  try {
    assertHttpUrl(step.url);
    const response = await ctx.fetchHttp({
      url: step.url,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...step.headers,
      },
      body: JSON.stringify({
        query: step.query,
        variables: step.variables,
      }),
      timeoutMs: step.timeoutMs,
    });

    let payload: { data?: unknown; errors?: unknown[] };
    try {
      payload = JSON.parse(response.bodyText) as typeof payload;
    } catch {
      const result = createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: `Non-JSON GraphQL response (HTTP ${response.status})`,
        output: response.bodyText.slice(0, 4000),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
      writeApiResponse(ctx, step.id, {
        kind: 'graphql_request',
        url: step.url,
        status: response.status,
        body: response.bodyText,
        check: result,
      });
      return result;
    }

    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    let result: ValidationCheckResult;

    if (step.expectNoErrors && errors.length > 0) {
      result = createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: `${errors.length} GraphQL error(s)`,
        output: JSON.stringify(payload, null, 2).slice(0, 4000),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    } else if (step.expectDataPath) {
      const value = readJsonPath(payload.data, step.expectDataPath);
      if (value === undefined) {
        result = createCheckResult({
          checkName: step.id,
          status: 'FAIL',
          expected,
          actual: `Missing data path ${step.expectDataPath}`,
          output: JSON.stringify(payload, null, 2).slice(0, 4000),
          evidenceDir: ctx.evidenceDir,
          evidenceFileName: evidenceFile,
          ...(ctx.now !== undefined ? { now: ctx.now } : {}),
        });
      } else if (
        step.expectDataEquals !== undefined &&
        !valuesEqual(step.expectDataEquals, value)
      ) {
        result = createCheckResult({
          checkName: step.id,
          status: 'FAIL',
          expected,
          actual: JSON.stringify(value),
          output: JSON.stringify(payload, null, 2).slice(0, 4000),
          evidenceDir: ctx.evidenceDir,
          evidenceFileName: evidenceFile,
          ...(ctx.now !== undefined ? { now: ctx.now } : {}),
        });
      } else {
        result = createCheckResult({
          checkName: step.id,
          status: 'PASS',
          expected,
          actual: `HTTP ${response.status}; errors=${errors.length}`,
          output: JSON.stringify(payload, null, 2).slice(0, 4000),
          evidenceDir: ctx.evidenceDir,
          evidenceFileName: evidenceFile,
          ...(ctx.now !== undefined ? { now: ctx.now } : {}),
        });
      }
    } else if (
      step.expectDataEquals !== undefined &&
      !valuesEqual(step.expectDataEquals, payload.data)
    ) {
      result = createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: JSON.stringify(payload.data),
        output: JSON.stringify(payload, null, 2).slice(0, 4000),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    } else {
      result = createCheckResult({
        checkName: step.id,
        status: 'PASS',
        expected,
        actual: `HTTP ${response.status}; errors=${errors.length}`,
        output: JSON.stringify(payload, null, 2).slice(0, 4000),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }

    writeApiResponse(ctx, step.id, {
      kind: 'graphql_request',
      url: step.url,
      query: step.query,
      status: response.status,
      body: payload,
      check: result,
    });
    return result;
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

function writeApiResponse(ctx: CheckRunnerContext, id: string, payload: unknown): void {
  const dir = join(ctx.runDir, 'api-responses');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
