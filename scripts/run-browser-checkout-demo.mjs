#!/usr/bin/env node
import { runBrowserCheckoutScenario } from '../src/scenarios/browser-checkout/run-scenario.js';

const keepWorkspace = process.argv.includes('--keep-workspace');
const useRealBrowser = process.argv.includes('--real-browser');

const { result, baseUrl, screenshots } = await runBrowserCheckoutScenario({
  keepWorkspace,
  useRealBrowser,
});

const summary = {
  status: result.status,
  exitCode: result.exitCode,
  runId: result.runId,
  artifactDir: result.artifactDir,
  baseUrl,
  screenshots: screenshots.map((name) => `${result.artifactDir}/screenshots/${name}`),
  playwrightResults: `${result.artifactDir}/playwright-results.json`,
  validatorVerdict: `${result.artifactDir}/validator-verdict.json`,
  summaryHtml: `${result.artifactDir}/summary.html`,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = result.exitCode;
