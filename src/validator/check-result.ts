import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ValidationCheckResult, ValidationCheckStatus } from '../models/types.js';

export function createCheckResult(input: {
  readonly checkName: string;
  readonly status: ValidationCheckStatus;
  readonly expected: string;
  readonly actual: string;
  readonly output: string;
  readonly evidenceDir: string;
  readonly evidenceFileName: string;
  readonly now?: () => Date;
}): ValidationCheckResult {
  const nowFn = input.now ?? (() => new Date());
  const timestamp = nowFn().toISOString();
  mkdirSync(input.evidenceDir, { recursive: true });
  const evidencePath = join(input.evidenceDir, input.evidenceFileName);
  const payload = {
    checkName: input.checkName,
    status: input.status,
    expected: input.expected,
    actual: input.actual,
    timestamp,
    output: input.output,
    evidencePath,
  };
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return {
    checkName: input.checkName,
    status: input.status,
    expected: input.expected,
    actual: input.actual,
    timestamp,
    output: input.output,
    evidencePath,
  };
}

export function checkPassed(result: ValidationCheckResult): boolean {
  return result.status === 'PASS';
}

export function summarizeChecks(results: readonly ValidationCheckResult[]): string {
  const failed = results.filter((result) => result.status !== 'PASS');
  if (failed.length === 0) {
    return `All ${results.length} independent checks passed`;
  }
  return `${failed.length}/${results.length} independent checks failed: ${failed
    .map((result) => result.checkName)
    .join(', ')}`;
}
