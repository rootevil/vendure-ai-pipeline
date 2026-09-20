import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createAgentAdapter } from '../agent/agent-factory.js';
import type { AgentAdapter } from '../agent/agent-adapter.js';
import type { PipelineConfig } from '../config/load-config.js';
import { PipelineController } from '../controller/pipeline-controller.js';
import { FileEvidenceCollector } from '../evidence/evidence-collector.js';
import type { Logger } from '../logging/logger.js';
import type { ExecutionReport, RunResult, TaskDefinition } from '../models/types.js';
import { createExecutionContext, type ExecutionContext } from '../safety/execution-context.js';
import { assertTaskSafe } from '../task/task-safety.js';
import { ArtifactPresenceValidator } from '../validator/validator.js';
import { writeExecutionReport } from './report.js';
import { runValidationSteps, validationStepsPassed } from './validation-steps.js';

const FLOW_STEPS = [
  'parse/validate task',
  'create isolated run',
  'execute agent',
  'collect changes',
  'run validators',
  'collect evidence',
  'determine PASS/BLOCK',
  'cleanup',
  'generate report',
] as const;

export interface TaskRunnerDependencies {
  readonly config: PipelineConfig;
  readonly logger: Logger;
  readonly agent?: AgentAdapter;
  readonly now?: () => Date;
  readonly runTests?: (context: ExecutionContext) => Promise<number>;
}

/**
 * Owns the Phase 4 end-to-end task execution flow.
 * Rejects unsafe tasks before any agent work begins.
 */
export class TaskRunner {
  constructor(private readonly deps: TaskRunnerDependencies) {}

  async execute(task: TaskDefinition): Promise<RunResult> {
    const flow: string[] = [];
    flow.push(FLOW_STEPS[0]);
    assertTaskSafe(task);

    const config = applyTaskOverrides(this.deps.config, task);
    const agent =
      this.deps.agent ??
      createAgentAdapter({
        config: {
          ...config,
          agentTimeoutMs: Math.min(config.agentTimeoutMs, task.timeoutMs),
        },
      });

    const controller = new PipelineController({
      config,
      agent,
      validator: new ArtifactPresenceValidator(),
      evidence: new FileEvidenceCollector(),
      logger: this.deps.logger,
      ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
      ...(this.deps.runTests !== undefined ? { runTests: this.deps.runTests } : {}),
    });

    flow.push(FLOW_STEPS[1], FLOW_STEPS[2], FLOW_STEPS[3], FLOW_STEPS[4], FLOW_STEPS[5]);
    const result = await controller.run(task);

    const context = createExecutionContext({
      config: {
        ...config,
        runId: result.runId,
      },
      task,
      logger: this.deps.logger,
    });

    const presentEvidence = listPresentEvidence(result.artifactDir, [
      ...task.requiredEvidence,
      'diff.patch',
      'attempts.json',
    ]);

    const validationSteps = runValidationSteps({
      task,
      context,
      presentEvidence,
      changedFiles: result.changedFiles,
    });

    flow.push(FLOW_STEPS[6]);
    let status = result.status;
    let exitCode = result.exitCode;
    const validatorNotes = [...result.validatorNotes];
    if (!validationStepsPassed(validationSteps)) {
      status = status === 'AUTH_REQUIRED' ? status : 'BLOCK';
      exitCode = status === 'AUTH_REQUIRED' ? exitCode : 1;
      validatorNotes.push('One or more task validationSteps failed');
    }

    let workspaceCleaned = false;
    if (task.cleanupWorkspace) {
      try {
        rmSync(context.workspaceDir, { recursive: true, force: true });
        workspaceCleaned = !existsSync(context.workspaceDir);
      } catch (error) {
        validatorNotes.push(
          `Workspace cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    flow.push(FLOW_STEPS[7]);

    const report: ExecutionReport = {
      runId: result.runId,
      taskId: task.id,
      status,
      exitCode,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      goal: task.goal,
      acceptanceCriteria: task.acceptanceCriteria,
      allowedTools: task.allowedTools,
      timeoutMs: task.timeoutMs,
      retryPolicy: task.retryPolicy,
      flow: [...flow, FLOW_STEPS[8]],
      attempts: result.attempts,
      changedFiles: result.changedFiles,
      validationSteps,
      validatorNotes,
      agentSummary: result.agentSummary,
      artifactDir: result.artifactDir,
      workspaceCleaned,
      reportPath: join(result.artifactDir, 'report.json'),
    };

    writeExecutionReport(report);
    flow.push(FLOW_STEPS[8]);

    this.deps.logger.info('task execution finished', {
      status,
      exitCode,
      workspaceCleaned,
      reportPath: report.reportPath,
    });

    return {
      ...result,
      status,
      exitCode,
      validatorNotes,
      report,
      workspaceCleaned,
      validationSteps,
    };
  }
}

function applyTaskOverrides(config: PipelineConfig, task: TaskDefinition): PipelineConfig {
  return {
    ...config,
    maxIdenticalRetries: task.retryPolicy.maxIdenticalRetries,
    maxTotalAttempts: task.retryPolicy.maxTotalAttempts,
    agentTimeoutMs: Math.min(config.agentTimeoutMs, task.timeoutMs),
    writeAllowlist:
      config.writeAllowlist.length > 0
        ? unique([...config.writeAllowlist, ...task.writeAllowlist])
        : [...task.writeAllowlist],
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function listPresentEvidence(artifactDir: string, candidates: readonly string[]): string[] {
  return candidates.filter((name) => existsSync(join(artifactDir, name)));
}
