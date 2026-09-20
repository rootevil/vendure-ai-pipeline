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
  EvidenceManifest,
  EvidenceManifestEntry,
  RunResult,
  RunStatus,
  TaskDefinition,
  ValidationCheckResult,
} from '../models/types.js';

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
  readonly now?: () => Date;
}

/**
 * Writes the Phase 6 reviewable evidence pack under runs/<runId>/.
 * A reviewer who did not execute the pipeline should understand PASS/BLOCK from these files alone.
 */
export function finalizeEvidencePack(input: FinalizeEvidencePackInput): EvidenceManifest {
  const nowFn = input.now ?? (() => new Date());
  const generatedAt = nowFn().toISOString();
  const runDir = input.runDir;
  mkdirSync(runDir, { recursive: true });
  mkdirSync(join(runDir, 'screenshots'), { recursive: true });
  mkdirSync(join(runDir, 'api-responses'), { recursive: true });

  writeJson(join(runDir, 'task.json'), input.task);

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
  // Keep alias used by Phase 5 validators/tests.
  writeJson(join(runDir, 'validation-results.json'), input.result.validationChecks);

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

  const diff = input.diff ?? readIfExists(join(runDir, 'diff.patch'));
  writeText(
    join(runDir, 'git.diff'),
    diff.length > 0 ? diff : 'No git diff captured for this run.\n',
  );
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

  const rollback =
    readIfExists(join(runDir, 'rollback.md')) ||
    'Rollback: discard the disposable workspace for this runId and retain only this evidence directory. Do not mutate client main.\n';
  writeText(join(runDir, 'rollback.md'), rollback);

  writeText(join(runDir, 'summary.html'), renderSummaryHtml(input, resultPayload));

  // Compatibility aliases expected by earlier phases / evidence_present defaults.
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
        `- See summary.html and result.json for the full verdict basis.`,
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

function collectApiResponses(runDir: string, checks: readonly ValidationCheckResult[]): void {
  const apiDir = join(runDir, 'api-responses');
  mkdirSync(apiDir, { recursive: true });
  for (const check of checks) {
    const name = check.checkName;
    if (!existsSync(check.evidencePath)) {
      continue;
    }
    // Copy network-oriented check payloads into api-responses/ when present.
    if (
      name.includes('health') ||
      name.includes('api') ||
      name.includes('gql') ||
      name.includes('http') ||
      name.includes('graphql')
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

function buildEvidenceManifest(input: {
  readonly runDir: string;
  readonly runId: string;
  readonly status: RunStatus;
  readonly generatedAt: string;
}): EvidenceManifest {
  const catalog: Array<{ path: string; type: EvidenceManifestEntry['type']; description: string }> =
    [
      {
        path: 'result.json',
        type: 'result',
        description: 'Final PASS/BLOCK verdict with notes and failed/passed check summary',
      },
      {
        path: 'task.json',
        type: 'task',
        description: 'Exact task definition executed for this run',
      },
      {
        path: 'execution.log',
        type: 'log',
        description: 'Attempt timeline plus captured stdout/stderr',
      },
      {
        path: 'validation.json',
        type: 'validation',
        description: 'Independent validator checks with expected vs actual results',
      },
      {
        path: 'test-results.json',
        type: 'test_result',
        description: 'Acceptance/unit test runner exit code and related check evidence',
      },
      {
        path: 'git.diff',
        type: 'diff',
        description: 'Git diff / patch of agent workspace changes',
      },
      {
        path: 'summary.html',
        type: 'summary',
        description: 'Human-readable HTML explanation of why the run PASSED or BLOCKed',
      },
      {
        path: 'rollback.md',
        type: 'rollback',
        description: 'Rollback instructions for discarding the disposable workspace',
      },
      {
        path: 'evidence-manifest.json',
        type: 'manifest',
        description: 'Catalog of evidence files with types and descriptions',
      },
      {
        path: 'screenshots/',
        type: 'screenshot',
        description: 'Browser validation screenshots (when Playwright checks ran)',
      },
      {
        path: 'api-responses/',
        type: 'api_response',
        description: 'Captured HTTP/GraphQL/health response payloads from independent checks',
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

  // Include any extra files present in screenshots/ and api-responses/
  for (const dirName of ['screenshots', 'api-responses'] as const) {
    const dir = join(input.runDir, dirName);
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      const rel = `${dirName}/${name}`;
      if (entries.some((entry) => entry.path === rel)) {
        continue;
      }
      entries.push({
        path: rel,
        type: dirName === 'screenshots' ? 'screenshot' : 'api_response',
        description:
          dirName === 'screenshots'
            ? `Screenshot artifact ${name}`
            : `API/response artifact ${name}`,
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

function renderSummaryHtml(
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
): string {
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
  <title>Pipeline evidence ${escapeHtml(input.result.runId)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; }
    h1 { margin-bottom: 0.25rem; }
    .status { font-size: 1.25rem; font-weight: 700; }
    .pass { color: #0a7a32; }
    .block { color: #b00020; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; vertical-align: top; }
    code { background: #f4f4f4; padding: 0.1rem 0.3rem; }
    ul { padding-left: 1.25rem; }
  </style>
</head>
<body>
  <h1>Pipeline run evidence</h1>
  <p class="status ${input.result.status === 'PASS' ? 'pass' : 'block'}">Status: ${escapeHtml(input.result.status)}</p>
  <p>Run ID: <code>${escapeHtml(input.result.runId)}</code></p>
  <p>Task: <code>${escapeHtml(input.result.taskId)}</code> · Mode: <code>${escapeHtml(input.result.mode)}</code></p>
  <p>Started: ${escapeHtml(input.result.startedAt)} · Finished: ${escapeHtml(input.result.finishedAt)}</p>
  <h2>Why this result</h2>
  <p>${escapeHtml(resultPayload.verdictBasis)}</p>
  <p>Agent claimed success is never used to grant PASS. Open <code>result.json</code> and <code>validation.json</code> for machine-readable detail.</p>
  <h2>Failed checks</h2>
  <table>
    <thead><tr><th>Check</th><th>Status</th><th>Expected</th><th>Actual</th></tr></thead>
    <tbody>
${failedRows}
    </tbody>
  </table>
  <h2>Passed checks</h2>
  <ul>
    ${
      resultPayload.passedChecks.length > 0
        ? resultPayload.passedChecks
            .map((name) => `<li><code>${escapeHtml(name)}</code></li>`)
            .join('\n    ')
        : '<li>(none)</li>'
    }
  </ul>
  <h2>Validator notes</h2>
  <ul>
    ${
      resultPayload.validatorNotes.length > 0
        ? resultPayload.validatorNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('\n    ')
        : '<li>(none)</li>'
    }
  </ul>
  <h2>Where to look next</h2>
  <ul>
    <li><code>evidence-manifest.json</code> — catalog of all evidence files</li>
    <li><code>execution.log</code> — attempt timeline and logs</li>
    <li><code>git.diff</code> — workspace changes</li>
    <li><code>api-responses/</code> and <code>screenshots/</code> — network/browser artifacts when applicable</li>
    <li><code>rollback.md</code> — how to discard this run safely</li>
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
