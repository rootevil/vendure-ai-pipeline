#!/usr/bin/env node
import { runBlockDemo, runRecoveryDemo, runSuccessDemo } from '../src/cli/client-demos.js';

const mode = process.argv[2];
const run =
  mode === 'success' ? runSuccessDemo : mode === 'recovery' ? runRecoveryDemo : mode === 'block' ? runBlockDemo : null;

if (!run) {
  process.stderr.write('Usage: node scripts/run-client-demo.mjs <success|recovery|block>\n');
  process.exit(1);
}

const demo = await run();
process.stdout.write(`${demo.lines.join('\n')}\n`);
process.exitCode = demo.exitCode;
