import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';
import { assertHttpUrl } from '../http-fetcher.js';

export async function runApplicationHealthCheck(
  step: Extract<ValidationStep, { type: 'application_health' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const expected = `HTTP ${step.expectStatus} from ${step.url}`;

  if (!ctx.allowNetwork) {
    return createCheckResult({
      checkName: step.id,
      status: 'FAIL',
      expected,
      actual: 'Network disabled for this run',
      output: 'PIPELINE_ALLOW_NETWORK is false; application_health requires network',
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }

  try {
    assertHttpUrl(step.url);
    const response = await ctx.fetchHttp({
      url: step.url,
      method: 'GET',
      headers: {},
      timeoutMs: step.timeoutMs,
    });
    const passed = response.status === step.expectStatus;
    const result = createCheckResult({
      checkName: step.id,
      status: passed ? 'PASS' : 'FAIL',
      expected,
      actual: `HTTP ${response.status}`,
      output: response.bodyText.slice(0, 4000),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
    writeApiResponse(ctx, step.id, {
      kind: 'application_health',
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
