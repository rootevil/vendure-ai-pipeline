#!/usr/bin/env node
import { runNailPatternsScenario } from '../src/scenarios/nail-patterns/run-scenario.ts';

const keepWorkspace = process.argv.includes('--keep-workspace');
const result = await runNailPatternsScenario({ keepWorkspace });
process.stdout.write(
  `${JSON.stringify(
    {
      status: result.result.status,
      exitCode: result.result.exitCode,
      artifactDir: result.result.artifactDir,
      runId: result.result.runId,
    },
    null,
    2,
  )}\n`,
);
process.exitCode = result.result.exitCode;
