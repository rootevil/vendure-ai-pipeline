import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExecutionReport } from '../models/types.js';

export function writeExecutionReport(report: ExecutionReport): void {
  const jsonPath = join(report.artifactDir, 'report.json');
  const mdPath = join(report.artifactDir, 'report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, renderMarkdown(report), 'utf8');
}

function renderMarkdown(report: ExecutionReport): string {
  return [
    `# Execution Report`,
    '',
    `- Run ID: \`${report.runId}\``,
    `- Task ID: \`${report.taskId}\``,
    `- Status: \`${report.status}\``,
    `- Exit code: \`${report.exitCode}\``,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Workspace cleaned: ${String(report.workspaceCleaned)}`,
    '',
    `## Goal`,
    '',
    report.goal,
    '',
    `## Acceptance criteria`,
    '',
    ...report.acceptanceCriteria.map((item) => `- ${item}`),
    '',
    `## Flow`,
    '',
    ...report.flow.map((step, index) => `${index + 1}. ${step}`),
    '',
    `## Changed files`,
    '',
    ...(report.changedFiles.length > 0
      ? report.changedFiles.map((file) => `- ${file}`)
      : ['- (none)']),
    '',
    `## Validation steps`,
    '',
    ...report.validationSteps.map(
      (step) =>
        `- \`${step.id}\` (${step.type}): ${step.status} — expected: ${step.expected}; actual: ${step.actual}; evidence: ${step.evidencePath}`,
    ),
    '',
    `## Independent checks`,
    '',
    ...(report.validationChecks.length > 0
      ? report.validationChecks.map(
          (check) =>
            `- \`${check.checkName}\`: ${check.status} @ ${check.timestamp} — ${check.expected} → ${check.actual}`,
        )
      : ['- (none)']),
    '',
    `## Validator notes`,
    '',
    ...report.validatorNotes.map((note) => `- ${note}`),
    '',
    `## Agent summary`,
    '',
    report.agentSummary ?? '(none)',
    '',
  ].join('\n');
}
