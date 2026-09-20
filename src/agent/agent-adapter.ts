import type { ExecutionContext } from '../safety/execution-context.js';
import type { FailureClass } from '../models/types.js';

/**
 * Pluggable coding/debugging worker. Implementations (OpenHands, etc.) are
 * swapped later; Phase 1 ships a deterministic noop stub only.
 */
export interface AgentAdapter {
  readonly name: string;
  run(context: ExecutionContext): Promise<AgentRunOutcome>;
}

export interface AgentRunOutcome {
  readonly claimedSuccess: boolean;
  readonly summary: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly failureClass: FailureClass;
  readonly failureCode?: string;
  readonly changedFiles: readonly string[];
  readonly diff: string;
}

export class NoopAgentAdapter implements AgentAdapter {
  readonly name = 'noop';

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    context.logger.info('noop agent invoked; no code changes performed');
    return {
      claimedSuccess: false,
      summary:
        'Noop agent does not implement coding behavior. Replace with OpenHands (or peer) adapter.',
      stdout: '',
      stderr: 'noop-agent: no implementation',
      failureClass: 'non_recoverable',
      failureCode: 'NOOP_AGENT',
      changedFiles: [],
      diff: '',
    };
  }
}
