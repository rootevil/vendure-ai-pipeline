import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';

import type {
  AttemptRecord,
  EvidenceManifest,
  EvidenceManifestEntry,
  RunResult,
  RunStatus,
  TaskDefinition,
  ValidationCheckResult,
} from '../models/types.js';
import { MAX_RETRIES } from '../retry/classified-policy.js';
import { buildValidatorVerdict, writeValidatorVerdict } from '../validator/verdict.js';

export interface FinalizeEvidencePackInput {
  readonly runDir: string;
  readonly task: TaskDefinition;
  readonly result: Pick<
    RunResult,
    | 'runId'
    | 'status'
    | 'exitCode'
    | 'startedAt'
    | 'finishedAt'
    | 'mode'
    | 'taskId'
    | 'attempts'
    | 'validatorNotes'
    | 'agentSummary'
    | 'changedFiles'
    | 'validationChecks'
    | 'validationSteps'
  >;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly diff?: string;
  readonly testExitCode?: number | null;
  /** Optional technical scenario payload (compiler output). */
  readonly scenario?: unknown;
  readonly now?: () => Date;
}

const CLIENT_DIRS = [
  'api',
  'graphql',
  'screenshots',
  'playwright',
  'database',
  'api-responses',
  'validation',
] as const;

/**
 * Writes the reviewable evidence pack under runs/<runId>/ (or configured artifacts root).
 * Client delivery layout:
 *
 *   task.json, scenario.json, execution.log, agent.log, git-diff.patch,
 *   validation.json, api/, graphql/, screenshots/, playwright/, database/,
 *   recovery.json, rollback.md, final-report.html
 *
 * Compatibility aliases (result.json, summary.html, git.diff, api-responses/, …) remain.
 */
