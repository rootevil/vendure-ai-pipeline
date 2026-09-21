import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { AgentAdapter, AgentRunOutcome } from '../../agent/agent-adapter.js';
import type { ExecutionContext } from '../../safety/execution-context.js';

/**
 * Bounded path-aware agent: copies nail-patterns preserving relative paths and writes inventory.
 */
export class NailPatternsScenarioAgent implements AgentAdapter {
  readonly name = 'nail-patterns-scenario-agent';

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    const repoRoot = findRepoRoot();
    const source = join(repoRoot, 'evaluation-demo', 'assets', 'nail-patterns');
    if (!existsSync(source)) {
      return {
        claimedSuccess: false,
        summary: `Source nail-patterns missing at ${source}`,
        stdout: '',
        stderr: 'nail-patterns source missing',
        failureClass: 'non_recoverable',
        failureCode: 'SOURCE_MISSING',
        changedFiles: [],
        diff: '',
      };
    }

    const targetRoot = context.assertWritablePath('evaluation-demo/assets/nail-patterns');
    mkdirSync(join(context.workspaceDir, 'evaluation-demo', 'assets'), { recursive: true });
    cpSync(source, targetRoot, { recursive: true });

    const files = listRelativeFiles(targetRoot).filter((rel) => /\.(jpe?g|png|md)$/i.test(rel));
    const inventoryRel = 'evaluation-demo/assets/nail-patterns-inventory.json';
    const inventoryPath = context.assertWritablePath(inventoryRel);
    writeFileSync(
      inventoryPath,
      `${JSON.stringify(
        {
          root: 'evaluation-demo/assets/nail-patterns',
          fileCount: files.length,
          relativePaths: files,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const changedFiles = [
      inventoryRel,
      ...files.slice(0, 5).map((rel) => `evaluation-demo/assets/nail-patterns/${rel}`),
    ];

    return {
      claimedSuccess: true,
      summary: `Preserved nail-patterns tree with ${files.length} files and wrote inventory`,
      stdout: `inventory=${inventoryPath}\nfiles=${files.length}\n`,
      stderr: '',
      failureClass: 'recoverable',
      failureCode: 'NAIL_PATTERNS_OK',
      changedFiles,
      diff: changedFiles.map((f) => `+++ ${f}`).join('\n'),
    };
  }
}

function listRelativeFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        out.push(relative(root, abs).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

function findRepoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(join(current, 'evaluation-demo', 'assets', 'nail-patterns')) &&
      existsSync(join(current, 'package.json'))
    ) {
      return current;
    }
    const parent = join(current, '..');
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}
