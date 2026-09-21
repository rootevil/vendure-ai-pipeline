import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentAdapter, AgentRunOutcome } from '../../agent/agent-adapter.js';
import type { PipelineConfig } from '../../config/load-config.js';
import { FileEvidenceCollector } from '../../evidence/evidence-collector.js';
import { finalizeEvidencePack } from '../../evidence/evidence-pack.js';
import { createLogger, type Logger } from '../../logging/logger.js';
import type {
  AttemptRecord,
  EvidenceManifest,
  FailureKind,
  RunResult,
  TaskDefinition,
  ValidationCheckResult,
} from '../../models/types.js';
import { classifyFailure } from '../../retry/failure-classifier.js';
import { buildFailureSignature, RetryPolicy } from '../../retry/retry-policy.js';
import {
  createExecutionContext,
  scanTextForSafetyViolations,
  SafetyError,
  type ExecutionContext,
} from '../../safety/execution-context.js';
import { createFakeBrowserLauncher } from '../../validator/browser-launcher.js';
import { IndependentValidator } from '../../validator/independent-validator.js';
import { startPublicCatalogDemoServer, type DemoServerHandle } from './demo-server.js';
import {
  RecoverableFailureDemoAgent,
  UnrecoverableFailureDemoAgent,
  writeRepairBrief,
  type RepairBrief,
} from './failure-agents.js';
import { buildScenarioTask } from './run-scenario.js';
import { materializeEvaluationDemo, runAcceptanceTests } from './scenario-agent.js';

export type FailureDemoMode = 'recoverable' | 'unrecoverable';

export interface FailureDemoOptions {
  readonly mode: FailureDemoMode;
  readonly rootDir?: string;
  readonly artifactsDir?: string;
  readonly workspaceDir?: string;
  readonly runId?: string;
  readonly keepWorkspace?: boolean;
  readonly maxRepairAttempts?: number;
  readonly logger?: Logger;
}

export interface FailureDemoStep {
  readonly name: string;
  readonly detail: string;
  readonly failureKind?: FailureKind;
  readonly ok: boolean;
}

export interface FailureDemoResult {
  readonly mode: FailureDemoMode;
  readonly result: RunResult;
  readonly steps: readonly FailureDemoStep[];
  readonly repairAttempts: number;
  readonly evidenceManifest: EvidenceManifest | null;
}

const DELIBERATE_FAILURE = {
  expected: 'Product appears on storefront (active Soft Pink Almond + Rose Gold French; totalItems=2)',
  actual: 'Product set incorrect — inactive Archived Sample leaked / GraphQL totalItems ≠ 2',
} as const;

/**
 * Autonomous debugging demonstration (client recovery process).
 *
 * Deliberate failure:
 *   Expected — active products appear on storefront
 *   Actual   — catalog adapter wrong; storefront/API disagree with acceptance
 *
 * Recoverable path:
 *   Failure → capture logs / preserve failed state → classify → Agent investigates
 *   → inspect code/config → smallest reversible fix → targeted reproducer
 *   → regression / independent validation → PASS|BLOCK (circuit-break repeats)
 *
 * Unrecoverable path: detect unsafe → stop immediately → BLOCK with evidence
 */
