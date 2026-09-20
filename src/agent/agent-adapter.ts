import type { ExecutionContext } from '../safety/execution-context.js';
import type { FailureClass } from '../models/types.js';

/**
 * Pluggable coding/debugging worker.
 * Implementations wrap OpenHands (or peers). The agent must never decide
 * final Pipeline PASS/BLOCK — that belongs exclusively to the validator.
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

/** Informational envelope an agent may write; never includes pipeline status. */
export interface AgentResultEnvelope {
  readonly summary: string;
  readonly claimed_success: boolean;
  readonly changed_files?: readonly string[];
}

export class NoopAgentAdapter implements AgentAdapter {
  readonly name = 'noop';

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    context.logger.info('noop agent invoked; no code changes performed');
    return {
      claimedSuccess: false,
      summary:
        'Noop agent does not implement coding behavior. Use PIPELINE_AGENT_MODE=mock|openhands.',
      stdout: '',
      stderr: 'noop-agent: no implementation',
      failureClass: 'non_recoverable',
      failureCode: 'NOOP_AGENT',
      changedFiles: [],
      diff: '',
    };
  }
}
