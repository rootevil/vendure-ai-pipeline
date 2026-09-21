import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';

/**
 * Asserts a fixture tree keeps nested relative paths (never flattened/renamed).
 */
export async function runPathInvariantCheck(
  step: Extract<ValidationStep, { type: 'path_invariant' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const expected = `path invariants under ${step.root}; required=${step.requiredRelativePaths.join(', ')}`;

  try {
    const rootAbs = ctx.context.resolveWorkspacePath(step.root);
    if (!existsSync(rootAbs) || !statSync(rootAbs).isDirectory()) {
      return createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: `Missing directory ${step.root}`,
        output: rootAbs,
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }

    const missing: string[] = [];
    const nestedMissingSlash: string[] = [];
    for (const rel of step.requiredRelativePaths) {
      const normalized = rel.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!normalized.includes('/')) {
        nestedMissingSlash.push(normalized);
      }
      const candidate = join(rootAbs, ...normalized.split('/'));
      if (!existsSync(candidate)) {
        missing.push(normalized);
      }
    }

    if (nestedMissingSlash.length === step.requiredRelativePaths.length) {
      return createCheckResult({
        checkName: step.id,
        status: 'FAIL',
        expected,
        actual: 'requiredRelativePaths must include nested paths containing "/" (anti-flatten contract)',
        output: JSON.stringify({ nestedMissingSlash }, null, 2),
        evidenceDir: ctx.evidenceDir,
        evidenceFileName: evidenceFile,
        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
      });
    }

    const extensions = new Set(step.allowedExtensions.map((ext) => ext.toLowerCase()));
    const files = listFilesRecursive(rootAbs).filter((abs) => {
      const lower = abs.toLowerCase();
      return [...extensions].some((ext) => lower.endsWith(ext.toLowerCase()));
    });
    const relativeFiles = files.map((abs) => relative(rootAbs, abs).split(sep).join('/'));
    const rootLevelCount = relativeFiles.filter((rel) => !rel.includes('/')).length;
    const nestedCount = relativeFiles.length - rootLevelCount;

    const failures: string[] = [];
    if (missing.length > 0) {
      failures.push(`missing required paths: ${missing.join(', ')}`);
    }
    if (step.minFiles !== undefined && relativeFiles.length < step.minFiles) {
      failures.push(`file count ${relativeFiles.length} < minFiles ${step.minFiles}`);
    }
    if (nestedCount === 0 && relativeFiles.length > 0) {
      failures.push('all matching files are at root (tree appears flattened)');
    }

    const passed = failures.length === 0;
    return createCheckResult({
      checkName: step.id,
      status: passed ? 'PASS' : 'FAIL',
      expected,
      actual: passed
        ? `ok files=${relativeFiles.length} nested=${nestedCount} rootLevel=${rootLevelCount}`
        : failures.join('; '),
      output: JSON.stringify(
        {
          root: step.root,
          requiredRelativePaths: step.requiredRelativePaths,
          missing,
          fileCount: relativeFiles.length,
          nestedCount,
          rootLevelCount,
          sample: relativeFiles.slice(0, 20),
        },
        null,
        2,
      ),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  } catch (error) {
    return createCheckResult({
      checkName: step.id,
      status: 'ERROR',
      expected,
      actual: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? (error.stack ?? error.message) : String(error),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}