export async function runFailureDemo(options: FailureDemoOptions): Promise<FailureDemoResult> {
  const root = options.rootDir ?? mkdtempSync(join(tmpdir(), 'vendure-failure-demo-'));
  const runId = options.runId ?? `failure-${options.mode}-${Date.now()}`;
  const workspaceDir = options.workspaceDir ?? join(root, 'workspace');
  const artifactsDir = options.artifactsDir ?? join(root, 'artifacts');
  const maxRepairAttempts = options.maxRepairAttempts ?? 1;
  const logger = options.logger ?? createLogger({ level: 'info' });
  const steps: FailureDemoStep[] = [];
  let repairAttempts = 0;

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  materializeEvaluationDemo(join(workspaceDir, runId));
  const appDir = join(workspaceDir, runId, 'evaluation-demo', 'app');

  const config: PipelineConfig = {
    mode: 'acceptance',
    artifactsDir,
    workspaceDir,
    maxIdenticalRetries: 2,
    maxTotalAttempts: 2 + maxRepairAttempts,
    allowNetwork: true,
    logLevel: 'info',
    runId,
    writeAllowlist: ['evaluation-demo/app/src', 'evaluation-demo/app/data', '.pipeline'],
    agentMode: 'mock',
    agentTimeoutMs: 180_000,
    openhandsCommand: 'openhands',
    mockAgentBehavior: 'success',
  };

  const context = createExecutionContext({
    config,
    task: buildScenarioTask('http://127.0.0.1:0', options.keepWorkspace === true),
    logger,
  });

  let server: DemoServerHandle | null = null;
  const attempts: AttemptRecord[] = [];
  let lastOutcome: AgentRunOutcome | null = null;

  try {
    if (options.mode === 'unrecoverable') {
      return await runUnrecoverablePath({
        context,
        config,
        agent: new UnrecoverableFailureDemoAgent(),
        attempts,
        steps,
        keepWorkspace: options.keepWorkspace === true,
      });
    }

    server = await startPublicCatalogDemoServer({ appDir });
    const task = buildScenarioTask(server.baseUrl, options.keepWorkspace === true);
    // Refresh context task with live URLs while keeping same workspace/artifacts.
    const liveContext = createExecutionContext({
      config: { ...config, runId },
      task,
      logger,
    });

    const agent = new RecoverableFailureDemoAgent();

    // --- Attempt 1: inject deliberate storefront/catalog failure ---
    lastOutcome = await runAgentSafely(agent, liveContext, attempts);
    steps.push({
      name: 'inject-controlled-failure',
      detail: lastOutcome.summary,
      ok: true,
    });
    steps.push({
      name: 'deliberate-failure',
      detail:
        'Expected: Soft Pink Almond + Rose Gold French on storefront. Actual: buggy adapter leaks inactive products.',
      ok: true,
    });

    // --- Targeted validation (acceptance + GraphQL + storefront) ---
    let targeted = await runTargetedValidation({
      appDir,
      baseUrl: server.baseUrl,
      context: liveContext,
    });
    steps.push({
      name: 'targeted-validation-initial',
      detail: targeted.detail,
      ok: targeted.passed,
      failureKind: targeted.failureKind,
    });

    if (targeted.passed) {
      throw new Error('Controlled bug did not fail targeted validation — demo is invalid');
    }

    // --- Capture logs + preserve failed state (before any repair) ---
    const failedStateDir = preserveFailedState({
      context: liveContext,
      outcome: lastOutcome,
      targeted,
    });
    steps.push({
      name: 'capture-logs',
      detail: `Preserved failed state under ${failedStateDir} (stdout/stderr, targeted checks, catalog snapshot)`,
      ok: true,
      failureKind: targeted.failureKind,
    });

    // --- Classify + repair brief (reversible smallest fix) ---
    const failureKind: FailureKind = 'recoverable_implementation';
    steps.push({
      name: 'classify-failure',
      detail: `Classified as ${failureKind} (recoverable implementation — not unsafe)`,
      failureKind,
      ok: true,
    });

    const retryPolicy = new RetryPolicy({
      maxIdenticalRetries: 2,
      maxTotalAttempts: 2 + maxRepairAttempts,
    });

    while (repairAttempts < maxRepairAttempts && !targeted.passed) {
      repairAttempts += 1;
      const brief: RepairBrief = {
        failureKind: 'recoverable_implementation',
        detectedBy: targeted.failedChecks,
        summary: targeted.detail,
        evidence: targeted.evidence,
        expected:
          'Active products Soft Pink Almond and Rose Gold French appear on storefront; GraphQL totalItems=2',
        actual: targeted.detail,
        reversibleStep:
          'Replace evaluation-demo/app/src/catalog.mjs with the published reference adapter (workspace disposable)',
        instruction:
          'Inspect catalog.mjs / config. Make the smallest fix: keep only active records, omit internalNote, ' +
          'stable SKU order, integer price_cents, slug + image_count. Reuse evaluation-demo reference behavior.',
        attempt: repairAttempts,
        maxRepairAttempts,
      };
      const briefPath = writeRepairBrief(liveContext.workspaceDir, brief);
      steps.push({
        name: 'provide-repair-evidence',
        detail: `Wrote repair brief for agent at ${briefPath}`,
        failureKind: 'recoverable_implementation',
        ok: true,
      });
      steps.push({
        name: 'agent-investigates',
        detail: 'Agent reads repair brief, inspects catalog adapter, chooses reversible reference fix',
        failureKind: 'recoverable_implementation',
        ok: true,
      });

      lastOutcome = await runAgentSafely(agent, liveContext, attempts);
      steps.push({
        name: `bounded-repair-attempt-${repairAttempts}`,
        detail: lastOutcome.summary,
        failureKind: 'recoverable_implementation',
        ok: lastOutcome.failureCode === 'REPAIR_APPLIED',
      });
      steps.push({
        name: 'smallest-fix',
        detail: lastOutcome.summary,
        failureKind: 'recoverable_implementation',
        ok: lastOutcome.failureCode === 'REPAIR_APPLIED',
      });

      targeted = await runTargetedValidation({
        appDir,
        baseUrl: server.baseUrl,
        context: liveContext,
      });
      steps.push({
        name: `targeted-validation-after-repair-${repairAttempts}`,
        detail: targeted.detail,
        ok: targeted.passed,
        failureKind: targeted.failureKind,
      });
      steps.push({
        name: 'run-targeted-reproducer',
        detail: targeted.detail,
        ok: targeted.passed,
        failureKind: targeted.failureKind,
      });

      if (!targeted.passed) {
        const stop = retryPolicy.decide({
          signature: buildFailureSignature({
            failureClass: 'recoverable',
            failureKind: 'recoverable_implementation',
            message: targeted.detail,
            code: 'REPAIR_STILL_FAILING',
          }),
          failureKind: 'recoverable_implementation',
        });
        if (!stop.shouldRetry || repairAttempts >= maxRepairAttempts) {
          steps.push({
            name: 'circuit-break-repeated-failures',
            detail: stop.reason ?? 'Identical recoverable failure budget exhausted',
            failureKind: 'recoverable_implementation',
            ok: false,
          });
          break;
        }
      }
    }

    if (!targeted.passed) {
      return await finalizeDemo({
        mode: 'recoverable',
        context: liveContext,
        task,
        attempts,
        lastOutcome,
        steps,
        repairAttempts,
        status: 'BLOCK',
        notes: [
          'Bounded repair exhausted; targeted validation still failing',
          targeted.detail,
          'Independent broader validation skipped because targeted gate failed',
          'Circuit-break: repeated identical failures stopped',
        ],
        validationChecks: targeted.checks,
        keepWorkspace: options.keepWorkspace === true,
        deliberateFailure: DELIBERATE_FAILURE,
        failedStateDir,
      });
    }

    // --- Broader independent validation (regression) ---
    const broader = await runBroaderValidation({
      context: liveContext,
      task,
      changedFiles: lastOutcome?.changedFiles ?? [],
      testExitCode: 0,
    });
    steps.push({
      name: 'broader-validation',
      detail: broader.detail,
      ok: broader.passed,
    });
    steps.push({
      name: 'run-regression-independent-validation',
      detail: broader.detail,
      ok: broader.passed,
    });

    return await finalizeDemo({
      mode: 'recoverable',
      context: liveContext,
      task,
      attempts,
      lastOutcome,
      steps,
      repairAttempts,
      status: broader.passed ? 'PASS' : 'BLOCK',
      notes: [
        ...broader.notes,
        `Repair attempts used: ${repairAttempts}/${maxRepairAttempts}`,
        'Agent claimed success ignored; broader independent validator decides PASS/BLOCK',
      ],
      validationChecks: broader.checks,
      keepWorkspace: options.keepWorkspace === true,
      deliberateFailure: DELIBERATE_FAILURE,
      failedStateDir,
    });
  } finally {
    if (server) {
      await server.close().catch(() => undefined);
    }
  }
}

