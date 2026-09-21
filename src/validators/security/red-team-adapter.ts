import type { RunStatus } from '../../models/types.js';

/**
 * Extension point for security / red-team checks.
 *
 * Possible components named by the client spec: Semgrep, Trivy, CodeQL, sqlmap.
 * The MVP adapter does not invoke them and must not be treated as formal red-team acceptance.
 */
export const RED_TEAM_TOOLS = ['semgrep', 'trivy', 'codeql', 'sqlmap'] as const;

export type ExtendedStageStatus = 'PASS' | 'FAIL' | 'NOT_RUN';

export interface RedTeamRequest {
  readonly runId: string;
  readonly artifactDir: string;
  readonly workspaceDir: string;
  readonly businessStatus: RunStatus;
}

export interface RedTeamResult {
  readonly status: ExtendedStageStatus;
  /** True only when a real tool ran. MVP adapters must leave this false. */
  readonly implemented: boolean;
  readonly tool: (typeof RED_TEAM_TOOLS)[number] | null;
  readonly summary: string;
}

export interface RedTeamAdapter {
  readonly name: string;
  readonly possibleTools: readonly string[];
  run(input: RedTeamRequest): Promise<RedTeamResult>;
}

/** Records the interface without running Semgrep, Trivy, CodeQL, or sqlmap. */
export class UnconfiguredRedTeamAdapter implements RedTeamAdapter {
  readonly name = 'unconfigured-red-team';
  readonly possibleTools = RED_TEAM_TOOLS;

  async run(input: RedTeamRequest): Promise<RedTeamResult> {
    if (input.businessStatus !== 'PASS' && input.businessStatus !== 'BASELINE_BLOCKED_EXPECTED') {
      return {
        status: 'NOT_RUN',
        implemented: false,
        tool: null,
        summary: 'Red-team stage skipped because business validation did not PASS.',
      };
    }
    return {
      status: 'NOT_RUN',
      implemented: false,
      tool: null,
      summary:
        'Red-team extension point only. Semgrep, Trivy, CodeQL, and sqlmap are not executed in this MVP and this is not formal security acceptance.',
    };
  }
}
