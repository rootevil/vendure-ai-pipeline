import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExecutionContext } from '../safety/execution-context.js';
import { GuardingProcessRunner } from '../safety/command-guard.js';
import { scrubEnvForAgent } from '../safety/redaction.js';
import { agentOutcome, type AgentAdapter, type AgentRunOutcome } from './agent-adapter.js';
import { buildAgentRequest } from './agent-request.js';
import { diffSnapshots, snapshotWorkspace } from './change-capture.js';
import type { ProcessRunner } from './process-runner.js';
import {
  AgentOutputError,
  malformedOutcome,
  parseAgentResultJson,
  tryParseOpenHandsJsonl,
} from './result-parser.js';
import { writeAgentRequestFiles } from './task-prompt.js';

export interface OpenHandsAgentAdapterOptions {
  readonly command?: string;
  readonly timeoutMs: number;
  readonly runner?: ProcessRunner;
  readonly extraArgs?: readonly string[];
}

/**
 * Thin adapter: Pipeline → OpenHands CLI → Coding Agent → Workspace.
 * Does not implement an LLM. Final PASS/BLOCK remains with the validator.
 * Agent claimedSuccess ≠ Pipeline PASS.
 */
export class OpenHandsAgentAdapter implements AgentAdapter {
  readonly name = 'openhands';
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly runner: ProcessRunner;
  private readonly extraArgs: readonly string[];

  constructor(options: OpenHandsAgentAdapterOptions) {
    this.command = options.command ?? 'openhands';
    this.timeoutMs = options.timeoutMs;
    this.runner = options.runner ?? new GuardingProcessRunner();
    this.extraArgs = options.extraArgs ?? [];
  }

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    mkdirSync(context.workspaceDir, { recursive: true });
    const request = buildAgentRequest(context, this.timeoutMs);
    const { briefPath } = writeAgentRequestFiles(context.workspaceDir, context.task, request);
    const resultPath = join(context.workspaceDir, 'agent-result.json');

    const before = snapshotWorkspace(context.workspaceDir);
    const commandLine = [this.command, '--headless', '--json', '-f', briefPath, ...this.extraArgs].join(
      ' ',
    );
    context.logger.info('invoking OpenHands CLI', {
      command: this.command,
      timeoutMs: this.timeoutMs,
      workspace: context.workspaceDir,
      note: 'Agent claimedSuccess is ignored for Pipeline PASS/BLOCK',
    });

    const processResult = await this.runner.run({
      command: this.command,
      args: ['--headless', '--json', '-f', briefPath, ...this.extraArgs],
      cwd: context.workspaceDir,
      env: {
        ...scrubEnvForAgent(process.env),
        PIPELINE_AGENT_WORKSPACE: context.workspaceDir,
        PIPELINE_TASK_ID: context.task.id,
        PIPELINE_AGENT_TIME_LIMIT_MS: String(this.timeoutMs),
      },
      timeoutMs: this.timeoutMs,
    });

    const commandsExecuted = [commandLine];

    if (processResult.timedOut) {
      return agentOutcome({
        claimedSuccess: false,
        summary: `OpenHands timed out after ${this.timeoutMs}ms`,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        failureClass: 'recoverable',
        failureCode: 'AGENT_TIMEOUT',
        commandsExecuted,
        errors: ['AGENT_TIMEOUT'],
        finalReport: `timeout after ${this.timeoutMs}ms`,
        request,
      });
    }

    if (processResult.exitCode === null && processResult.signal === null) {
      return agentOutcome({
        claimedSuccess: false,
        summary: 'OpenHands CLI failed to start (is openhands installed and on PATH?)',
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        failureClass: 'non_recoverable',
        failureCode: 'OPENHANDS_NOT_AVAILABLE',
        commandsExecuted,
        errors: ['OPENHANDS_NOT_AVAILABLE'],
        finalReport: 'OpenHands CLI unavailable',
        request,
      });
    }

    const after = snapshotWorkspace(context.workspaceDir);
    const changes = diffSnapshots(before, after);

    let envelopeSummary: string | null = null;
    let claimedSuccess = processResult.exitCode === 0;
    let reportedFiles: readonly string[] | undefined;
    let reportedCommands: readonly string[] = [];
    let reportedErrors: readonly string[] = [];

    try {
      if (existsSync(resultPath)) {
        const parsed = parseAgentResultJson(readFileSync(resultPath, 'utf8'));
        envelopeSummary = parsed.summary;
        claimedSuccess = parsed.claimed_success;
        reportedFiles = parsed.changed_files;
        reportedCommands = parsed.commands_executed ?? [];
        reportedErrors = parsed.errors ?? [];
      } else {
        const fromJsonl = tryParseOpenHandsJsonl(processResult.stdout);
        if (fromJsonl) {
          envelopeSummary = fromJsonl.summary;
          claimedSuccess = fromJsonl.claimed_success;
          reportedFiles = fromJsonl.changed_files;
          reportedCommands = fromJsonl.commands_executed ?? [];
          reportedErrors = fromJsonl.errors ?? [];
        }
      }
    } catch (error) {
      if (error instanceof AgentOutputError) {
        return {
          ...malformedOutcome({
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            message: error.message,
            code: error.code,
          }),
          commandsExecuted: [...commandsExecuted, ...reportedCommands],
          request,
        };
      }
      throw error;
    }

    const controlFiles = new Set(['task-brief.md', 'agent-result.json', 'agent-request.json']);
    const changedFiles = changes.changedFiles.filter((file) => !controlFiles.has(file));
    for (const file of changedFiles) {
      try {
        context.assertWritablePath(file);
      } catch {
        return agentOutcome({
          claimedSuccess: false,
          summary: `OpenHands changed a path outside the write allowlist: ${file}`,
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          failureClass: 'non_recoverable',
          failureCode: 'PATH_ESCAPE',
          diff: changes.diff,
          commandsExecuted: [...commandsExecuted, ...reportedCommands],
          errors: ['PATH_ESCAPE', file],
          finalReport: `path escape: ${file}`,
          request,
        });
      }
    }

    if (reportedFiles) {
      for (const file of reportedFiles) {
        if (file.includes('..') || file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) {
          return agentOutcome({
            claimedSuccess: false,
            summary: `OpenHands reported unsafe changed path: ${file}`,
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            failureClass: 'non_recoverable',
            failureCode: 'PATH_ESCAPE',
            diff: changes.diff,
            commandsExecuted: [...commandsExecuted, ...reportedCommands],
            errors: ['PATH_ESCAPE', file],
            finalReport: `unsafe reported path: ${file}`,
            request,
          });
        }
      }
    }

    const summary =
      envelopeSummary ??
      (processResult.exitCode === 0
        ? 'OpenHands exited successfully (validator still decides PASS/BLOCK)'
        : `OpenHands exited with code ${String(processResult.exitCode)}`);

    return agentOutcome({
      claimedSuccess,
      summary,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      failureClass: 'recoverable',
      failureCode: processResult.exitCode === 0 ? 'OPENHANDS_EXIT_0' : 'OPENHANDS_EXIT_NONZERO',
      changedFiles,
      diff: changes.diff,
      commandsExecuted: [...commandsExecuted, ...reportedCommands],
      errors: [
        ...reportedErrors,
        ...(processResult.exitCode === 0 ? [] : [`exit:${String(processResult.exitCode)}`]),
      ],
      finalReport: summary,
      request,
    });
  }
}
