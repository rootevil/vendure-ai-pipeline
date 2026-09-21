#!/usr/bin/env node
/**
 * Restore a workspace from artifactDir/workspace-checkpoint/.
 * Usage: node packages/validator/bin/restore-checkpoint.mjs --run-dir artifacts/<run_id> [--workspace <dir>]
 * Workspace must remain under PIPELINE_WORKSPACE_DIR, ./workspace, or OS temp.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function parseArgs(argv) {
  let runDir = null;
  let workspace = null;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--run-dir') {
      runDir = argv[i + 1] ?? null;
      i += 1;
    } else if (argv[i] === '--workspace') {
      workspace = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return { runDir, workspace };
}

async function loadCheckpoint() {
  const distPath = resolve(repoRoot, 'dist/safety/workspace-checkpoint.js');
  try {
    return await import(pathToFileURL(distPath).href);
  } catch {
    return import(pathToFileURL(resolve(repoRoot, 'src/safety/workspace-checkpoint.ts')).href);
  }
}

const { runDir, workspace } = parseArgs(process.argv);
if (!runDir) {
  process.stderr.write(
    'Usage: node packages/validator/bin/restore-checkpoint.mjs --run-dir <path> [--workspace <dir>]\n',
  );
  process.exit(1);
}

const absoluteRunDir = resolve(runDir);
let workspaceDir = workspace ? resolve(workspace) : null;
if (!workspaceDir) {
  const metaPath = resolve(absoluteRunDir, 'checkpoint-meta.json');
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    workspaceDir = meta.sourceWorkspaceDir;
  }
}
if (!workspaceDir) {
  process.stderr.write('Missing --workspace and checkpoint-meta.json sourceWorkspaceDir\n');
  process.exit(1);
}

try {
  const mod = await loadCheckpoint();
  const meta = mod.restoreWorkspaceCheckpoint({
    workspaceDir,
    artifactDir: absoluteRunDir,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, meta }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exit(1);
}
