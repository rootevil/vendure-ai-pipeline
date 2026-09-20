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

export class FileEvidenceCollector implements EvidenceCollector {
  async writeBundle(input: EvidenceBundleInput): Promise<readonly string[]> {
    const dir = input.context.artifactDir;
    mkdirSync(dir, { recursive: true });

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

    const files: Array<[string, string]> = [
      ['run-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
      [
        'status.json',
        `${JSON.stringify({ status: input.status, run_id: input.context.runId }, null, 2)}\n`,
      ],
      ['stdout.log', input.stdout],
      ['stderr.log', input.stderr],
      ['diff.patch', input.diff],
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
