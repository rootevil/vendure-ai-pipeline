import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AgentAdapter, AgentRunOutcome } from '../agent/agent-adapter.js';
import { loadConfig } from '../config/load-config.js';
import { TaskRunner } from '../execution/task-runner.js';
import { createLogger } from '../logging/logger.js';
import type { AttemptRecord, TaskDefinition } from '../models/types.js';
import { runFailureDemo } from '../scenarios/public-catalog/failure-demo.js';
import { runPublicCatalogScenario } from '../scenarios/public-catalog/run-scenario.js';

export interface ClientDemoResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
  readonly status: string;
  readonly artifactDir: string;
}

export function successDemoLines(input: {
  readonly status: string;
  readonly checkNames: readonly string[];
}): readonly string[] {
  const names = input.checkNames.join('\n').toLowerCase();
  const lines = ['Task', '→ Agent'];
  if (/acceptance-tests|\btests?\b/.test(names)) {
    lines.push('→ Tests');
  }
  if (/browser|playwright/.test(names)) {
    lines.push('→ Browser');
  }
  if (/health|api|graphql|http/.test(names)) {
    lines.push('→ API');
  }
  if (/database|db-state|\bdb\b/.test(names)) {
    lines.push('→ DB');
  }
  lines.push(`→ ${input.status}`);
  return lines;
}

export function recoveryDemoLines(input: {
  readonly status: string;
  readonly stepNames: readonly string[];
}): readonly string[] {
  const names = input.stepNames.join('\n').toLowerCase();
  const lines = ['Task', '→ Agent'];
  if (/deliberate-failure|inject-controlled-failure|failure/.test(names)) {
    lines.push('→ Failure');
  }
  if (/classify-failure|agent-investigates|capture-logs/.test(names)) {
    lines.push('→ Diagnosis');
  }
  if (/smallest-fix|bounded-repair/.test(names)) {
    lines.push('→ Fix');
  }
  if (/targeted-validation-after|run-regression|reproducer/.test(names)) {
    lines.push('→ Retest');
  }
  lines.push(`→ ${input.status}`);
  return lines;
}

export function blockDemoLines(input: {
  readonly status: string;
  readonly attempts: readonly Pick<AttemptRecord, 'failureKind'>[];
  readonly evidencePresent: boolean;
}): readonly string[] {
  const lines = ['Failure'];
  const exhausted =
    input.attempts.length >= 3 && input.attempts.at(-1)?.failureKind === 'repeated';
  if (exhausted) {
    lines.push('→ retries exhausted');
    lines.push('→ circuit breaker');
  }
  lines.push(`→ ${input.status}`);
  if (input.evidencePresent) {
    lines.push('→ evidence');
  }
  return lines;
}

export async function runSuccessDemo(env: NodeJS.ProcessEnv = process.env): Promise<ClientDemoResult> {
  const dirs = demoDirs(env);
  const scenario = await runPublicCatalogScenario({
    rootDir: process.cwd(),
    artifactsDir: dirs.artifactsDir,
    workspaceDir: dirs.workspaceDir,
    ...(dirs.runId !== undefined ? { runId: dirs.runId } : {}),
    keepWorkspace: false,
    logLevel: 'error',
  });
  const checkNames = scenario.result.validationChecks.map((check) => check.checkName);
  return {
    lines: successDemoLines({ status: scenario.result.status, checkNames }),
    exitCode: scenario.result.exitCode,
    status: scenario.result.status,
    artifactDir: scenario.result.artifactDir,
  };
}

export async function runRecoveryDemo(env: NodeJS.ProcessEnv = process.env): Promise<ClientDemoResult> {
  const dirs = demoDirs(env);
  const demo = await runFailureDemo({
    mode: 'recoverable',
    artifactsDir: dirs.artifactsDir,
    workspaceDir: dirs.workspaceDir,
    ...(dirs.runId !== undefined ? { runId: dirs.runId } : {}),
    keepWorkspace: false,
    logger: createLogger({ level: 'error' }),
  });
  return {
    lines: recoveryDemoLines({
      status: demo.result.status,
      stepNames: demo.steps.map((step) => step.name),
    }),
    exitCode: demo.result.exitCode,
    status: demo.result.status,
    artifactDir: demo.result.artifactDir,
  };
}

export async function runBlockDemo(env: NodeJS.ProcessEnv = process.env): Promise<ClientDemoResult> {
  const dirs = demoDirs(env);
  const config = loadConfig({
    ...env,
    PIPELINE_ARTIFACTS_DIR: dirs.artifactsDir,
    PIPELINE_WORKSPACE_DIR: dirs.workspaceDir,
    PIPELINE_MAX_IDENTICAL_RETRIES: '3',
    PIPELINE_MAX_TOTAL_ATTEMPTS: '5',
    PIPELINE_LOG_LEVEL: 'error',
    PIPELINE_ALLOW_NETWORK: 'false',
    ...(dirs.runId !== undefined ? { PIPELINE_RUN_ID: dirs.runId } : {}),
  });
  const runner = new TaskRunner({
    config,
    logger: createLogger({ level: 'error' }),
    agent: repeatingContainerFailureAgent(),
    runTests: async () => 1,
  });
  const result = await runner.execute(blockDemoTask());
  const evidencePresent = existsSync(resolve(result.artifactDir, 'final-report.html'));
  return {
    lines: blockDemoLines({
      status: result.status,
      attempts: result.attempts,
      evidencePresent,
    }),
    exitCode: result.exitCode,
    status: result.status,
    artifactDir: result.artifactDir,
  };
}

function demoDirs(env: NodeJS.ProcessEnv): {
  artifactsDir: string;
  workspaceDir: string;
  runId: string | undefined;
} {
  const config = loadConfig(env);
  return {
    artifactsDir: resolve(config.artifactsDir),
    workspaceDir: resolve(config.workspaceDir),
    runId: config.runId,
  };
}

function repeatingContainerFailureAgent(): AgentAdapter {
  return {
    name: 'demo-block-agent',
    async run(): Promise<AgentRunOutcome> {
      return {
        claimedSuccess: false,
        summary: 'temporary container failure',
        stdout: '',
        stderr: 'container failure',
        failureClass: 'recoverable',
        failureCode: 'TOOL_CRASH',
        changedFiles: [],
        diff: '',
      };
    },
  };
}

function blockDemoTask(): TaskDefinition {
  return {
    id: 'demo-block',
    title: 'Deliberate repeated container failure',
    goal: 'Prove the pipeline circuit-breaks instead of claiming PASS.',
    acceptanceCriteria: ['Identical transient failures stop at the circuit breaker'],
    allowedTools: ['filesystem', 'mock'],
    timeoutMs: 60_000,
    retryPolicy: { maxIdenticalRetries: 3, maxTotalAttempts: 5 },
    validationSteps: [{ id: 'evidence', type: 'evidence_present' }],
    mode: 'acceptance',
    sourcePaths: [],
    writeAllowlist: ['src'],
    requiredEvidence: [
      'run-manifest.json',
      'status.json',
      'stdout.log',
      'stderr.log',
      'change-summary.md',
      'rollback.md',
      'summary.md',
    ],
    stages: [
      {
        id: 'fail',
        description: 'Repeat the same container failure until the circuit opens',
        preconditions: [],
        actions: [],
        expectedChecks: [],
        cleanup: [],
      },
    ],
    circuitBreakRules: ['Same failure 3 times → CIRCUIT_BREAK'],
    cleanupWorkspace: true,
  };
}
