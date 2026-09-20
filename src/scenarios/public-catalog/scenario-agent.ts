import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import type { AgentAdapter, AgentRunOutcome } from '../../agent/agent-adapter.js';
import { snapshotWorkspace, diffSnapshots } from '../../agent/change-capture.js';
import type { ExecutionContext } from '../../safety/execution-context.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Deterministic evaluation Agent for the public catalog scenario.
 * Applies the published reference adapter (no LLM) inside the isolated workspace.
 */
export class PublicCatalogScenarioAgent implements AgentAdapter {
  readonly name = 'public-catalog-scenario-agent';

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    const before = snapshotWorkspace(context.workspaceDir);
    const appDir = join(context.workspaceDir, 'evaluation-demo', 'app');
    const catalogPath = context.assertWritablePath('evaluation-demo/app/src/catalog.mjs');
    const statePath = context.assertWritablePath(
      'evaluation-demo/app/data/public-catalog-state.json',
    );

    const reference = readFileSync(
      join(repoRoot, 'evaluation-demo', 'expected-results', 'reference-catalog.mjs'),
      'utf8',
    );
    mkdirSync(dirname(catalogPath), { recursive: true });
    writeFileSync(catalogPath, `${reference.trim()}\n`, 'utf8');

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

    const after = snapshotWorkspace(context.workspaceDir);
    const { changedFiles, diff } = diffSnapshots(before, after);

    return {
      claimedSuccess: true,
      summary:
        'Applied evaluation-demo reference catalog adapter and wrote public-catalog-state.json',
      stdout: `changed=${changedFiles.join(',')}\nproducts=${migrated.length}\n`,
      stderr: '',
      failureClass: 'recoverable',
      failureCode: 'CATALOG_ADAPTER_APPLIED',
      changedFiles,
      diff,
    };
  }
}

/** Seed an incomplete adapter so the isolated run starts from a failing baseline. */
export function seedIncompleteCatalog(workspaceDir: string): void {
  const incomplete = readFileSync(
    join(repoRoot, 'evaluation-demo', 'app', 'src', 'catalog.incomplete.mjs'),
    'utf8',
  );
  const target = join(workspaceDir, 'evaluation-demo', 'app', 'src', 'catalog.mjs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, incomplete, 'utf8');
}

/** Copy the public evaluation-demo package into the isolated workspace. */
export function materializeEvaluationDemo(workspaceDir: string): void {
  const sourceApp = join(repoRoot, 'evaluation-demo', 'app');
  const targetApp = join(workspaceDir, 'evaluation-demo', 'app');
  mkdirSync(join(workspaceDir, 'evaluation-demo'), { recursive: true });
  cpSync(sourceApp, targetApp, { recursive: true });
  cpSync(
    join(repoRoot, 'evaluation-demo', 'task.md'),
    join(workspaceDir, 'evaluation-demo', 'task.md'),
  );
  seedIncompleteCatalog(workspaceDir);
}

export function runAcceptanceTests(appDir: string): number {
  const result = spawnSync(
    process.execPath,
    ['--test', join(appDir, 'tests', 'acceptance.test.mjs')],
    {
      cwd: appDir,
      encoding: 'utf8',
    },
  );
  return result.status ?? 1;
}
