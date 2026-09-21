import type { RunStatus } from '../../models/types.js';

/**
 * Extension point for load testing.
 *
 * Possible components named by the client spec: Artillery, k6.
 * The MVP adapter does not invoke them and must not be treated as formal load acceptance.
 */
export const LOAD_TEST_TOOLS = ['artillery', 'k6'] as const;

export type ExtendedStageStatus = 'PASS' | 'FAIL' | 'NOT_RUN';

export interface LoadTestRequest {
  readonly runId: string;
  readonly artifactDir: string;
  readonly workspaceDir: string;
  readonly businessStatus: RunStatus;
  readonly targetUrl?: string;
}

export interface LoadTestResult {
  readonly status: ExtendedStageStatus;
  /** True only when a real tool ran. MVP adapters must leave this false. */
  readonly implemented: boolean;
  readonly tool: (typeof LOAD_TEST_TOOLS)[number] | null;
  readonly summary: string;
}

export interface LoadTestAdapter {
  readonly name: string;
  readonly possibleTools: readonly string[];
  run(input: LoadTestRequest): Promise<LoadTestResult>;
}

/** Records the interface without running Artillery or k6. */
export class UnconfiguredLoadTestAdapter implements LoadTestAdapter {
  readonly name = 'unconfigured-load-test';
  readonly possibleTools = LOAD_TEST_TOOLS;

  async run(input: LoadTestRequest): Promise<LoadTestResult> {
    if (input.businessStatus !== 'PASS' && input.businessStatus !== 'BASELINE_BLOCKED_EXPECTED') {
      return {
        status: 'NOT_RUN',
        implemented: false,
        tool: null,
        summary: 'Load test skipped because business validation did not PASS.',
      };
    }
    return {
      status: 'NOT_RUN',
      implemented: false,
      tool: null,
      summary:
        'Load test extension point only. Artillery and k6 are not executed in this MVP and this is not formal load acceptance.',
    };
  }
}
