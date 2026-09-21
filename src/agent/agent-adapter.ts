import type { ExecutionContext } from '../safety/execution-context.js';
import type { FailureClass } from '../models/types.js';
import type { AgentReport, AgentRequest } from './agent-request.js';

/**
 * Pluggable coding/debugging worker.
 *
 * Architecture:
 *   Pipeline → Agent Adapter → OpenHands / selected runtime → Coding Agent → Workspace
 *
 * The adapter must never decide final Pipeline PASS/BLOCK — that belongs
 * exclusively to the independent validator. Agent claimedSuccess ≠ Pipeline PASS.
 */
export interface AgentAdapter {
  readonly name: string;
  run(context: ExecutionContext): Promise<AgentRunOutcome>;
}

/**
 * Normalized adapter outcome handed to the Pipeline controller.
 * Extends the AgentReport contract with classification metadata for recovery.
 */
export interface AgentRunOutcome extends AgentReport {
  readonly failureClass: FailureClass;
  readonly failureCode?: string;
  /** Echo of the request given to the agent (audit). */
  readonly request?: AgentRequest;
}

/** Informational envelope an agent may write; never includes pipeline status. */
export interface AgentResultEnvelope {
  readonly summary: string;
  readonly claimed_success: boolean;
  readonly changed_files?: readonly string[];
  readonly commands_executed?: readonly string[];
  readonly errors?: readonly string[];
}

export function agentOutcome(parts: {
  readonly claimedSuccess: boolean;
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly failureClass: FailureClass;
  readonly failureCode?: string;
  readonly changedFiles?: readonly string[];
  readonly diff?: string;
  readonly commandsExecuted?: readonly string[];
  readonly errors?: readonly string[];
  readonly finalReport?: string;
  readonly request?: AgentRequest;
}): AgentRunOutcome {
  return {
    claimedSuccess: parts.claimedSuccess,
    summary: parts.summary,
    stdout: parts.stdout ?? '',
    stderr: parts.stderr ?? '',
    failureClass: parts.failureClass,
    ...(parts.failureCode !== undefined ? { failureCode: parts.failureCode } : {}),
    changedFiles: parts.changedFiles ?? [],
    diff: parts.diff ?? '',
    commandsExecuted: parts.commandsExecuted ?? [],
    errors:
      parts.errors ??
      (parts.failureCode !== undefined && !parts.claimedSuccess ? [parts.failureCode] : []),
    finalReport: parts.finalReport ?? parts.summary,
    ...(parts.request !== undefined ? { request: parts.request } : {}),
  };
}

export class NoopAgentAdapter implements AgentAdapter {
  readonly name = 'noop';

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    context.logger.info('noop agent invoked; no code changes performed');
    return agentOutcome({
      claimedSuccess: false,
      summary:
        'Noop agent does not implement coding behavior. Use PIPELINE_AGENT_MODE=mock|openhands.',
      stderr: 'noop-agent: no implementation',
      failureClass: 'non_recoverable',
      failureCode: 'NOOP_AGENT',
      finalReport: 'noop: no coding performed',
    });
  }
}
