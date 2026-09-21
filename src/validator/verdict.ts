import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RunStatus, ValidationCheckResult } from '../models/types.js';
import { checkPassed } from './check-result.js';

/**
 * Client-facing independent validator verdict.
 * Built only from check evidence — never from agent claimedSuccess.
 */
export interface ValidatorVerdictCheck {
  readonly name: string;
  readonly status: 'PASS' | 'BLOCK';
  readonly id?: string;
  readonly detail?: string;
}

export interface ValidatorVerdict {
  readonly status: 'PASS' | 'BLOCK' | 'BASELINE_BLOCKED_EXPECTED' | 'AUTH_REQUIRED';
  readonly checks: readonly ValidatorVerdictCheck[];
  /** Always true when the agent claimed success — recorded for audit, never used to grant PASS. */
  readonly agentClaimIgnored: boolean;
  readonly agentClaimedSuccess: boolean;
  readonly summary: string;
}

export function buildValidatorVerdict(input: {
  readonly status: RunStatus;
  readonly checks: readonly ValidationCheckResult[];
  readonly agentClaimedSuccess: boolean;
  readonly notes?: readonly string[];
}): ValidatorVerdict {
  const pipelineStatus =
    input.status === 'PASS' ||
    input.status === 'BLOCK' ||
    input.status === 'BASELINE_BLOCKED_EXPECTED' ||
    input.status === 'AUTH_REQUIRED'
      ? input.status
      : 'BLOCK';

  return {
    status: pipelineStatus,
    checks: input.checks.map((check) => ({
      name: humanizeCheckName(check.checkName),
      status: checkPassed(check) ? 'PASS' : 'BLOCK',
      id: check.checkName,
      detail: `${check.expected} → ${check.actual}`,
    })),
    agentClaimIgnored: input.agentClaimedSuccess,
    agentClaimedSuccess: input.agentClaimedSuccess,
    summary:
      pipelineStatus === 'PASS'
        ? 'Independent checks passed; agent claim was not used as authority'
        : pipelineStatus === 'BASELINE_BLOCKED_EXPECTED'
          ? 'Baseline correctly blocked; agent claim ignored'
          : `Independent validator BLOCK (${input.notes?.join('; ') ?? 'one or more checks failed'})`,
  };
}

export function writeValidatorVerdict(artifactDir: string, verdict: ValidatorVerdict): string {
  const path = join(artifactDir, 'validator-verdict.json');
  writeFileSync(path, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
  return path;
}

/** Client-facing check labels (lowercase, space-separated). */
function humanizeCheckName(id: string): string {
  return id.replace(/[-_]+/g, ' ').trim().toLowerCase();
}
