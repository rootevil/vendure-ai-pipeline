#!/usr/bin/env node
/**
 * Independent validator CLI (artifact-only).
 * Usage: node packages/validator/bin/validate.mjs --run-dir artifacts/<run_id>
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function parseArgs(argv) {
  let runDir = null;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--run-dir') {
      runDir = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return { runDir };
}

async function loadValidateRunDir() {
  const distPath = resolve(repoRoot, 'dist/validator/validate-run-dir.js');
  try {
    return await import(pathToFileURL(distPath).href);
  } catch {
    // Dev fallback via tsx-compiled path when dist is missing.
    const require = createRequire(import.meta.url);
    try {
      require('tsx/cjs');
    } catch {
      // ignore
    }
    return import(pathToFileURL(resolve(repoRoot, 'src/validator/validate-run-dir.ts')).href);
  }
}

const { runDir } = parseArgs(process.argv);
if (!runDir) {
  process.stderr.write('Usage: node packages/validator/bin/validate.mjs --run-dir <path>\n');
  process.exit(1);
}

const mod = await loadValidateRunDir();
const result = mod.validateRunDir({ runDir: resolve(runDir) });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.exitCode);
