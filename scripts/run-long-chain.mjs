#!/usr/bin/env node
import { runLongChainTasks } from '../src/long-chain/run-long-chain.js';

const compileOnly = process.argv.includes('--compile-only');
const result = await runLongChainTasks({ compileOnly });
process.stdout.write(`${result.summaryLines.join('\n')}\n`);
if (!compileOnly) {
  process.stdout.write(
    `${JSON.stringify(
      {
        exitCode: result.exitCode,
        tasks: result.tasks.map((task) => ({
          taskPath: task.taskPath,
          taskId: task.taskId,
          status: task.status,
          exitCode: task.exitCode,
          artifactDir: task.artifactDir,
        })),
      },
      null,
      2,
    )}\n`,
  );
}
process.exitCode = result.exitCode;
