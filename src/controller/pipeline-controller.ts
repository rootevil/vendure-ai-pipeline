import type { AgentAdapter, AgentRunOutcome } from '../agent/agent-adapter.js';
import type { PipelineConfig } from '../config/load-config.js';
import type { EvidenceCollector } from '../evidence/evidence-collector.js';
import type { Logger } from '../logging/logger.js';
import type { AttemptRecord, RunResult, TaskDefinition } from '../models/types.js';
import { classifyFailure } from '../retry/failure-classifier.js';
import { classifyRetryCategory } from '../retry/classified-policy.js';
import { buildFailureSignature, RetryPolicy } from '../retry/retry-policy.js';
import {
  createExecutionContext,
  scanTextForSafetyViolations,
  SafetyError,
  type ExecutionContext,
} from '../safety/execution-context.js';
import { createPreAgentCheckpoint, applyRollbackPolicy } from '../safety/git-checkpoint.js';
import type { Validator } from '../validator/validator.js';

export interface PipelineControllerDependencies {
  readonly config: PipelineConfig;
  readonly agent: AgentAdapter;
  readonly validator: Validator;
  readonly evidence: EvidenceCollector;
  readonly logger: Logger;
  readonly now?: () => Date;
  /** Optional hook for future test runners; null means no tests executed. */
  readonly runTests?: (context: ExecutionContext) => Promise<number>;
}

export class PipelineController {
  constructor(private readonly deps: PipelineControllerDependencies) {}

