#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig, ConfigError } from '../config/load-config.js';
import { TaskRunner } from '../execution/task-runner.js';
import { createLogger } from '../logging/logger.js';
import { loadTaskDefinitionFromJsonFile, TaskDefinitionError } from '../task/task-definition.js';

export interface CliDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly argv?: readonly string[];
  readonly stdout?: NodeJS.WritableStream;
  readonly stderr?: NodeJS.WritableStream;
}

function printUsage(stream: NodeJS.WritableStream): void {
  stream.write(
    [
      'Usage:',
      '  vendure-pipeline run --task <path-to-task.json>',
      '',
      'Flow:',
      '  TASK → parse/validate → isolated run → agent → changes → validators',
      '      → evidence → PASS/BLOCK → cleanup → report',
      '',
      'Environment:',
      '  PIPELINE_MODE, PIPELINE_ARTIFACTS_DIR, PIPELINE_WORKSPACE_DIR,',
      '  PIPELINE_MAX_IDENTICAL_RETRIES, PIPELINE_MAX_TOTAL_ATTEMPTS,',
      '  PIPELINE_ALLOW_NETWORK, PIPELINE_LOG_LEVEL, PIPELINE_RUN_ID,',
      '  PIPELINE_WRITE_ALLOWLIST, PIPELINE_AGENT_MODE (mock|openhands|noop),',
      '  PIPELINE_AGENT_TIMEOUT_MS, PIPELINE_OPENHANDS_COMMAND,',
      '  PIPELINE_MOCK_AGENT_BEHAVIOR',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv: readonly string[]): { command: string; taskPath: string | null } {
  const args = argv.slice(2);
  const command = args[0] ?? 'help';
  let taskPath: string | null = null;
  for (let i = 1; i < args.length; i += 1) {
    const current = args[i];
    if (current === '--task') {
      taskPath = args[i + 1] ?? null;
      i += 1;
    }
  }
  return { command, taskPath };
}

export async function runCli(deps: CliDependencies = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const argv = deps.argv ?? process.argv;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const { command, taskPath } = parseArgs(argv);

  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage(stdout);
    return 0;
  }

  if (command !== 'run') {
    stderr.write(`Unknown command: ${command}\n`);
    printUsage(stderr);
    return 1;
  }

  if (!taskPath) {
    stderr.write('Missing required --task <path>\n');
    printUsage(stderr);
    return 1;
  }

  try {
    const config = loadConfig(env);
    const logger = createLogger({
      level: config.logLevel,
      stdout,
      stderr,
    });
    const task = loadTaskDefinitionFromJsonFile(resolve(taskPath));
    const runner = new TaskRunner({ config, logger });
    const result = await runner.execute(task);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.exitCode;
  } catch (error) {
    if (error instanceof ConfigError || error instanceof TaskDefinitionError) {
      stderr.write(`${JSON.stringify({ level: 'error', msg: error.message, name: error.name })}\n`);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${JSON.stringify({ level: 'error', msg: message })}\n`);
    return 1;
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void runCli().then((code) => {
    process.exit(code);
  });
}
