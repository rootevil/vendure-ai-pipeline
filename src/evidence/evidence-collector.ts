import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExecutionContext } from '../safety/execution-context.js';
import type { AttemptRecord, RunManifest, RunStatus } from '../models/types.js';

export interface EvidenceBundleInput {
  readonly context: ExecutionContext;
  readonly status: RunStatus;
  readonly attempts: readonly AttemptRecord[];
  readonly stdout: string;
  readonly stderr: string;
  readonly diff: string;
  readonly changeSummary: string;
  readonly rollback: string;
  readonly summary: string;
  readonly networkUsed: boolean;
  readonly secretsUsed: boolean;
  readonly maxIdenticalRetries: number;
  readonly finishedAt: string;
}

export interface EvidenceCollector {
  writeBundle(input: EvidenceBundleInput): Promise<readonly string[]>;
}

/**
 * Writes the early/mid-run evidence under runs/<runId>/.
 * Final Phase 6 pack (result.json, summary.html, evidence-manifest.json, …)
 * is completed by finalizeEvidencePack after independent validation.
 */
export class FileEvidenceCollector implements EvidenceCollector {
  async writeBundle(input: EvidenceBundleInput): Promise<readonly string[]> {
    const dir = input.context.artifactDir;
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'screenshots'), { recursive: true });
    mkdirSync(join(dir, 'api-responses'), { recursive: true });
    mkdirSync(join(dir, 'validation'), { recursive: true });

    const manifest: RunManifest = {
      run_id: input.context.runId,
      mode: input.context.mode,
      task_id: input.context.task.id,
      started_at: input.context.startedAt,
      finished_at: input.finishedAt,
      network_used: input.networkUsed,
      secrets_used: input.secretsUsed,
      attempts: input.attempts.length,
      max_identical_retries: input.maxIdenticalRetries,
      status: input.status,
    };

    const executionLog = [
      `# Execution log for run ${input.context.runId}`,
      `Started: ${input.context.startedAt}`,
      `Finished: ${input.finishedAt}`,
      `Provisional status: ${input.status}`,
      '',
      '## Attempts',
      ...input.attempts.map(
        (attempt) =>
          `- #${attempt.attempt} ${attempt.failureKind}/${attempt.failureClass} claimedSuccess=${String(attempt.agentClaimedSuccess)} — ${attempt.message}`,
      ),
      '',
      '## stdout',
      input.stdout || '(empty)',
      '',
      '## stderr',
      input.stderr || '(empty)',
      '',
    ].join('\n');

    const files: Array<[string, string]> = [
      ['run-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
      [
        'status.json',
        `${JSON.stringify({ status: input.status, run_id: input.context.runId }, null, 2)}\n`,
      ],
      ['task.json', `${JSON.stringify(input.context.task, null, 2)}\n`],
      ['stdout.log', input.stdout],
      ['stderr.log', input.stderr],
      ['execution.log', ensureTrailingNewline(executionLog)],
      ['diff.patch', input.diff],
      [
        'git.diff',
        ensureTrailingNewline(
          input.diff.length > 0 ? input.diff : 'No git diff captured for this run.',
        ),
      ],
      ['change-summary.md', ensureTrailingNewline(input.changeSummary)],
      ['rollback.md', ensureTrailingNewline(input.rollback)],
      ['summary.md', ensureTrailingNewline(input.summary)],
      ['attempts.json', `${JSON.stringify(input.attempts, null, 2)}\n`],
    ];

    const written: string[] = [];
    for (const [name, content] of files) {
      writeFileSync(join(dir, name), content, 'utf8');
      written.push(name);
    }
    return written;
  }
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}