export function finalizeEvidencePack(input: FinalizeEvidencePackInput): EvidenceManifest {
  const nowFn = input.now ?? (() => new Date());
  const generatedAt = nowFn().toISOString();
  const runDir = input.runDir;
  mkdirSync(runDir, { recursive: true });
  for (const dir of CLIENT_DIRS) {
    mkdirSync(join(runDir, dir), { recursive: true });
  }

  writeJson(join(runDir, 'task.json'), input.task);
  writeScenarioJson(runDir, input);

  const resultPayload = {
    runId: input.result.runId,
    taskId: input.result.taskId,
    mode: input.result.mode,
    status: input.result.status,
    exitCode: input.result.exitCode,
    startedAt: input.result.startedAt,
    finishedAt: input.result.finishedAt,
    agentSummary: input.result.agentSummary,
    agentClaimedSuccessIgnored: true,
    verdictBasis:
      input.result.status === 'PASS'
        ? 'Independent validator: all checks passed. Agent claimed success was ignored.'
        : input.result.status === 'BLOCK'
          ? 'Independent validator: one or more checks failed or required evidence was missing. Agent claimed success was ignored.'
          : `Pipeline finished with status ${input.result.status}.`,
    validatorNotes: input.result.validatorNotes,
    changedFiles: input.result.changedFiles,
    attempts: input.result.attempts,
    failedChecks: input.result.validationChecks
      .filter((check) => check.status !== 'PASS')
      .map((check) => ({
        checkName: check.checkName,
        status: check.status,
        expected: check.expected,
        actual: check.actual,
        evidencePath: relativePath(runDir, check.evidencePath),
      })),
    passedChecks: input.result.validationChecks
      .filter((check) => check.status === 'PASS')
      .map((check) => check.checkName),
  };
  writeJson(join(runDir, 'result.json'), resultPayload);

  const validationPayload = {
    runId: input.result.runId,
    status: input.result.status,
    checks: input.result.validationChecks,
    steps: input.result.validationSteps,
  };
  writeJson(join(runDir, 'validation.json'), validationPayload);
  writeJson(join(runDir, 'validation-results.json'), input.result.validationChecks);

  const lastClaimed = input.result.attempts.at(-1)?.agentClaimedSuccess ?? false;
  writeValidatorVerdict(
    runDir,
    buildValidatorVerdict({
      status: input.result.status,
      checks: input.result.validationChecks,
      agentClaimedSuccess: lastClaimed,
      notes: input.result.validatorNotes,
    }),
  );

  const stdout = input.stdout ?? readIfExists(join(runDir, 'stdout.log'));
  const stderr = input.stderr ?? readIfExists(join(runDir, 'stderr.log'));
  const executionLog = [
    `# Execution log for run ${input.result.runId}`,
    `Started: ${input.result.startedAt}`,
    `Finished: ${input.result.finishedAt}`,
    `Status: ${input.result.status}`,
    '',
    '## Attempts',
    ...input.result.attempts.map(
      (attempt) =>
        `- #${attempt.attempt} ${attempt.failureKind}/${attempt.failureClass} claimedSuccess=${String(attempt.agentClaimedSuccess)} — ${attempt.message}`,
    ),
    '',
    '## stdout',
    stdout || '(empty)',
    '',
    '## stderr',
    stderr || '(empty)',
    '',
  ].join('\n');
  writeText(join(runDir, 'execution.log'), executionLog);
  writeText(join(runDir, 'agent.log'), buildAgentLog(input.result.attempts, stdout, stderr));

  const diff = input.diff ?? readIfExists(join(runDir, 'diff.patch'));
  const diffBody = diff.length > 0 ? diff : 'No git diff captured for this run.\n';
  writeText(join(runDir, 'git.diff'), diffBody);
  writeText(join(runDir, 'git-diff.patch'), diffBody);
  if (!existsSync(join(runDir, 'diff.patch'))) {
    writeText(join(runDir, 'diff.patch'), diff);
  }

  const testExitCode = input.testExitCode ?? null;
  writeJson(join(runDir, 'test-results.json'), {
    runId: input.result.runId,
    testExitCode,
    acceptanceTests:
      input.result.validationChecks.find((check) => check.checkName === 'acceptance-tests') ?? null,
    note:
      testExitCode === null
        ? 'No separate test runner was attached to this pipeline run.'
        : `Test runner exited with code ${testExitCode}.`,
  });

  collectApiResponses(runDir, input.result.validationChecks);
  collectScreenshots(runDir);
  organizeClientEvidenceDirs(runDir, input.result.validationChecks);

  const rollback =
    readIfExists(join(runDir, 'rollback.md')) ||
    'Rollback: discard the disposable workspace for this runId and retain only this evidence directory. Do not mutate client main.\n';
  writeText(join(runDir, 'rollback.md'), rollback);

  const recovery = buildRecoveryJson(input, rollback);
  writeJson(join(runDir, 'recovery.json'), recovery);

  const finalReport = renderFinalReportHtml(input, resultPayload, recovery);
  writeText(join(runDir, 'final-report.html'), finalReport);
  writeText(join(runDir, 'summary.html'), finalReport);

  writeJson(join(runDir, 'status.json'), {
    status: input.result.status,
    run_id: input.result.runId,
    exit_code: input.result.exitCode,
  });
  if (!existsSync(join(runDir, 'summary.md'))) {
    writeText(
      join(runDir, 'summary.md'),
      [
        `# Run Summary`,
        '',
        `- Status: \`${input.result.status}\``,
        `- Run ID: \`${input.result.runId}\``,
        `- See final-report.html and result.json for the full verdict basis.`,
        '',
      ].join('\n'),
    );
  }

  const manifest = buildEvidenceManifest({
    runDir,
    runId: input.result.runId,
    status: input.result.status,
    generatedAt,
  });
  writeJson(join(runDir, 'evidence-manifest.json'), manifest);
  return manifest;
}

function writeScenarioJson(runDir: string, input: FinalizeEvidencePackInput): void {
  if (input.scenario !== undefined) {
    writeJson(join(runDir, 'scenario.json'), input.scenario);
    return;
  }
  if (existsSync(join(runDir, 'scenario.json'))) {
    return;
  }
  writeJson(join(runDir, 'scenario.json'), {
    taskId: input.task.id,
    title: input.task.title,
    goal: input.task.goal,
    mode: input.task.mode,
    acceptanceCriteria: input.task.acceptanceCriteria,
    stages: input.task.stages,
    validationSteps: input.task.validationSteps.map((step) => ({
      id: step.id,
      type: step.type,
    })),
    allowedTools: input.task.allowedTools,
    timeoutMs: input.task.timeoutMs,
    retryPolicy: input.task.retryPolicy,
  });
}

