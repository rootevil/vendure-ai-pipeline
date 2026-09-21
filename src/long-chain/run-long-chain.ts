import { resolve } from 'node:path';

import { loadConfig } from '../config/load-config.js';
import { compileScenarioBundleFromPath } from '../compiler/scenario-compiler.js';
import { TaskRunner } from '../execution/task-runner.js';
import { createLogger, type Logger } from '../logging/logger.js';
import type { RunResult, TaskDefinition } from '../models/types.js';
import type { TechnicalScenario } from '../compiler/technical-scenario.js';
import { discoverLongChainTasks } from './discover-tasks.js';

export interface LongChainTaskOutcome {
  readonly taskPath: string;
  readonly taskId: string;
  readonly technicalId: string | null;
  readonly compiled: boolean;
  readonly executed: boolean;
  readonly status: string;
  readonly exitCode: number;
  readonly artifactDir: string | null;
  readonly flow: readonly string[];
  readonly notes: readonly string[];
}

export interface LongChainRunResult {
  readonly tasks: readonly LongChainTaskOutcome[];
  readonly exitCode: number;
  readonly summaryLines: readonly string[];
}

export interface RunLongChainOptions {
  readonly repoRoot?: string;
  readonly tasksDir?: string;
  /** When true, only compile Task → Scenario → TaskDefinition (no agent). */
  readonly compileOnly?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
}

/**
 * Execute every discovered long-chain card with the same Pipeline:
 *   Task → Scenario → Agent → Tools → Validators → evidence
 *
 * No per-task `if (task === 'checkout')` branches — the scenario compiler
 * turns acceptance language into checks; TaskRunner is identical for all slots.
 */
export async function runLongChainTasks(
  options: RunLongChainOptions = {},
): Promise<LongChainRunResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const paths = discoverLongChainTasks(options.tasksDir ?? 'tasks', repoRoot);
  const logger = options.logger ?? createLogger({ level: 'error' });
  const compileOnly = options.compileOnly === true;
  const outcomes: LongChainTaskOutcome[] = [];
  const summaryLines: string[] = [
    '[LONG-CHAIN] Task → Scenario → Agent → Tools → Validators',
  ];

  if (paths.length === 0) {
    summaryLines.push('[LONG-CHAIN] No tasks/task-NN.yaml cards found');
    return { tasks: [], exitCode: 1, summaryLines };
  }

  for (const taskPath of paths) {
    const relative = toRelative(taskPath, repoRoot);
    summaryLines.push(`[LONG-CHAIN] ${relative}`);

    let bundle: { technical: TechnicalScenario | null; task: TaskDefinition };
    try {
      bundle = compileScenarioBundleFromPath(taskPath, repoRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summaryLines.push(`[COMPILER] FAIL — ${message}`);
      summaryLines.push(`[RESULT] BLOCK`);
      outcomes.push({
        taskPath: relative,
        taskId: relative,
        technicalId: null,
        compiled: false,
        executed: false,
        status: 'BLOCK',
        exitCode: 1,
        artifactDir: null,
        flow: ['compile'],
        notes: [message],
      });
      continue;
    }

    summaryLines.push('[COMPILER] Creating acceptance criteria');
    if (compileOnly) {
      summaryLines.push('[COMPILER] compile-only — agent not started');
      summaryLines.push(`[RESULT] COMPILED`);
      outcomes.push({
        taskPath: relative,
        taskId: bundle.task.id,
        technicalId: bundle.technical?.id ?? null,
        compiled: true,
        executed: false,
        status: 'COMPILED',
        exitCode: 0,
        artifactDir: null,
        flow: ['Task', 'Scenario'],
        notes: ['compile-only'],
      });
      continue;
    }

    summaryLines.push('[AGENT] Starting isolated workspace');
    const config = loadConfig(options.env ?? process.env);
    const runner = new TaskRunner({
      config: {
        ...config,
        // Distinct run ids per slot when env does not pin one.
        runId: config.runId ?? `long-chain-${bundle.task.id}-${Date.now()}`,
      },
      logger,
    });

    const result: RunResult = await runner.execute(bundle.task);
    summaryLines.push(`[VALIDATOR] Independent checks → ${result.status}`);
    summaryLines.push(`[EVIDENCE] ${result.artifactDir}`);
    summaryLines.push(`[RESULT] ${result.status}`);

    outcomes.push({
      taskPath: relative,
      taskId: bundle.task.id,
      technicalId: bundle.technical?.id ?? null,
      compiled: true,
      executed: true,
      status: result.status,
      exitCode: result.exitCode,
      artifactDir: result.artifactDir,
      flow: result.report?.flow ?? ['Task', 'Scenario', 'Agent', 'Validators'],
      notes: result.validatorNotes,
    });
  }

  const exitCode = outcomes.every((o) => o.exitCode === 0) ? 0 : 1;
  summaryLines.push(
    `[LONG-CHAIN] ${outcomes.filter((o) => o.exitCode === 0).length}/${outcomes.length} slots ok`,
  );
  summaryLines.push(
    '[LONG-CHAIN] Formal client gate requires live Batch E2E evidence — framework only until then.',
  );
  return { tasks: outcomes, exitCode, summaryLines };
}

function toRelative(absolute: string, repoRoot: string): string {
  const root = resolve(repoRoot);
  if (absolute.startsWith(root)) {
    return absolute.slice(root.length).replace(/^[/\\]/, '').replaceAll('\\', '/');
  }
  return absolute.replaceAll('\\', '/');
}
