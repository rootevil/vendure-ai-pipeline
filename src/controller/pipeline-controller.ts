import type { AgentAdapter, AgentRunOutcome } from '../agent/agent-adapter.js';
import type { PipelineConfig } from '../config/load-config.js';
import type { EvidenceCollector } from '../evidence/evidence-collector.js';
import type { Logger } from '../logging/logger.js';
import type { AttemptRecord, RunResult, TaskDefinition } from '../models/types.js';
import { buildFailureSignature, RetryPolicy } from '../retry/retry-policy.js';
import {
  assertNetworkAllowed,
  createExecutionContext,
  scanTextForSafetyViolations,
  SafetyError,
  type ExecutionContext,
} from '../safety/execution-context.js';
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

    try {
      assertNetworkAllowed(context.allowNetwork, false);
    } catch (error) {
      return this.finalizeBlocked({
        context,
        attempts,
        lastOutcome,
        status: 'BLOCK',
        notes: [error instanceof Error ? error.message : String(error)],
        finishedAt: nowFn().toISOString(),
        exitCode: 1,
      });
    }

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
          attempts.push({
            attempt: attempts.length + 1,
            startedAt: attemptStarted.toISOString(),
            finishedAt,
            failureClass: error.code === 'SECRET_PATTERN' ? 'non_recoverable' : 'non_recoverable',
            signature: buildFailureSignature({
              failureClass: 'non_recoverable',
              message: error.message,
              code: error.code,
            }),
            message: error.message,
            agentClaimedSuccess: false,
          });
          return this.finalizeBlocked({
            context,
            attempts,
            lastOutcome,
            status: error.code === 'SECRET_PATTERN' ? 'BLOCK' : 'BLOCK',
            notes: [error.message, 'Safe-stop triggered by safety kernel'],
            finishedAt,
            exitCode: 1,
          });
        }
        throw error;
      }

      lastOutcome = outcome;
      const signature = buildFailureSignature({
        failureClass: outcome.failureClass,
        message: outcome.summary || outcome.stderr || 'agent-failure',
        ...(outcome.failureCode !== undefined ? { code: outcome.failureCode } : {}),
      });

      const finishedAt = nowFn().toISOString();
      attempts.push({
        attempt: attempts.length + 1,
        startedAt: attemptStarted.toISOString(),
        finishedAt,
        failureClass: outcome.failureClass,
        signature,
        message: outcome.summary || outcome.stderr || 'agent-failure',
        agentClaimedSuccess: outcome.claimedSuccess,
      });

      if (outcome.failureClass === 'auth_required') {
        authRequired = true;
        stopReason = 'Agent reported AUTH_REQUIRED';
        break;
      }

      if (outcome.claimedSuccess && outcome.failureClass === 'recoverable') {
        // Inconsistent agent report — treat as non-success and consult retry policy.
        logger.warn(
          'agent claimed success with recoverable failure class; continuing control loop',
        );
      }

      if (outcome.claimedSuccess && outcome.failureClass !== 'non_recoverable') {
        // Agent claims done; still leave PASS/BLOCK to validator after evidence.
        stopReason = 'Agent claimed completion; handing off to validator';
        break;
      }

      const decision = retryPolicy.recordAttempt(signature, outcome.failureClass);
      logger.info('retry decision', {
        shouldRetry: decision.shouldRetry,
        reason: decision.reason,
        attempt: attempts.length,
      });

      if (!decision.shouldRetry) {
        stopReason = decision.reason;
        break;
      }
    }

    const finishedAt = nowFn().toISOString();
    let testExitCode: number | null = null;
    if (this.deps.runTests) {
      testExitCode = await this.deps.runTests(context);
    }

    const provisionalStatus = authRequired ? 'AUTH_REQUIRED' : 'BLOCK';
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
        'Rollback: discard the disposable workspace for this runId and retain only artifacts. Do not mutate client main.',
      summary: [
        `# Run Summary`,
        '',
        `- Run ID: \`${context.runId}\``,
        `- Mode: \`${context.mode}\``,
        `- Stop reason: ${stopReason ?? 'n/a'}`,
        `- Agent: ${this.deps.agent.name}`,
        `- Agent claimed success: ${String(lastOutcome?.claimedSuccess ?? false)}`,
      ].join('\n'),
      networkUsed: false,
      secretsUsed: false,
      maxIdenticalRetries: this.deps.config.maxIdenticalRetries,
      finishedAt,
    });

    // Final PASS/BLOCK comes only from the independent validator — never from agent claims.
    const decision = await this.deps.validator.validate({
      context,
      mode: context.mode,
      agentClaimedSuccess: lastOutcome?.claimedSuccess ?? false,
      requiredEvidence: task.requiredEvidence,
      presentEvidence,
      testExitCode,
      changedFiles: lastOutcome?.changedFiles ?? [],
    });

    const status = authRequired ? 'AUTH_REQUIRED' : decision.status;
    const exitCode = authRequired ? 2 : decision.exitCode;

    // Rewrite status.json via a second evidence write for final validator status.
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
        'Rollback: discard the disposable workspace for this runId and retain only artifacts. Do not mutate client main.',
      summary: [
        `# Run Summary`,
        '',
        `- Run ID: \`${context.runId}\``,
        `- Mode: \`${context.mode}\``,
        `- Validator status: \`${status}\``,
        `- Stop reason: ${stopReason ?? 'n/a'}`,
        `- Agent claimed success: ${String(lastOutcome?.claimedSuccess ?? false)} (ignored for verdict)`,
        ...decision.notes.map((note) => `- Note: ${note}`),
      ].join('\n'),
      networkUsed: false,
      secretsUsed: false,
      maxIdenticalRetries: this.deps.config.maxIdenticalRetries,
      finishedAt,
    });

    logger.info('pipeline run finished', { status, exitCode, artifactDir: context.artifactDir });

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
        'Rollback: discard the disposable workspace for this runId and retain only artifacts.',
      summary: [`# Run Summary`, '', ...input.notes.map((note) => `- ${note}`)].join('\n'),
      networkUsed: false,
      secretsUsed: false,
      maxIdenticalRetries: this.deps.config.maxIdenticalRetries,
      finishedAt: input.finishedAt,
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