function buildAgentLog(
  attempts: readonly AttemptRecord[],
  stdout: string,
  stderr: string,
): string {
  return [
    '# Agent log',
    '',
    '## Attempt timeline',
    ...attempts.map(
      (attempt) =>
        `- #${attempt.attempt} [${attempt.startedAt} → ${attempt.finishedAt}] ${attempt.failureKind}/${attempt.failureClass} claimedSuccess=${String(attempt.agentClaimedSuccess)} — ${attempt.message}`,
    ),
    '',
    '## Agent stdout',
    stdout || '(empty)',
    '',
    '## Agent stderr',
    stderr || '(empty)',
    '',
  ].join('\n');
}

function buildRecoveryJson(
  input: FinalizeEvidencePackInput,
  rollback: string,
): {
  readonly retriesPerformed: boolean;
  readonly attemptCount: number;
  readonly maxRetries: number;
  readonly circuitBreak: boolean;
  readonly reason: string;
  readonly rollbackNeeded: boolean;
  readonly rollback: string;
  readonly attempts: readonly AttemptRecord[];
} {
  const attemptCount = input.result.attempts.length;
  const retriesPerformed = attemptCount > 1;
  const circuitBreak =
    input.result.status === 'BLOCK' &&
    input.result.attempts.some((a) => a.failureKind === 'repeated');
  const whyParts: string[] = [];
  if (!retriesPerformed) {
    whyParts.push('No retry — single attempt or immediate stop.');
  } else {
    whyParts.push(
      `${attemptCount - 1} retry(ies) within MAX_RETRIES=${MAX_RETRIES} (classified disposition; no unbounded loop).`,
    );
  }
  if (circuitBreak) {
    whyParts.push('Same failure reached the circuit-break threshold.');
  }
  if (input.result.status === 'AUTH_REQUIRED') {
    whyParts.push('Missing credential — AUTH_REQUIRED (no retry).');
  }
  if (input.result.status === 'CLIENT_DECISION') {
    whyParts.push('Business ambiguity — CLIENT_DECISION (no retry).');
  }
  const rollbackNeeded =
    input.result.changedFiles.length > 0 ||
    input.result.status === 'BLOCK' ||
    input.result.status === 'ERROR';

  return {
    retriesPerformed,
    attemptCount,
    maxRetries: MAX_RETRIES,
    circuitBreak,
    reason: whyParts.join(' '),
    rollbackNeeded,
    rollback: rollback.trim(),
    attempts: input.result.attempts,
  };
}

function collectApiResponses(runDir: string, checks: readonly ValidationCheckResult[]): void {
  const apiDir = join(runDir, 'api-responses');
  mkdirSync(apiDir, { recursive: true });
  for (const check of checks) {
    const name = check.checkName;
    if (!existsSync(check.evidencePath)) {
      continue;
    }
    if (
      name.includes('health') ||
      name.includes('api') ||
      name.includes('gql') ||
      name.includes('http') ||
      name.includes('graphql') ||
      name.includes('database') ||
      name.includes('order')
    ) {
      const target = join(apiDir, `${name}.json`);
      if (!existsSync(target)) {
        copyFileSync(check.evidencePath, target);
      }
    }
  }
}

