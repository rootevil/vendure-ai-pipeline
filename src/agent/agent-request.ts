import type { AllowedTool, TaskDefinition } from '../models/types.js';
import type { ExecutionContext } from '../safety/execution-context.js';

/**
 * What the Pipeline gives the Agent via the adapter.
 * Deliberately excludes any Pipeline PASS/BLOCK field.
 */
export interface AgentRequest {
  readonly taskId: string;
  readonly title: string;
  readonly goal: string;
  /** Isolated repository / workspace root for this run. */
  readonly repository: string;
  readonly workspace: string;
  readonly acceptanceCriteria: readonly string[];
  readonly availableTools: readonly AllowedTool[];
  readonly timeLimitMs: number;
  readonly retryLimit: {
    readonly maxIdenticalRetries: number;
    readonly maxTotalAttempts: number;
  };
  readonly writeAllowlist: readonly string[];
  readonly mode: TaskDefinition['mode'];
  readonly circuitBreakRules: readonly string[];
  /**
   * Hard reminder embedded in every request:
   * Agent claimed success is informational only.
   */
  readonly pipelineAuthority: 'independent_validator_only';
}

/**
 * What the Agent Adapter returns to the Pipeline.
 * `claimedSuccess` is never treated as Pipeline PASS.
 */
export interface AgentReport {
  readonly claimedSuccess: boolean;
  readonly summary: string;
  readonly changedFiles: readonly string[];
  /** Commands the adapter/agent recorded for this attempt. */
  readonly commandsExecuted?: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  /** Structured error codes/messages from the agent attempt. */
  readonly errors?: readonly string[];
  /** Human-readable final agent report (informational only). */
  readonly finalReport?: string;
  readonly diff: string;
}

export function buildAgentRequest(
  context: ExecutionContext,
  timeLimitMs: number,
): AgentRequest {
  const task = context.task;
  return {
    taskId: task.id,
    title: task.title,
    goal: task.goal,
    repository: context.workspaceDir,
    workspace: context.workspaceDir,
    acceptanceCriteria: [...task.acceptanceCriteria],
    availableTools: [...task.allowedTools],
    timeLimitMs,
    retryLimit: {
      maxIdenticalRetries: task.retryPolicy.maxIdenticalRetries,
      maxTotalAttempts: task.retryPolicy.maxTotalAttempts,
    },
    writeAllowlist: [...context.writeAllowlist],
    mode: task.mode,
    circuitBreakRules: [...task.circuitBreakRules],
    pipelineAuthority: 'independent_validator_only',
  };
}
