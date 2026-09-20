import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RunStatus, ValidationCheckResult, ValidationStepResult } from '../models/types.js';
import { checkPassed, summarizeChecks } from './check-result.js';
import type { BrowserLauncher, DatabaseExecutor, HttpFetcher } from './check-types.js';
import { createDefaultCheckContext, runIndependentCheck } from './run-checks.js';
import type { Validator, ValidatorDecision, ValidatorInput } from './validator.js';

export interface IndependentValidatorDependencies {
  readonly fetchHttp?: HttpFetcher;
  readonly executeDatabase?: DatabaseExecutor;
  readonly launchBrowser?: BrowserLauncher;
  readonly now?: () => Date;
  readonly allowNetwork?: boolean;
}

/**
 * Independent PASS/BLOCK authority.
 * Agent claimedSuccess is recorded in notes only and never grants PASS.
 */
export class IndependentValidator implements Validator {
  readonly name = 'independent';

  constructor(private readonly deps: IndependentValidatorDependencies = {}) {}

  async validate(input: ValidatorInput): Promise<ValidatorDecision> {
    const notes: string[] = [];
    if (input.agentClaimedSuccess) {
      notes.push('Agent claimed success; ignored for PASS/BLOCK decision');
    }

    const evidenceDir = join(input.context.artifactDir, 'validation');
    mkdirSync(evidenceDir, { recursive: true });
    mkdirSync(join(input.context.artifactDir, 'screenshots'), { recursive: true });
    mkdirSync(join(input.context.artifactDir, 'api-responses'), { recursive: true });

    const allowNetwork = this.deps.allowNetwork ?? input.context.allowNetwork;
    const checkContext = createDefaultCheckContext({
      context: input.context,
      presentEvidence: input.presentEvidence,
      changedFiles: input.changedFiles ?? [],
      requiredEvidence: input.requiredEvidence,
      allowNetwork,
      runDir: input.context.artifactDir,
      evidenceDir,
      ...(this.deps.fetchHttp !== undefined ? { fetchHttp: this.deps.fetchHttp } : {}),
      ...(this.deps.executeDatabase !== undefined
        ? { executeDatabase: this.deps.executeDatabase }
        : {}),
      ...(this.deps.launchBrowser !== undefined ? { launchBrowser: this.deps.launchBrowser } : {}),
      ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
    });

    const checks: ValidationCheckResult[] = [];
    const stepResults: ValidationStepResult[] = [];
    for (const step of input.context.task.validationSteps) {
      const check = await runIndependentCheck(step, checkContext);
      checks.push(check);
      stepResults.push({
        ...toStepResult(check),
        id: step.id,
        type: step.type,
      });
    }

    if (input.testExitCode !== null) {
      const testPass =
        input.mode === 'baseline' ? input.testExitCode !== 0 : input.testExitCode === 0;
      const expected =
        input.mode === 'baseline'
          ? 'Acceptance tests fail in baseline mode'
          : 'Acceptance tests exit 0';
      const actual = `testExitCode=${input.testExitCode}`;
      const timestamp = (this.deps.now ?? (() => new Date()))().toISOString();
      const evidencePath = join(evidenceDir, 'acceptance-tests.json');
      const testCheck: ValidationCheckResult = {
        checkName: 'acceptance-tests',
        status: testPass ? 'PASS' : 'FAIL',
        expected,
        actual,
        timestamp,
        output: actual,
        evidencePath,
      };
      writeFileSync(evidencePath, `${JSON.stringify(testCheck, null, 2)}\n`, 'utf8');
      checks.push(testCheck);
      stepResults.push({
        ...toStepResult(testCheck),
        id: 'acceptance-tests',
        type: 'acceptance_tests',
      });
    }

    writeFileSync(
      join(input.context.artifactDir, 'validation-results.json'),
      `${JSON.stringify(checks, null, 2)}\n`,
      'utf8',
    );

    notes.push(summarizeChecks(checks));
    for (const check of checks.filter((item) => !checkPassed(item))) {
      notes.push(`${check.checkName}: ${check.actual}`);
    }

    const allPassed = checks.every(checkPassed);
    const decision = decideStatus({
      mode: input.mode,
      allPassed,
      checks,
      presentEvidence: input.presentEvidence,
      requiredEvidence: input.requiredEvidence,
      testExitCode: input.testExitCode,
    });

    return {
      status: decision.status,
      notes,
      exitCode: decision.exitCode,
      checks,
      stepResults,
    };
  }
}

function decideStatus(input: {
  readonly mode: ValidatorInput['mode'];
  readonly allPassed: boolean;
  readonly checks: readonly ValidationCheckResult[];
  readonly presentEvidence: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly testExitCode: number | null;
}): { status: RunStatus; exitCode: number } {
  if (input.mode === 'baseline') {
    const missing = input.requiredEvidence.filter((name) => !input.presentEvidence.includes(name));
    if (missing.length > 0) {
      return { status: 'BLOCK', exitCode: 1 };
    }
    if (input.testExitCode === 0) {
      return { status: 'BLOCK', exitCode: 1 };
    }
    return { status: 'BASELINE_BLOCKED_EXPECTED', exitCode: 0 };
  }

  if (input.allPassed) {
    return { status: 'PASS', exitCode: 0 };
  }
  return { status: 'BLOCK', exitCode: 1 };
}

export function toStepResult(check: ValidationCheckResult): ValidationStepResult {
  return {
    id: check.checkName,
    type: check.checkName,
    passed: check.status === 'PASS',
    detail: `${check.expected} → ${check.actual}`,
    checkName: check.checkName,
    status: check.status,
    expected: check.expected,
    actual: check.actual,
    timestamp: check.timestamp,
    output: check.output,
    evidencePath: check.evidencePath,
  };
}
