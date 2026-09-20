import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';
import { assertHttpUrl } from '../http-fetcher.js';

export async function runHttpResponseCheck(
  step: Extract<ValidationStep, { type: 'http_response' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const expectedParts = [`HTTP ${step.expectStatus}`];
  if (step.expectBodyContains) {
    expectedParts.push(`body contains ${JSON.stringify(step.expectBodyContains)}`);
  }
  const expected = `${step.method} ${step.url} → ${expectedParts.join('; ')}`;

  if (!ctx.allowNetwork) {
    return createCheckResult({
      checkName: step.id,
      status: 'FAIL',
      expected,
      actual: 'Network disabled for this run',
      output: 'PIPELINE_ALLOW_NETWORK is false; http_response requires network',
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }

  try {
    assertHttpUrl(step.url);
    const response = await ctx.fetchHttp({
      url: step.url,
      method: step.method,
      headers: step.headers,
      ...(step.body !== undefined ? { body: step.body } : {}),
      timeoutMs: step.timeoutMs,
    });
    const statusOk = response.status === step.expectStatus;
    const bodyOk =
      step.expectBodyContains === undefined || response.bodyText.includes(step.expectBodyContains);
    const passed = statusOk && bodyOk;
    const result = createCheckResult({
      checkName: step.id,
      status: passed ? 'PASS' : 'FAIL',
      expected,
      actual: `HTTP ${response.status}; body length ${response.bodyText.length}`,
      output: response.bodyText.slice(0, 4000),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
    writeApiResponse(ctx, step.id, {
      kind: 'http_response',
      method: step.method,
      url: step.url,
      status: response.status,
      body: response.bodyText,
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