function collectScreenshots(runDir: string): void {
  const shotDir = join(runDir, 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  const validationDir = join(runDir, 'validation');
  if (!existsSync(validationDir)) {
    return;
  }
  for (const name of readdirSync(validationDir)) {
    if (!/\.(png|jpe?g|webp)$/i.test(name)) {
      continue;
    }
    const source = join(validationDir, name);
    const target = join(shotDir, name);
    if (!existsSync(target)) {
      copyFileSync(source, target);
    }
  }
}

/**
 * Populate client-facing api/, graphql/, playwright/, database/ from validation evidence.
 */
function organizeClientEvidenceDirs(
  runDir: string,
  checks: readonly ValidationCheckResult[],
): void {
  for (const check of checks) {
    if (!existsSync(check.evidencePath)) {
      continue;
    }
    const name = check.checkName.toLowerCase();
    let bucket: 'api' | 'graphql' | 'database' | 'playwright' | null = null;
    if (name.includes('graphql') || name.includes('gql')) {
      bucket = 'graphql';
    } else if (name.includes('database') || name.includes('postgres') || name.includes('sql')) {
      bucket = 'database';
    } else if (
      name.includes('playwright') ||
      name.includes('browser') ||
      name.includes('journey')
    ) {
      bucket = 'playwright';
    } else if (
      name.includes('health') ||
      name.includes('api') ||
      name.includes('http') ||
      name.includes('order')
    ) {
      bucket = 'api';
    }
    if (!bucket) {
      continue;
    }
    const target = join(runDir, bucket, `${check.checkName}.json`);
    if (!existsSync(target)) {
      copyFileSync(check.evidencePath, target);
    }
  }

  // Playwright results file at run root → playwright/
  const playwrightRoot = join(runDir, 'playwright-results.json');
  if (existsSync(playwrightRoot)) {
    const target = join(runDir, 'playwright', 'playwright-results.json');
    if (!existsSync(target)) {
      copyFileSync(playwrightRoot, target);
    }
  }

  // Mirror api-responses into typed buckets when not already classified by check name.
  const apiResponses = join(runDir, 'api-responses');
  if (existsSync(apiResponses)) {
    for (const name of readdirSync(apiResponses)) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const lower = name.toLowerCase();
      let bucket: 'api' | 'graphql' | 'database' = 'api';
      if (lower.includes('graphql') || lower.includes('gql')) {
        bucket = 'graphql';
      } else if (lower.includes('database') || lower.includes('sql')) {
        bucket = 'database';
      }
      const target = join(runDir, bucket, name);
      if (!existsSync(target)) {
        copyFileSync(join(apiResponses, name), target);
      }
    }
  }

  // Ensure each client dir has a README so empty trees are reviewable.
  for (const dir of ['api', 'graphql', 'playwright', 'database'] as const) {
    const readme = join(runDir, dir, 'README.md');
    if (!existsSync(readme) && readdirSync(join(runDir, dir)).length === 0) {
      writeText(
        readme,
        `# ${dir}/\n\nNo ${dir} evidence was produced for this run (checks of this type did not run or left no payload).\n`,
      );
    }
  }
}

function buildEvidenceManifest(input: {
  readonly runDir: string;
  readonly runId: string;
  readonly status: RunStatus;
  readonly generatedAt: string;
}): EvidenceManifest {
  const catalog: Array<{ path: string; type: EvidenceManifestEntry['type']; description: string }> =
    [
      {
        path: 'task.json',
        type: 'task',
        description: 'Exact task definition executed for this run',
      },
      {
        path: 'scenario.json',
        type: 'other',
        description: 'Technical scenario / validation plan for this run',
      },
      {
        path: 'execution.log',
        type: 'log',
        description: 'Attempt timeline plus captured stdout/stderr',
      },
      {
        path: 'agent.log',
        type: 'log',
        description: 'Agent attempt timeline and agent stdout/stderr',
      },
      {
        path: 'git-diff.patch',
        type: 'diff',
        description: 'Git diff / patch of agent workspace changes (client name)',
      },
      {
        path: 'validation.json',
        type: 'validation',
        description: 'Independent validator checks with expected vs actual results',
      },
      {
        path: 'api/',
        type: 'api_response',
        description: 'HTTP/REST API evidence payloads',
      },
      {
        path: 'graphql/',
        type: 'api_response',
        description: 'GraphQL Shop/Admin API evidence payloads',
      },
      {
        path: 'screenshots/',
        type: 'screenshot',
        description: 'Browser validation screenshots',
      },
      {
        path: 'playwright/',
        type: 'validation',
        description: 'Playwright journey results and related evidence',
      },
      {
        path: 'database/',
        type: 'validation',
        description: 'Controlled database query evidence (expected vs actual)',
      },
      {
        path: 'recovery.json',
        type: 'other',
        description: 'Retry / circuit-break / rollback summary for this run',
      },
      {
        path: 'rollback.md',
        type: 'rollback',
        description: 'Rollback instructions for discarding the disposable workspace',
      },
      {
        path: 'final-report.html',
        type: 'summary',
        description:
          'Human-readable final report answering what was requested, done, tested, and the result',
      },
      {
        path: 'result.json',
        type: 'result',
        description: 'Final PASS/BLOCK verdict with notes and failed/passed check summary',
      },
      {
        path: 'validator-verdict.json',
        type: 'validation',
        description:
          'Client verdict { status, checks[{name,status}] }; PASS/BLOCK from evidence only',
      },
      {
        path: 'summary.html',
        type: 'summary',
        description: 'Alias of final-report.html (compatibility)',
      },
      {
        path: 'git.diff',
        type: 'diff',
        description: 'Alias of git-diff.patch (compatibility)',
      },
      {
        path: 'evidence-manifest.json',
        type: 'manifest',
        description: 'Catalog of evidence files with types and descriptions',
      },
      {
        path: 'api-responses/',
        type: 'api_response',
        description: 'Compatibility mirror of network check payloads',
      },
    ];

  const entries: EvidenceManifestEntry[] = catalog.map((item) => ({
    path: item.path,
    type: item.type,
    description: item.description,
    present:
      item.path === 'evidence-manifest.json'
        ? true
        : existsSync(join(input.runDir, item.path.replace(/\/$/, ''))),
  }));

  for (const dirName of [
    'screenshots',
    'api-responses',
    'api',
    'graphql',
    'playwright',
    'database',
  ] as const) {
    const dir = join(input.runDir, dirName);
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (name === 'README.md') {
        continue;
      }
      const rel = `${dirName}/${name}`;
      if (entries.some((entry) => entry.path === rel)) {
        continue;
      }
      const type: EvidenceManifestEntry['type'] =
        dirName === 'screenshots'
          ? 'screenshot'
          : dirName === 'database' || dirName === 'playwright'
            ? 'validation'
            : 'api_response';
      entries.push({
        path: rel,
        type,
        description: `Evidence artifact ${name}`,
        present: true,
      });
    }
  }

  return {
    runId: input.runId,
    status: input.status,
    generatedAt: input.generatedAt,
    runDirectory: input.runDir,
    entries,
  };
}

