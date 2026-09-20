import type { ExecutionContext } from '../safety/execution-context.js';
import type {
  RunMode,
  RunStatus,
  ValidationCheckResult,
  ValidationStepResult,
} from '../models/types.js';

/**
 * Independent PASS/BLOCK authority. Must not call an LLM.
 * Agent self-reports are informational only and never grant PASS.
 */
export interface Validator {
  readonly name: string;
  validate(input: ValidatorInput): Promise<ValidatorDecision>;
}

export interface ValidatorInput {
  readonly context: ExecutionContext;
  readonly mode: RunMode;
  readonly agentClaimedSuccess: boolean;
  readonly requiredEvidence: readonly string[];
  readonly presentEvidence: readonly string[];
  readonly testExitCode: number | null;
  readonly changedFiles?: readonly string[];
}

export interface ValidatorDecision {
  readonly status: RunStatus;
  readonly notes: readonly string[];
  readonly exitCode: number;
  readonly checks?: readonly ValidationCheckResult[];
  readonly stepResults?: readonly ValidationStepResult[];
}

export class ArtifactPresenceValidator implements Validator {
  readonly name = 'artifact-presence';

  async validate(input: ValidatorInput): Promise<ValidatorDecision> {
    const notes: string[] = [];

    if (input.agentClaimedSuccess) {
      notes.push('Agent claimed success; ignored for PASS/BLOCK decision');
    }

    const missing = input.requiredEvidence.filter((name) => !input.presentEvidence.includes(name));
    if (missing.length > 0) {
      notes.push(`Missing required evidence: ${missing.join(', ')}`);
      return { status: 'BLOCK', notes, exitCode: 1, checks: [], stepResults: [] };
    }

    if (input.mode === 'baseline') {
      if (input.testExitCode === 0) {
        notes.push('Baseline mode expected failing acceptance checks, but tests passed');
        return { status: 'BLOCK', notes, exitCode: 1, checks: [], stepResults: [] };
      }
      notes.push('Baseline mode correctly observed failing acceptance checks');
      return {
        status: 'BASELINE_BLOCKED_EXPECTED',
        notes,
        exitCode: 0,
        checks: [],
        stepResults: [],
      };
    }

    if (input.testExitCode === null) {
      notes.push('No test exit code recorded; cannot grant PASS');
      return { status: 'BLOCK', notes, exitCode: 1, checks: [], stepResults: [] };
    }

    if (input.testExitCode !== 0) {
      notes.push(`Acceptance checks failed with exit code ${input.testExitCode}`);
      return { status: 'BLOCK', notes, exitCode: 1, checks: [], stepResults: [] };
    }

    notes.push('Required evidence present and acceptance checks passed');
    return { status: 'PASS', notes, exitCode: 0, checks: [], stepResults: [] };
  }
}
