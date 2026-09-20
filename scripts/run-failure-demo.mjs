#!/usr/bin/env node
import { runFailureDemo } from '../src/scenarios/public-catalog/failure-demo.js';

const mode = process.argv.includes('--unrecoverable') ? 'unrecoverable' : 'recoverable';
const keepWorkspace = process.argv.includes('--keep-workspace');

const demo = await runFailureDemo({
  mode,
  keepWorkspace,
});

const summary = {
  mode: demo.mode,
  status: demo.result.status,
  exitCode: demo.result.exitCode,
  runId: demo.result.runId,
  repairAttempts: demo.repairAttempts,
  steps: demo.steps,
  artifactDir: demo.result.artifactDir,
  failureDemoJson: `${demo.result.artifactDir}/failure-demo.json`,
  summaryHtml: `${demo.result.artifactDir}/summary.html`,
  evidenceManifest: demo.evidenceManifest
    ? `${demo.result.artifactDir}/evidence-manifest.json`
    : null,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = demo.result.exitCode;
