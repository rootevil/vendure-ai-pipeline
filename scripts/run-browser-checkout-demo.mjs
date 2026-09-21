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
  evidence: {
    browser: screenshots.map((name) => `${result.artifactDir}/screenshots/${name}`),
    backend: [
      `${result.artifactDir}/api-responses/graphql-query-product.json`,
      `${result.artifactDir}/api-responses/graphql-query-order.json`,
      `${result.artifactDir}/api-responses/graphql-query-customer-orders.json`,
      `${result.artifactDir}/api-responses/api-order-state.json`,
    ],
    database: `${result.artifactDir}/validation/database-order-by-code.json`,
  },
  playwrightResults: `${result.artifactDir}/playwright-results.json`,
  validatorVerdict: `${result.artifactDir}/validator-verdict.json`,
  summaryHtml: `${result.artifactDir}/summary.html`,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = result.exitCode;
