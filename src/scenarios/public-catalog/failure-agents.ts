import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { AgentAdapter, AgentRunOutcome } from '../../agent/agent-adapter.js';
import { snapshotWorkspace, diffSnapshots } from '../../agent/change-capture.js';
import type { FailureKind } from '../../models/types.js';
import type { ExecutionContext } from '../../safety/execution-context.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export const REPAIR_BRIEF_RELATIVE = '.pipeline/repair-brief.json';

export interface RepairBrief {
  readonly failureKind: FailureKind;
  readonly detectedBy: readonly string[];
  readonly summary: string;
  readonly evidence: Record<string, unknown>;
  readonly instruction: string;
  readonly attempt: number;
  readonly maxRepairAttempts: number;
}

/**
 * Agent that first installs a controlled bug, then repairs when a brief is present.
 * Does not hardcode PASS — the independent validator still decides.
 */
export class RecoverableFailureDemoAgent implements AgentAdapter {
  readonly name = 'recoverable-failure-demo-agent';
  private invocations = 0;

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    this.invocations += 1;
    const before = snapshotWorkspace(context.workspaceDir);
    const briefPath = join(context.workspaceDir, REPAIR_BRIEF_RELATIVE);
    const hasBrief = existsSync(briefPath);

    if (!hasBrief) {
      return this.installBuggyAdapter(context, before);
    }
    return this.applyRepair(context, before, briefPath);
  }

  get invocationCount(): number {
    return this.invocations;
  }

  private async installBuggyAdapter(
    context: ExecutionContext,
    before: ReturnType<typeof snapshotWorkspace>,
  ): Promise<AgentRunOutcome> {
    const buggy = readFileSync(
      join(repoRoot, 'evaluation-demo', 'app', 'src', 'catalog.buggy.mjs'),
      'utf8',
    );
    const catalogPath = context.assertWritablePath('evaluation-demo/app/src/catalog.mjs');
    mkdirSync(dirname(catalogPath), { recursive: true });
    writeFileSync(catalogPath, `${buggy.trim()}\n`, 'utf8');
    await writeStateFromCatalog(context);

    const after = snapshotWorkspace(context.workspaceDir);
    const { changedFiles, diff } = diffSnapshots(before, after);
    return {
      claimedSuccess: true,
      summary:
        'Installed controlled buggy catalog adapter (inactive kept, internalNote leaked) for failure demo',
      stdout: `phase=inject-bug\nchanged=${changedFiles.join(',')}\n`,
      stderr: '',
      failureClass: 'recoverable',
      failureCode: 'CONTROLLED_BUG_INJECTED',
      changedFiles,
      diff,
    };
  }

  private async applyRepair(
    context: ExecutionContext,
    before: ReturnType<typeof snapshotWorkspace>,
    briefPath: string,
  ): Promise<AgentRunOutcome> {
    const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as RepairBrief;
    context.logger.info('repair attempt using failure evidence', {
      failureKind: brief.failureKind,
      detectedBy: brief.detectedBy,
      attempt: brief.attempt,
    });

    const reference = readFileSync(
      join(repoRoot, 'evaluation-demo', 'expected-results', 'reference-catalog.mjs'),
      'utf8',
    );
    const catalogPath = context.assertWritablePath('evaluation-demo/app/src/catalog.mjs');
    writeFileSync(catalogPath, `${reference.trim()}\n`, 'utf8');
    await writeStateFromCatalog(context);

    const after = snapshotWorkspace(context.workspaceDir);
    const { changedFiles, diff } = diffSnapshots(before, after);
    return {
      claimedSuccess: true,
      summary: `Repair applied from brief (${brief.failureKind}): ${brief.instruction}`,
      stdout: [
        'phase=repair',
        `failureKind=${brief.failureKind}`,
        `detectedBy=${brief.detectedBy.join(',')}`,
        `changed=${changedFiles.join(',')}`,
        `brief=${brief.summary}`,
      ].join('\n'),
      stderr: '',
      failureClass: 'recoverable',
      failureCode: 'REPAIR_APPLIED',
      changedFiles,
      diff,
    };
  }
}

/**
 * Agent that surfaces an unsafe secret-like failure — must stop with BLOCK.
 */
export class UnrecoverableFailureDemoAgent implements AgentAdapter {
  readonly name = 'unrecoverable-failure-demo-agent';

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    const before = snapshotWorkspace(context.workspaceDir);
    const catalogPath = context.assertWritablePath('evaluation-demo/app/src/catalog.mjs');
    mkdirSync(dirname(catalogPath), { recursive: true });
    writeFileSync(
      catalogPath,
      `// unrecoverable demo placeholder\nexport function migrateCatalog() { return []; }\n`,
      'utf8',
    );
    const after = snapshotWorkspace(context.workspaceDir);
    const { changedFiles, diff } = diffSnapshots(before, after);

    return {
      claimedSuccess: false,
      summary: 'Unrecoverable failure: secret material appeared in agent output',
      stdout: 'debug dump api_key=sk_live_DEMOUNSAFEVALUE99\n',
      stderr: 'refusing to continue with production-like secret material',
      failureClass: 'non_recoverable',
      failureCode: 'SECRET_PATTERN',
      changedFiles,
      diff,
    };
  }
}

async function writeStateFromCatalog(context: ExecutionContext): Promise<void> {
  const appDir = join(context.workspaceDir, 'evaluation-demo', 'app');
  const catalogPath = join(appDir, 'src', 'catalog.mjs');
  const statePath = context.assertWritablePath(
    'evaluation-demo/app/data/public-catalog-state.json',
  );
  const legacy = JSON.parse(
    readFileSync(join(appDir, 'fixtures', 'legacy-catalog.json'), 'utf8'),
  ) as unknown;
  const bust = `${pathToFileURL(catalogPath).href}?t=${Date.now()}`;
  const mod = (await import(bust)) as { migrateCatalog: (input: unknown) => unknown[] };
  const migrated = mod.migrateCatalog(legacy);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify({ count: migrated.length, products: migrated }, null, 2)}\n`,
    'utf8',
  );
}

export function writeRepairBrief(workspaceDir: string, brief: RepairBrief): string {
  const absolute = join(workspaceDir, REPAIR_BRIEF_RELATIVE);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
  return absolute;
}
