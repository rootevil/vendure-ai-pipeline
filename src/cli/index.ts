#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig, ConfigError } from '../config/load-config.js';
import { compileScenarioBundleFromPath } from '../compiler/scenario-compiler.js';
import { demoTranscript, isDemoTaskPath } from './demo-transcript.js';
import { TaskRunner } from '../execution/task-runner.js';
import { createLogger } from '../logging/logger.js';
import { runPublicCatalogScenario } from '../scenarios/public-catalog/run-scenario.js';
import { TaskDefinitionError } from '../task/task-definition.js';

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
      '  vendure-pipeline compile --task <path-to-task.yaml|task.md|task.json>',
      '  vendure-pipeline compile --task <path> --format technical|task|bundle',
      '  vendure-pipeline run --task <path-to-task.yaml|task.md|task.json>',
      '  vendure-pipeline <path-to-task.yaml|task.json>   # same as run --task',
      '',
      'Client demo (after docker compose up -d):',
      '  npm run pipeline -- tasks/demo-task.yaml',
      '',
      'Flow:',
      '  business goal card → scenario compiler → technical-task.json',
      '  → runnable TaskDefinition → isolated run → agent → validators → PASS/BLOCK',
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

function parseArgs(argv: readonly string[]): {
  command: string;
  taskPath: string | null;
  format: 'technical' | 'task' | 'bundle';
} {
  const args = argv.slice(2);
  const head = args[0] ?? 'help';
  const positionalTask = /\.(ya?ml|json|md)$/i.test(head);
  const command = positionalTask ? 'run' : head;
  let taskPath: string | null = positionalTask ? head : null;
  let format: 'technical' | 'task' | 'bundle' = 'technical';
  for (let i = 1; i < args.length; i += 1) {
    const current = args[i];
    if (current === '--task') {
      taskPath = args[i + 1] ?? null;
      i += 1;
    } else if (current === '--format') {
      const value = args[i + 1] ?? 'technical';
      if (value === 'technical' || value === 'task' || value === 'bundle') {
        format = value;
      }
      i += 1;
    }
  }
  return { command, taskPath, format };
}

export async function runCli(deps: CliDependencies = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const argv = deps.argv ?? process.argv;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const { command, taskPath, format } = parseArgs(argv);

  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage(stdout);
    return 0;
  }

  if (command !== 'run' && command !== 'compile') {
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
    const bundle = compileScenarioBundleFromPath(resolve(taskPath));

    if (command === 'compile') {
      if (format === 'technical') {
        if (!bundle.technical) {
          stderr.write(
            JSON.stringify({
              level: 'error',
              msg: 'No technical scenario for this input; use a business YAML card (goal/acceptance) or --format task',
            }) + '\n',
          );
          return 1;
        }
        stdout.write(`${JSON.stringify(bundle.technical, null, 2)}\n`);
        return 0;
      }
      if (format === 'task') {
        stdout.write(`${JSON.stringify(bundle.task, null, 2)}\n`);
        return 0;
      }
      stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
      return 0;
    }

    if (isDemoTaskPath(taskPath)) {
      const config = loadConfig(env);
      const scenario = await runPublicCatalogScenario({
        rootDir: process.cwd(),
        artifactsDir: resolve(config.artifactsDir),
        workspaceDir: resolve(config.workspaceDir),
        ...(config.runId !== undefined ? { runId: config.runId } : {}),
        keepWorkspace: false,
        logLevel: 'error',
      });
      const lines = demoTranscript({
        status: scenario.result.status,
        checkNames: scenario.result.validationChecks.map((check) => check.checkName),
      });
      stdout.write(`${lines.join('\n')}\n`);
      return scenario.result.exitCode;
    }

    const config = loadConfig(env);
    const logger = createLogger({
      level: config.logLevel,
      stdout,
      stderr,
    });
    const runner = new TaskRunner({ config, logger });
    const result = await runner.execute(bundle.task);
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