  async run(task: TaskDefinition): Promise<RunResult> {
    const nowFn = this.deps.now ?? (() => new Date());
    const started = nowFn();
    const context = createExecutionContext({
      config: this.deps.config,
      task,
      logger: this.deps.logger,
      now: started,
    });

    const logger = context.logger;
    logger.info('pipeline run started', {
      agent: this.deps.agent.name,
      validator: this.deps.validator.name,
    });

    const retryPolicy = new RetryPolicy({
      maxIdenticalRetries: this.deps.config.maxIdenticalRetries,
      maxTotalAttempts: this.deps.config.maxTotalAttempts,
    });

    const attempts: AttemptRecord[] = [];
    let lastOutcome: AgentRunOutcome | null = null;
    let stopReason: string | null = null;
    let authRequired = false;
    let clientDecision = false;
    let hardStop: 'BLOCK' | 'CIRCUIT_BREAK' | null = null;

    createPreAgentCheckpoint({
      workspaceDir: context.workspaceDir,
      artifactDir: context.artifactDir,
      now: nowFn,
    });

    // Agent phase never receives an egress grant; validator checks enforce
    // PIPELINE_ALLOW_NETWORK and destination allowlists independently.

    for (;;) {
      const attemptStarted = nowFn();
      let outcome: AgentRunOutcome;

      try {
        outcome = await this.deps.agent.run(context);
        const safetyHit =
          scanTextForSafetyViolations(outcome.stdout) ??
          scanTextForSafetyViolations(outcome.stderr) ??
          scanTextForSafetyViolations(outcome.summary);
        if (safetyHit) {
          throw safetyHit;
        }
        for (const changed of outcome.changedFiles) {
          context.assertWritablePath(changed);
        }
      } catch (error) {
        if (error instanceof SafetyError) {
          const finishedAt = nowFn().toISOString();
          const failureKind = classifyFailure({
            isSafetyViolation: true,
            failureCode: error.code,
            message: error.message,
          });
          const signature = buildFailureSignature({
            failureClass: 'non_recoverable',
            failureKind,
            message: error.message,
            code: error.code,
          });
          attempts.push({
            attempt: attempts.length + 1,
            startedAt: attemptStarted.toISOString(),
            finishedAt,
            failureClass: 'non_recoverable',
            failureKind,
            signature,
            message: error.message,
            agentClaimedSuccess: false,
          });
          retryPolicy.decide({ signature, failureKind: 'unsafe_unknown' });
          return this.finalizeBlocked({
            context,
            attempts,
            lastOutcome,
            status: 'BLOCK',
            notes: [error.message, 'Safe-stop triggered by safety kernel (unsafe/unknown)'],
            finishedAt,
            exitCode: 1,
          });
        }
        throw error;
      }

      lastOutcome = outcome;
      let failureKind = classifyFailure({
        failureClass: outcome.failureClass,
        ...(outcome.failureCode !== undefined ? { failureCode: outcome.failureCode } : {}),
        message: outcome.summary || outcome.stderr || 'agent-failure',
        claimedSuccess: outcome.claimedSuccess,
      });

      const signature = buildFailureSignature({
        failureClass: outcome.failureClass,
        failureKind,
        message: outcome.summary || outcome.stderr || 'agent-failure',
        ...(outcome.failureCode !== undefined ? { code: outcome.failureCode } : {}),
      });

      const finishedAt = nowFn().toISOString();
      attempts.push({
        attempt: attempts.length + 1,
        startedAt: attemptStarted.toISOString(),
        finishedAt,
        failureClass: outcome.failureClass,
        failureKind,
        signature,
        message: outcome.summary || outcome.stderr || 'agent-failure',
        agentClaimedSuccess: outcome.claimedSuccess,
      });

      if (outcome.failureClass === 'auth_required') {
        authRequired = true;
        stopReason = 'Agent reported AUTH_REQUIRED';
        retryPolicy.decide({
          signature,
          failureKind: 'unsafe_unknown',
          authRequired: true,
        });
        break;
      }

      if (outcome.claimedSuccess && outcome.failureClass === 'recoverable') {
        logger.warn(
          'agent claimed success with recoverable failure class; handing off to validator only',
        );
      }

      // Agent claims done → hand off to independent validator. Never treat claim as PASS.
      if (outcome.claimedSuccess && failureKind !== 'unsafe_unknown') {
        stopReason = 'Agent claimed completion; handing off to independent validator';
        break;
      }

      if (outcome.claimedSuccess && failureKind === 'unsafe_unknown') {
        stopReason = 'Agent claimed success with unsafe/unknown failure — stopping';
        retryPolicy.decide({ signature, failureKind: 'unsafe_unknown' });
        break;
      }

      const decision = retryPolicy.decide({
        signature,
        failureKind,
        failureClass: outcome.failureClass,
        ...(outcome.failureCode !== undefined ? { failureCode: outcome.failureCode } : {}),
        message: outcome.summary || outcome.stderr || 'agent-failure',
        category: classifyRetryCategory({
          failureClass: outcome.failureClass,
          ...(outcome.failureCode !== undefined ? { failureCode: outcome.failureCode } : {}),
          message: outcome.summary || outcome.stderr || '',
        }),
      });
      logger.info('retry decision', {
        shouldRetry: decision.shouldRetry,
        reason: decision.reason,
        failureKind: decision.failureKind,
        circuitState: decision.circuitState,
        action: decision.action,
        disposition: decision.disposition,
        category: decision.category,
        attempt: attempts.length,
      });

      if (decision.disposition === 'AUTH_REQUIRED') {
        authRequired = true;
      }
      if (decision.disposition === 'CLIENT_DECISION') {
        clientDecision = true;
      }
      if (decision.disposition === 'BLOCK') {
        hardStop = 'BLOCK';
      }
      if (decision.disposition === 'CIRCUIT_BREAK') {
        hardStop = 'CIRCUIT_BREAK';
      }

      if (!decision.shouldRetry) {
        // Mark the terminal attempt kind as repeated when the budget tripped.
        if (decision.failureKind === 'repeated' && attempts.length > 0) {
          const last = attempts[attempts.length - 1];
          if (last) {
            attempts[attempts.length - 1] = { ...last, failureKind: 'repeated' };
            failureKind = 'repeated';
          }
        }
        stopReason = decision.reason;
        break;
      }
    }

    const finishedAt = nowFn().toISOString();
    let testExitCode: number | null = null;
    if (this.deps.runTests) {
      testExitCode = await this.deps.runTests(context);
    }

    const provisionalStatus = authRequired
      ? 'AUTH_REQUIRED'
      : clientDecision
        ? 'CLIENT_DECISION'
        : 'BLOCK';
    const presentEvidence = await this.deps.evidence.writeBundle({
      context,
      status: provisionalStatus,
      attempts,
      stdout: lastOutcome?.stdout ?? '',
      stderr: lastOutcome?.stderr ?? '',
      diff: lastOutcome?.diff ?? '',
      changeSummary:
        lastOutcome && lastOutcome.changedFiles.length > 0
          ? lastOutcome.changedFiles.map((file) => `- ${file}`).join('\n')
          : 'No files changed by the agent.',
      rollback:
        'Phase 1 rollback: pre-agent git checkpoint taken; on failure restore workspace; on success preserve evidence. See rollback.md.',
      summary: [
        `# Run Summary`,
        '',
        `- Run ID: \`${context.runId}\``,
        `- Mode: \`${context.mode}\``,
        `- Stop reason: ${stopReason ?? 'n/a'}`,
        `- Agent: ${this.deps.agent.name}`,
        `- Agent claimed success: ${String(lastOutcome?.claimedSuccess ?? false)}`,
        `- Circuit state: ${retryPolicy.circuitState}`,
      ].join('\n'),
      networkUsed: false,
      secretsUsed: false,
      maxIdenticalRetries: this.deps.config.maxIdenticalRetries,
      finishedAt,
    });

    // Final PASS/BLOCK comes only from the independent validator — never from agent claims
    // and never by bypassing validation after retries.
    const decision = await this.deps.validator.validate({
      context,
      mode: context.mode,
      agentClaimedSuccess: lastOutcome?.claimedSuccess ?? false,
      requiredEvidence: task.requiredEvidence,
      presentEvidence,
      testExitCode,
      changedFiles: lastOutcome?.changedFiles ?? [],
    });

    if (!authRequired && decision.status === 'BLOCK') {
      retryPolicy.recordValidationFailure(decision.notes.join('; ') || 'validator BLOCK');
    }

    const status = authRequired
      ? 'AUTH_REQUIRED'
      : clientDecision
        ? 'CLIENT_DECISION'
        : hardStop === 'BLOCK' || hardStop === 'CIRCUIT_BREAK'
          ? 'BLOCK'
          : decision.status;
    const exitCode =
      status === 'PASS' || status === 'BASELINE_BLOCKED_EXPECTED'
        ? 0
        : status === 'AUTH_REQUIRED'
          ? 2
          : 1;

    await this.deps.evidence.writeBundle({
      context,
      status,
      attempts,
      stdout: lastOutcome?.stdout ?? '',
      stderr: lastOutcome?.stderr ?? '',
      diff: lastOutcome?.diff ?? '',
      changeSummary:
        lastOutcome && lastOutcome.changedFiles.length > 0
          ? lastOutcome.changedFiles.map((file) => `- ${file}`).join('\n')
          : 'No files changed by the agent.',
      rollback:
        'Phase 1 rollback: pre-agent git checkpoint taken; on failure restore workspace; on success preserve evidence. See rollback.md.',
      summary: [
        `# Run Summary`,
        '',
        `- Run ID: \`${context.runId}\``,
        `- Mode: \`${context.mode}\``,
        `- Validator status: \`${status}\``,
        `- Stop reason: ${stopReason ?? 'n/a'}`,
        `- Agent claimed success: ${String(lastOutcome?.claimedSuccess ?? false)} (ignored for verdict)`,
        `- Circuit state: ${retryPolicy.circuitState}`,
        ...decision.notes.map((note) => `- Note: ${note}`),
      ].join('\n'),
      networkUsed: false,
      secretsUsed: false,
      maxIdenticalRetries: this.deps.config.maxIdenticalRetries,
      finishedAt,
    });

    const rollbackOutcome = applyRollbackPolicy({
      status,
      workspaceDir: context.workspaceDir,
      artifactDir: context.artifactDir,
      ...(lastOutcome?.diff !== undefined ? { agentDiff: lastOutcome.diff } : {}),
    });
    logger.info('rollback policy applied', {
      action: rollbackOutcome.action,
      preserved: rollbackOutcome.preserved,
      workspaceRestored: rollbackOutcome.workspaceRestored,
    });

    logger.info('pipeline run finished', {
      status,
      exitCode,
      artifactDir: context.artifactDir,
      circuitState: retryPolicy.circuitState,
    });

    return {
      runId: context.runId,
      mode: context.mode,
      status,
      taskId: task.id,
      startedAt: context.startedAt,
      finishedAt,
      artifactDir: context.artifactDir,
      attempts,
      validatorNotes: decision.notes,
      agentSummary: lastOutcome?.summary ?? null,
      exitCode,
      changedFiles: lastOutcome?.changedFiles ?? [],
      validationSteps: decision.stepResults ?? [],
      validationChecks: decision.checks ?? [],
      report: null,
      workspaceCleaned: false,
      evidenceManifest: null,
    };
  }

