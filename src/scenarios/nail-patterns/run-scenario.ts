import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { PipelineConfig } from '../../config/load-config.js';
import { TaskRunner } from '../../execution/task-runner.js';
import { createLogger } from '../../logging/logger.js';
import type { RunResult, TaskDefinition } from '../../models/types.js';
import { loadTaskDefinitionFromJsonFile } from '../../task/task-definition.js';
import { NailPatternsScenarioAgent } from './scenario-agent.js';

export interface NailPatternsScenarioOptions {
  readonly rootDir?: string;
  readonly runId?: string;
  readonly keepWorkspace?: boolean;
  readonly repoRoot?: string;
}

export interface NailPatternsScenarioResult {
  readonly result: RunResult;
  readonly task: TaskDefinition;
}

/**
 * Bounded Phase 1 path/fixture task: nail-patterns relative-path invariants.
 */
export async function runNailPatternsScenario(
  options: NailPatternsScenarioOptions = {},
): Promise<NailPatternsScenarioResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const root = options.rootDir ?? mkdtempSync(join(tmpdir(), 'vendure-nail-patterns-'));
  const runId = options.runId ?? `nail-patterns-${Date.now()}`;
  const workspaceDir = join(root, 'workspace');
  const artifactsDir = join(root, 'artifacts');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  const taskPath = resolve(repoRoot, 'fixtures/tasks/nail-patterns-path-invariant.json');
  const task = {
    ...loadTaskDefinitionFromJsonFile(taskPath),
    cleanupWorkspace: options.keepWorkspace !== true,
  };

  const localTaskPath = join(root, 'task.json');
  writeFileSync(localTaskPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');

  const config: PipelineConfig = {
    mode: 'acceptance',
    artifactsDir,
    workspaceDir,
    maxIdenticalRetries: task.retryPolicy.maxIdenticalRetries,
    maxTotalAttempts: task.retryPolicy.maxTotalAttempts,
    allowNetwork: false,
    logLevel: 'info',
    runId,
    writeAllowlist: [...task.writeAllowlist],
    agentMode: 'mock',
    agentTimeoutMs: task.timeoutMs,
    openhandsCommand: 'openhands',
    mockAgentBehavior: 'success',
  };

  const runner = new TaskRunner({
    config,
    logger: createLogger({ level: 'info' }),
    agent: new NailPatternsScenarioAgent(),
  });

  const result = await runner.execute(task);
  return { result, task };
}
