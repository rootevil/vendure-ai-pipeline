#!/usr/bin/env node
import { runPublicCatalogScenario } from '../src/scenarios/public-catalog/run-scenario.js';

const keepWorkspace = process.argv.includes('--keep-workspace');
const useRealBrowser = process.argv.includes('--real-browser');

const { result, baseUrl } = await runPublicCatalogScenario({
  keepWorkspace,
  useRealBrowser,
});

const summary = {
  status: result.status,
  exitCode: result.exitCode,
  runId: result.runId,
  artifactDir: result.artifactDir,
  evidenceManifest: result.evidenceManifest ? `${result.artifactDir}/evidence-manifest.json` : null,
  baseUrl,
  report: result.report ? `${result.artifactDir}/report.json` : null,
  summaryHtml: `${result.artifactDir}/summary.html`,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = result.exitCode;