function renderFinalReportHtml(
  input: FinalizeEvidencePackInput,
  resultPayload: {
    readonly status: RunStatus;
    readonly verdictBasis: string;
    readonly failedChecks: readonly {
      readonly checkName: string;
      readonly status: string;
      readonly expected: string;
      readonly actual: string;
    }[];
    readonly passedChecks: readonly string[];
    readonly validatorNotes: readonly string[];
  },
  recovery: {
    readonly retriesPerformed: boolean;
    readonly attemptCount: number;
    readonly maxRetries: number;
    readonly circuitBreak: boolean;
    readonly reason: string;
    readonly rollbackNeeded: boolean;
    readonly rollback: string;
  },
): string {
  const task = input.task;
  const statusClass = input.result.status === 'PASS' ? 'pass' : 'block';
  const agentSummaryText = input.result.agentSummary ?? '';
  const whatAgentDid =
    agentSummaryText.trim().length > 0
      ? agentSummaryText
      : input.result.attempts.length === 0
        ? 'No agent attempt was recorded.'
        : input.result.attempts
            .map(
              (a) =>
                `Attempt #${a.attempt}: ${a.message} (claimedSuccess=${String(a.agentClaimedSuccess)}, ${a.failureKind})`,
            )
            .join('\n');

  const whatChanged =
    input.result.changedFiles.length > 0
      ? input.result.changedFiles.map((f) => `- ${f}`).join('\n')
      : 'No files changed by the agent.';

  const whatTested =
    input.result.validationChecks.length > 0
      ? input.result.validationChecks
          .map((c) => `- ${c.checkName} → ${c.status} (expected: ${c.expected}; actual: ${c.actual})`)
          .join('\n')
      : 'No independent validation checks were recorded.';

  const whatPassed =
    resultPayload.passedChecks.length > 0
      ? resultPayload.passedChecks.map((n) => `- ${n}`).join('\n')
      : '(none)';

  const whatFailed =
    resultPayload.failedChecks.length > 0
      ? resultPayload.failedChecks
          .map((c) => `- ${c.checkName} [${c.status}]: expected ${c.expected}; actual ${c.actual}`)
          .join('\n')
      : '(none)';

  const retryAnswer = recovery.retriesPerformed
    ? `Yes — ${recovery.attemptCount} attempt(s) (MAX_RETRIES=${recovery.maxRetries}).${recovery.circuitBreak ? ' Circuit break opened.' : ''}`
    : 'No — a single attempt, or an immediate non-retryable stop.';

  const failedRows =
    resultPayload.failedChecks.length > 0
      ? resultPayload.failedChecks
          .map(
            (check) =>
              `<tr><td>${escapeHtml(check.checkName)}</td><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.expected)}</td><td>${escapeHtml(check.actual)}</td></tr>`,
          )
          .join('\n')
      : '<tr><td colspan="4">(none)</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Final report — ${escapeHtml(input.result.runId)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; max-width: 52rem; line-height: 1.45; }
    h1 { margin-bottom: 0.25rem; }
    h2 { margin-top: 1.75rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
    .status { font-size: 1.25rem; font-weight: 700; }
    .pass { color: #0a7a32; }
    .block { color: #b00020; }
    pre { background: #f6f6f6; padding: 0.75rem 1rem; overflow-x: auto; white-space: pre-wrap; }
    table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; vertical-align: top; }
    code { background: #f4f4f4; padding: 0.1rem 0.3rem; }
    ul { padding-left: 1.25rem; }
  </style>
</head>
<body>
  <h1>Pipeline final report</h1>
  <p class="status ${statusClass}">FINAL RESULT: ${escapeHtml(input.result.status)}</p>
  <p>Run ID: <code>${escapeHtml(input.result.runId)}</code> · Task: <code>${escapeHtml(input.result.taskId)}</code> · Mode: <code>${escapeHtml(input.result.mode)}</code></p>
  <p>Started: ${escapeHtml(input.result.startedAt)} · Finished: ${escapeHtml(input.result.finishedAt)}</p>

  <h2>WHAT WAS REQUESTED?</h2>
  <p><strong>${escapeHtml(task.title)}</strong></p>
  <pre>${escapeHtml(task.goal)}</pre>
  <p>Acceptance criteria:</p>
  <ul>
    ${task.acceptanceCriteria.map((c) => `<li>${escapeHtml(c)}</li>`).join('\n    ')}
  </ul>

  <h2>WHAT DID THE AGENT DO?</h2>
  <pre>${escapeHtml(whatAgentDid)}</pre>
  <p>Agent claimed success is <strong>never</strong> used to grant PASS. See <code>agent.log</code>.</p>

  <h2>WHAT CHANGED?</h2>
  <pre>${escapeHtml(whatChanged)}</pre>
  <p>Full patch: <code>git-diff.patch</code></p>

  <h2>WHAT WAS TESTED?</h2>
  <pre>${escapeHtml(whatTested)}</pre>
  <p>Machine detail: <code>validation.json</code>, plus <code>api/</code>, <code>graphql/</code>, <code>playwright/</code>, <code>database/</code>, <code>screenshots/</code> when applicable.</p>

  <h2>WHAT ACTUALLY PASSED?</h2>
  <pre>${escapeHtml(whatPassed)}</pre>

  <h2>WHAT FAILED?</h2>
  <pre>${escapeHtml(whatFailed)}</pre>
  <table>
    <thead><tr><th>Check</th><th>Status</th><th>Expected</th><th>Actual</th></tr></thead>
    <tbody>
${failedRows}
    </tbody>
  </table>

  <h2>WAS ANY RETRY PERFORMED?</h2>
  <p>${escapeHtml(retryAnswer)}</p>

  <h2>WHY?</h2>
  <p>${escapeHtml(recovery.reason)}</p>
  <p>${escapeHtml(resultPayload.verdictBasis)}</p>
  ${
    resultPayload.validatorNotes.length > 0
      ? `<ul>${resultPayload.validatorNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
      : ''
  }
  <p>See <code>recovery.json</code> and <code>execution.log</code>.</p>

  <h2>WAS ROLLBACK NEEDED?</h2>
  <p>${recovery.rollbackNeeded ? 'Yes — discard the disposable workspace; keep this evidence directory.' : 'No workspace mutation requiring rollback beyond normal disposable cleanup.'}</p>
  <pre>${escapeHtml(recovery.rollback)}</pre>

  <h2>FINAL RESULT?</h2>
  <p class="status ${statusClass}">${escapeHtml(input.result.status)}</p>
  <p>Exit code: <code>${String(input.result.exitCode)}</code>. Authority is the independent validator and this evidence package — not the agent self-report.</p>

  <h2>Evidence tree</h2>
  <ul>
    <li><code>task.json</code> / <code>scenario.json</code></li>
    <li><code>execution.log</code> / <code>agent.log</code></li>
    <li><code>git-diff.patch</code></li>
    <li><code>validation.json</code></li>
    <li><code>api/</code> · <code>graphql/</code> · <code>screenshots/</code> · <code>playwright/</code> · <code>database/</code></li>
    <li><code>recovery.json</code> · <code>rollback.md</code></li>
    <li><code>final-report.html</code> (this file)</li>
  </ul>
</body>
</html>
`;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path: string, value: string): void {
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

function readIfExists(path: string): string {
  if (!existsSync(path)) {
    return '';
  }
  return readFileSync(path, 'utf8');
}

function relativePath(runDir: string, absolute: string): string {
  try {
    return relative(runDir, absolute) || basename(absolute);
  } catch {
    return absolute;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