  private async finalizeBlocked(input: {
    readonly context: ExecutionContext;
    readonly attempts: AttemptRecord[];
    readonly lastOutcome: AgentRunOutcome | null;
    readonly status: RunResult['status'];
    readonly notes: readonly string[];
    readonly finishedAt: string;
    readonly exitCode: number;
  }): Promise<RunResult> {
    await this.deps.evidence.writeBundle({
      context: input.context,
      status: input.status,
      attempts: input.attempts,
      stdout: input.lastOutcome?.stdout ?? '',
      stderr: input.lastOutcome?.stderr ?? '',
      diff: input.lastOutcome?.diff ?? '',
      changeSummary: 'Run stopped before normal completion.',
      rollback:
        'Phase 1 rollback: unrecoverable stop — git diff captured and workspace restored to pre-agent checkpoint when possible.',
      summary: [`# Run Summary`, '', ...input.notes.map((note) => `- ${note}`)].join('\n'),
      networkUsed: false,
      secretsUsed: false,
      maxIdenticalRetries: this.deps.config.maxIdenticalRetries,
      finishedAt: input.finishedAt,
    });

    applyRollbackPolicy({
      status: input.status,
      workspaceDir: input.context.workspaceDir,
      artifactDir: input.context.artifactDir,
      ...(input.lastOutcome?.diff !== undefined ? { agentDiff: input.lastOutcome.diff } : {}),
    });

    return {
      runId: input.context.runId,
      mode: input.context.mode,
      status: input.status,
      taskId: input.context.task.id,
      startedAt: input.context.startedAt,
      finishedAt: input.finishedAt,
      artifactDir: input.context.artifactDir,
      attempts: input.attempts,
      validatorNotes: input.notes,
      agentSummary: input.lastOutcome?.summary ?? null,
      exitCode: input.exitCode,
      changedFiles: input.lastOutcome?.changedFiles ?? [],
      validationSteps: [],
      validationChecks: [],
      report: null,
      workspaceCleaned: false,
      evidenceManifest: null,
    };
  }
}
