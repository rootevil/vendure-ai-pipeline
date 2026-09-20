import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExecutionContext } from '../safety/execution-context.js';
import type { AgentAdapter, AgentRunOutcome } from './agent-adapter.js';
import { diffSnapshots, snapshotWorkspace } from './change-capture.js';
import type { ProcessRunner } from './process-runner.js';
import { SpawnProcessRunner } from './process-runner.js';
import {
  AgentOutputError,
  malformedOutcome,
  parseAgentResultJson,
  tryParseOpenHandsJsonl,
} from './result-parser.js';
import { buildStructuredTaskPrompt } from './task-prompt.js';

export interface OpenHandsAgentAdapterOptions {
  readonly command?: string;
  readonly timeoutMs: number;
  readonly runner?: ProcessRunner;
  readonly extraArgs?: readonly string[];
}

/**
 * Thin adapter around the OpenHands CLI (open-source agent framework).
 * Does not implement an LLM. Final PASS/BLOCK remains with the validator.
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
    this.runner = options.runner ?? new SpawnProcessRunner();
    this.extraArgs = options.extraArgs ?? [];
  }

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    mkdirSync(context.workspaceDir, { recursive: true });
    const briefPath = join(context.workspaceDir, 'task-brief.md');
    const resultPath = join(context.workspaceDir, 'agent-result.json');
    writeFileSync(briefPath, buildStructuredTaskPrompt(context.task, context.workspaceDir), 'utf8');

    const before = snapshotWorkspace(context.workspaceDir);
    context.logger.info('invoking OpenHands CLI', {
      command: this.command,
      timeoutMs: this.timeoutMs,
      workspace: context.workspaceDir,
    });

    const processResult = await this.runner.run({
      command: this.command,
      args: ['--headless', '--json', '-f', briefPath, ...this.extraArgs],
      cwd: context.workspaceDir,
      env: {
        ...process.env,
        // Keep credentials out of adapter logs; runtime may inject LLM_* separately.
        PIPELINE_AGENT_WORKSPACE: context.workspaceDir,
        PIPELINE_TASK_ID: context.task.id,
      },
      timeoutMs: this.timeoutMs,
    });

    if (processResult.timedOut) {
      return {
        claimedSuccess: false,
        summary: `OpenHands timed out after ${this.timeoutMs}ms`,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        failureClass: 'recoverable',
        failureCode: 'AGENT_TIMEOUT',
        changedFiles: [],
        diff: '',
      };
    }

    if (processResult.exitCode === null && processResult.signal === null) {
      return {
        claimedSuccess: false,
        summary: 'OpenHands CLI failed to start (is openhands installed and on PATH?)',
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        failureClass: 'non_recoverable',
        failureCode: 'OPENHANDS_NOT_AVAILABLE',
        changedFiles: [],
        diff: '',
      };
    }

    const after = snapshotWorkspace(context.workspaceDir);
    const changes = diffSnapshots(before, after);

    let envelopeSummary: string | null = null;
    let claimedSuccess = processResult.exitCode === 0;
    let reportedFiles: readonly string[] | undefined;

    try {
      if (existsSync(resultPath)) {
        const parsed = parseAgentResultJson(readFileSync(resultPath, 'utf8'));
        envelopeSummary = parsed.summary;
        claimedSuccess = parsed.claimed_success;
        reportedFiles = parsed.changed_files;
      } else {
        const fromJsonl = tryParseOpenHandsJsonl(processResult.stdout);
        if (fromJsonl) {
          envelopeSummary = fromJsonl.summary;
          claimedSuccess = fromJsonl.claimed_success;
          reportedFiles = fromJsonl.changed_files;
        }
      }
    } catch (error) {
      if (error instanceof AgentOutputError) {
        return malformedOutcome({
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          message: error.message,
          code: error.code,
        });
      }
      throw error;
    }

    const changedFiles = reportedFiles ?? changes.changedFiles;
    for (const file of changedFiles) {
      // Enforce allowlist; throws SafetyError which controller handles.
      if (!file.includes('..')) {
        try {
          context.assertWritablePath(file);
        } catch {
          return {
            claimedSuccess: false,
            summary: `OpenHands changed a path outside the write allowlist: ${file}`,
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            failureClass: 'non_recoverable',
            failureCode: 'PATH_ESCAPE',
            changedFiles: [],
            diff: changes.diff,
          };
        }
      }
    }

    return {
      claimedSuccess,
      summary:
        envelopeSummary ??
        (processResult.exitCode === 0
          ? 'OpenHands exited successfully (validator still decides PASS/BLOCK)'
          : `OpenHands exited with code ${String(processResult.exitCode)}`),
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      failureClass: processResult.exitCode === 0 ? 'recoverable' : 'recoverable',
      failureCode: processResult.exitCode === 0 ? 'OPENHANDS_EXIT_0' : 'OPENHANDS_EXIT_NONZERO',
      changedFiles,
      diff: changes.diff,
    };
  }
}
