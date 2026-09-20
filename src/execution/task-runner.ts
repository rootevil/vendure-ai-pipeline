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
import type { BrowserLauncher, DatabaseExecutor, HttpFetcher } from '../validator/check-types.js';
import { IndependentValidator } from '../validator/independent-validator.js';
import { writeExecutionReport } from './report.js';

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
  readonly fetchHttp?: HttpFetcher;
  readonly executeDatabase?: DatabaseExecutor;
  readonly launchBrowser?: BrowserLauncher;
}

/**
 * Owns the end-to-end task execution flow.
 * Final PASS/BLOCK is decided only by the independent validator.
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

    const validator = new IndependentValidator({
      allowNetwork: config.allowNetwork,
      ...(this.deps.fetchHttp !== undefined ? { fetchHttp: this.deps.fetchHttp } : {}),
      ...(this.deps.executeDatabase !== undefined
        ? { executeDatabase: this.deps.executeDatabase }
        : {}),
      ...(this.deps.launchBrowser !== undefined ? { launchBrowser: this.deps.launchBrowser } : {}),
      ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
    });

    const controller = new PipelineController({
      config,
      agent,
      validator,
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

    flow.push(FLOW_STEPS[6]);
    // Pipeline status is already decided solely by IndependentValidator.
    const status = result.status;
    const exitCode = result.exitCode;
    const validatorNotes = [...result.validatorNotes];
    const validationSteps = result.validationSteps;
    const validationChecks = result.validationChecks;

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
      validationChecks,
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
      validationChecks,
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