async function runUnrecoverablePath(input: {
  readonly context: ExecutionContext;
  readonly config: PipelineConfig;
  readonly agent: AgentAdapter;
  readonly attempts: AttemptRecord[];
  readonly steps: FailureDemoStep[];
  readonly keepWorkspace: boolean;
}): Promise<FailureDemoResult> {
  const { context, agent, attempts, steps, keepWorkspace } = input;
  let lastOutcome: AgentRunOutcome | null = null;

  try {
    lastOutcome = await runAgentSafely(agent, context, attempts);
    steps.push({
      name: 'inject-unrecoverable-failure',
      detail: lastOutcome.summary,
      failureKind: 'unsafe_unknown',
      ok: false,
    });
    // If safety did not throw (should have on stdout), classify and stop.
    const classifyInput: Parameters<typeof classifyFailure>[0] = {
      failureClass: lastOutcome.failureClass,
      message: lastOutcome.summary,
    };
    if (lastOutcome.failureCode !== undefined) {
      (classifyInput as { failureCode: string }).failureCode = lastOutcome.failureCode;
    }
    const kind = classifyFailure(classifyInput);
    steps.push({
      name: 'classify-failure',
      detail: `Classified as ${kind}`,
      failureKind: kind,
      ok: true,
    });
    steps.push({
      name: 'refuse-repair',
      detail: 'Unsafe/unknown failures must not enter a repair loop',
      failureKind: kind,
      ok: true,
    });

    const task = {
      ...context.task,
      cleanupWorkspace: !keepWorkspace,
    };

    return await finalizeDemo({
      mode: 'unrecoverable',
      context,
      task,
      attempts,
      lastOutcome,
      steps,
      repairAttempts: 0,
      status: 'BLOCK',
      notes: [
        'Unrecoverable failure demonstration',
        lastOutcome.summary,
        'Pipeline stopped without repair; evidence retained',
      ],
      validationChecks: [],
      keepWorkspace,
    });
  } catch (error) {
    if (error instanceof SafetyError) {
      steps.push({
        name: 'detect-unsafe-failure',
        detail: error.message,
        failureKind: 'unsafe_unknown',
        ok: true,
      });
      steps.push({
        name: 'classify-failure',
        detail: 'unsafe_unknown (safety kernel)',
        failureKind: 'unsafe_unknown',
        ok: true,
      });
      steps.push({
        name: 'stop-without-repair',
        detail: 'Circuit opened; no Agent repair attempt for unsafe failures',
        failureKind: 'unsafe_unknown',
        ok: true,
      });

      const finishedAt = new Date().toISOString();
      attempts.push({
        attempt: attempts.length + 1,
        startedAt: context.startedAt,
        finishedAt,
        failureClass: 'non_recoverable',
        failureKind: 'unsafe_unknown',
        signature: buildFailureSignature({
          failureClass: 'non_recoverable',
          failureKind: 'unsafe_unknown',
          message: error.message,
          code: error.code,
        }),
        message: error.message,
        agentClaimedSuccess: false,
      });

      return await finalizeDemo({
        mode: 'unrecoverable',
        context,
        task: { ...context.task, cleanupWorkspace: !keepWorkspace },
        attempts,
        lastOutcome,
        steps,
        repairAttempts: 0,
        status: 'BLOCK',
        notes: [
          error.message,
          'Safe-stop: unrecoverable failure — BLOCK with evidence',
          'No repair loop executed',
        ],
        validationChecks: [],
        keepWorkspace,
      });
    }
    throw error;
  }
}

async function runAgentSafely(
  agent: AgentAdapter,
  context: ExecutionContext,
  attempts: AttemptRecord[],
): Promise<AgentRunOutcome> {
  const startedAt = new Date().toISOString();
  const outcome = await agent.run(context);
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

  const failureKind = classifyFailure({
    failureClass: outcome.failureClass,
    ...(outcome.failureCode !== undefined ? { failureCode: outcome.failureCode } : {}),
    message: outcome.summary || outcome.stderr,
  });
  const finishedAt = new Date().toISOString();
  attempts.push({
    attempt: attempts.length + 1,
    startedAt,
    finishedAt,
    failureClass: outcome.failureClass,
    failureKind,
    signature: buildFailureSignature({
      failureClass: outcome.failureClass,
      failureKind,
      message: outcome.summary || outcome.stderr || 'agent',
      ...(outcome.failureCode !== undefined ? { code: outcome.failureCode } : {}),
    }),
    message: outcome.summary || outcome.stderr || 'agent',
    agentClaimedSuccess: outcome.claimedSuccess,
  });
  return outcome;
}

async function runTargetedValidation(input: {
  readonly appDir: string;
  readonly baseUrl: string;
  readonly context: ExecutionContext;
}): Promise<{
  readonly passed: boolean;
  readonly detail: string;
  readonly failureKind: FailureKind;
  readonly failedChecks: string[];
  readonly checks: ValidationCheckResult[];
  readonly evidence: Record<string, unknown>;
}> {
  const testExitCode = runAcceptanceTests(input.appDir);
  const gql = await fetch(`${input.baseUrl}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ products { totalItems } }' }),
  });
  const gqlJson = (await gql.json()) as {
    data?: { products?: { totalItems?: number } };
    errors?: unknown[];
  };
  const totalItems = gqlJson.data?.products?.totalItems;
  const gqlOk = totalItems === 2 && !gqlJson.errors?.length;
  const testsOk = testExitCode === 0;

  const storefrontHtml = await (await fetch(`${input.baseUrl}/`)).text();
  const hasSoftPink = storefrontHtml.includes('Soft Pink Almond');
  const hasRoseGold = storefrontHtml.includes('Rose Gold French');
  const hasArchived = storefrontHtml.includes('Archived Sample');
  const storefrontOk = hasSoftPink && hasRoseGold && !hasArchived;

  const failedChecks: string[] = [];
  if (!testsOk) {
    failedChecks.push('acceptance-tests');
  }
  if (!gqlOk) {
    failedChecks.push('graphql-products');
  }
  if (!storefrontOk) {
    failedChecks.push('storefront-products');
  }

  const passed = failedChecks.length === 0;
  const detail = passed
    ? 'Targeted validation passed (acceptance + GraphQL totalItems=2 + storefront active products)'
    : `Targeted validation failed: ${failedChecks.join(', ')} (tests=${testExitCode}, totalItems=${String(totalItems)}, storefront archivedLeak=${String(hasArchived)})`;

  const timestamp = new Date().toISOString();
  const checks: ValidationCheckResult[] = [
    {
      checkName: 'acceptance-tests',
      status: testsOk ? 'PASS' : 'FAIL',
      expected: 'Acceptance tests exit 0',
      actual: `exit=${testExitCode}`,
      timestamp,
      output: detail,
      evidencePath: join(input.context.artifactDir, 'validation', 'targeted-acceptance.json'),
    },
    {
      checkName: 'graphql-products',
      status: gqlOk ? 'PASS' : 'FAIL',
      expected: 'products.totalItems === 2',
      actual: `totalItems=${String(totalItems)}`,
      timestamp,
      output: JSON.stringify(gqlJson),
      evidencePath: join(input.context.artifactDir, 'validation', 'targeted-graphql.json'),
    },
    {
      checkName: 'storefront-products',
      status: storefrontOk ? 'PASS' : 'FAIL',
      expected: 'Soft Pink Almond + Rose Gold French present; Archived Sample absent',
      actual: `softPink=${String(hasSoftPink)} roseGold=${String(hasRoseGold)} archived=${String(hasArchived)}`,
      timestamp,
      output: storefrontHtml.slice(0, 2000),
      evidencePath: join(input.context.artifactDir, 'validation', 'targeted-storefront.json'),
    },
  ];

  mkdirSync(join(input.context.artifactDir, 'validation'), { recursive: true });
  writeFileSync(
    join(input.context.artifactDir, 'validation', 'targeted-acceptance.json'),
    `${JSON.stringify(checks[0], null, 2)}\n`,
  );
  writeFileSync(
    join(input.context.artifactDir, 'validation', 'targeted-graphql.json'),
    `${JSON.stringify(checks[1], null, 2)}\n`,
  );
  writeFileSync(
    join(input.context.artifactDir, 'validation', 'targeted-storefront.json'),
    `${JSON.stringify(checks[2], null, 2)}\n`,
  );

  return {
    passed,
    detail,
    failureKind: passed
      ? 'recoverable_implementation'
      : classifyFailure({
          isValidationFailure: false,
          failureClass: 'recoverable',
          failureCode: 'MOCK_RETRYABLE',
          message: detail,
        }),
    failedChecks,
    checks,
    evidence: {
      testExitCode,
      graphql: gqlJson,
      storefront: {
        hasSoftPink,
        hasRoseGold,
        hasArchived,
      },
      failedChecks,
      expected: DELIBERATE_FAILURE.expected,
      actual: DELIBERATE_FAILURE.actual,
    },
  };
}

async function runBroaderValidation(input: {
  readonly context: ExecutionContext;
  readonly task: TaskDefinition;
  readonly changedFiles: readonly string[];
  readonly testExitCode: number;
}): Promise<{
  readonly passed: boolean;
  readonly detail: string;
  readonly notes: readonly string[];
  readonly checks: readonly ValidationCheckResult[];
}> {
  const evidence = new FileEvidenceCollector();
  const present = await evidence.writeBundle({
    context: input.context,
    status: 'BLOCK',
    attempts: [],
    stdout: '',
    stderr: '',
    diff: '',
    changeSummary: input.changedFiles.map((file) => `- ${file}`).join('\n') || 'n/a',
    rollback: 'Discard disposable workspace; retain evidence under runs/<runId>.',
    summary: '# Failure demo broader validation\n',
    networkUsed: true,
    secretsUsed: false,
    maxIdenticalRetries: 2,
    finishedAt: new Date().toISOString(),
  });

  const validator = new IndependentValidator({
    allowNetwork: true,
    launchBrowser: createFakeBrowserLauncher({
      title: 'Public Catalog Demo',
      textBySelector: {
        h1: 'Products',
        '#product-list': 'Soft Pink Almond, Rose Gold French',
      },
    }),
  });

  // Use live task with real validation steps (URLs already bound).
  const liveContext = {
    ...input.context,
    task: input.task,
  };

  const decision = await validator.validate({
    context: liveContext,
    mode: 'acceptance',
    agentClaimedSuccess: true,
    requiredEvidence: input.task.requiredEvidence,
    presentEvidence: present,
    testExitCode: input.testExitCode,
    changedFiles: input.changedFiles,
  });

  return {
    passed: decision.status === 'PASS',
    detail: `Broader validator status=${decision.status}`,
    notes: decision.notes,
    checks: decision.checks ?? [],
  };
}

async function finalizeDemo(input: {
  readonly mode: FailureDemoMode;
  readonly context: ExecutionContext;
  readonly task: TaskDefinition;
  readonly attempts: AttemptRecord[];
  readonly lastOutcome: AgentRunOutcome | null;
  readonly steps: FailureDemoStep[];
  readonly repairAttempts: number;
  readonly status: 'PASS' | 'BLOCK';
  readonly notes: readonly string[];
  readonly validationChecks: readonly ValidationCheckResult[];
  readonly keepWorkspace: boolean;
  readonly deliberateFailure?: { readonly expected: string; readonly actual: string };
  readonly failedStateDir?: string;
}): Promise<FailureDemoResult> {
  const finishedAt = new Date().toISOString();
  const evidence = new FileEvidenceCollector();
  await evidence.writeBundle({
    context: input.context,
    status: input.status,
    attempts: input.attempts,
    stdout: input.lastOutcome?.stdout ?? '',
    stderr: input.lastOutcome?.stderr ?? '',
    diff: input.lastOutcome?.diff ?? '',
    changeSummary: (input.lastOutcome?.changedFiles ?? []).map((f) => `- ${f}`).join('\n') || 'n/a',
    rollback: 'Discard disposable workspace; retain runs/<runId> evidence including failed-state/.',
    summary: [
      `# Autonomous debugging demo (${input.mode})`,
      '',
      `- Status: ${input.status}`,
      `- Repair attempts: ${input.repairAttempts}`,
      ...(input.deliberateFailure
        ? [
            `- Expected: ${input.deliberateFailure.expected}`,
            `- Actual: ${input.deliberateFailure.actual}`,
          ]
        : []),
      ...input.steps.map((step) => `- ${step.name}: ${step.ok ? 'ok' : 'fail'} — ${step.detail}`),
      ...input.notes.map((note) => `- Note: ${note}`),
    ].join('\n'),
    networkUsed: input.mode === 'recoverable',
    secretsUsed: false,
    maxIdenticalRetries: 2,
    finishedAt,
  });

  writeFileSync(
    join(input.context.artifactDir, 'failure-demo.json'),
    `${JSON.stringify(
      {
        mode: input.mode,
        status: input.status,
        repairAttempts: input.repairAttempts,
        deliberateFailure: input.deliberateFailure ?? null,
        failedStateDir: input.failedStateDir ?? null,
        recoveryProcess: [
          'Failure',
          'Capture logs / preserve failed state',
          'Classify failure',
          'Agent investigates',
          'Inspect code/config',
          'Make smallest reversible fix',
          'Run targeted reproducer',
          'Run regression / independent validation',
          'Circuit-break repeated failures',
        ],
        steps: input.steps,
        notes: input.notes,
      },
      null,
      2,
    )}\n`,
  );

  const result: RunResult = {
    runId: input.context.runId,
    mode: input.context.mode,
    status: input.status,
    taskId: input.task.id,
    startedAt: input.context.startedAt,
    finishedAt,
    artifactDir: input.context.artifactDir,
    attempts: input.attempts,
    validatorNotes: input.notes,
    agentSummary: input.lastOutcome?.summary ?? null,
    exitCode: input.status === 'PASS' ? 0 : 1,
    changedFiles: input.lastOutcome?.changedFiles ?? [],
    validationSteps: [],
    validationChecks: [...input.validationChecks],
    report: null,
    workspaceCleaned: false,
    evidenceManifest: null,
  };

  const evidenceManifest = finalizeEvidencePack({
    runDir: input.context.artifactDir,
    task: input.task,
    result,
  });

  return {
    mode: input.mode,
    result: { ...result, evidenceManifest },
    steps: input.steps,
    repairAttempts: input.repairAttempts,
    evidenceManifest,
  };
}

/**
 * Preserve the failed workspace/validation snapshot before any repair mutates code.
 * Satisfies the client recovery requirement to keep the failed state for investigation.
 */
function preserveFailedState(input: {
  readonly context: ExecutionContext;
  readonly outcome: AgentRunOutcome | null;
  readonly targeted: {
    readonly detail: string;
    readonly failedChecks: readonly string[];
    readonly evidence: Record<string, unknown>;
    readonly checks: readonly ValidationCheckResult[];
  };
}): string {
  const failedStateDir = join(input.context.artifactDir, 'failed-state');
  mkdirSync(failedStateDir, { recursive: true });
  writeFileSync(
    join(failedStateDir, 'agent-stdout.log'),
    `${input.outcome?.stdout ?? ''}\n`,
    'utf8',
  );
  writeFileSync(
    join(failedStateDir, 'agent-stderr.log'),
    `${input.outcome?.stderr ?? ''}\n`,
    'utf8',
  );
  writeFileSync(
    join(failedStateDir, 'failure-snapshot.json'),
    `${JSON.stringify(
      {
        preservedAt: new Date().toISOString(),
        deliberateFailure: DELIBERATE_FAILURE,
        detail: input.targeted.detail,
        failedChecks: input.targeted.failedChecks,
        evidence: input.targeted.evidence,
        checks: input.targeted.checks,
        agentSummary: input.outcome?.summary ?? null,
        changedFiles: input.outcome?.changedFiles ?? [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const catalogSrc = join(
    input.context.workspaceDir,
    'evaluation-demo',
    'app',
    'src',
    'catalog.mjs',
  );
  if (existsSync(catalogSrc)) {
    copyFileSync(catalogSrc, join(failedStateDir, 'catalog.mjs.failed'));
  }
  return failedStateDir;
}
