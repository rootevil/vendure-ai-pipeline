import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ExecutionContext } from '../safety/execution-context.js';
import type { AgentAdapter, AgentRunOutcome } from './agent-adapter.js';
import { diffSnapshots, snapshotWorkspace } from './change-capture.js';
import { AgentOutputError, malformedOutcome, parseAgentResultJson } from './result-parser.js';
import { buildStructuredTaskPrompt } from './task-prompt.js';

export type MockAgentBehavior =
  'success' | 'failure' | 'timeout' | 'retryable' | 'malformed' | 'forbidden_verdict';

export interface MockAgentAdapterOptions {
  readonly behavior?: MockAgentBehavior;
  readonly timeoutMs?: number;
  /** Injectable delay used by timeout behavior (defaults to real setTimeout). */
  readonly delay?: (ms: number) => Promise<void>;
}

/**
 * Deterministic agent for pipeline tests without an external LLM/API.
 * Simulates OpenHands-shaped workspace interaction and agent-result.json.
 */
export class MockAgentAdapter implements AgentAdapter {
  readonly name = 'mock';
  private retryCount = 0;

  constructor(private readonly options: MockAgentAdapterOptions = {}) {}

  async run(context: ExecutionContext): Promise<AgentRunOutcome> {
    const behavior = this.options.behavior ?? 'success';
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const delay = this.options.delay ?? defaultDelay;

    context.logger.info('mock agent starting', { behavior, timeoutMs });
    writeFileSync(
      join(context.workspaceDir, 'task-brief.md'),
      buildStructuredTaskPrompt(context.task, context.workspaceDir),
      'utf8',
    );

    const before = snapshotWorkspace(context.workspaceDir);

    if (behavior === 'timeout') {
      await delay(timeoutMs + 25);
      return {
        claimedSuccess: false,
        summary: 'Mock agent exceeded timeout budget',
        stdout: '',
        stderr: 'mock-agent: timeout',
        failureClass: 'recoverable',
        failureCode: 'AGENT_TIMEOUT',
        changedFiles: [],
        diff: '',
      };
    }

    if (behavior === 'failure') {
      return {
        claimedSuccess: false,
        summary: 'Mock agent failed the task on purpose',
        stdout: 'mock stdout: failure',
        stderr: 'mock stderr: failure',
        failureClass: 'non_recoverable',
        failureCode: 'MOCK_FAILURE',
        changedFiles: [],
        diff: '',
      };
    }

    if (behavior === 'retryable') {
      this.retryCount += 1;
      if (this.retryCount < 2) {
        return {
          claimedSuccess: false,
          summary: 'Mock agent transient failure',
          stdout: 'mock stdout: retryable',
          stderr: 'mock stderr: retryable',
          failureClass: 'recoverable',
          failureCode: 'MOCK_RETRYABLE',
          changedFiles: [],
          diff: '',
        };
      }
      // Fall through to success on second attempt.
    }

    if (behavior === 'malformed') {
      writeFileSync(join(context.workspaceDir, 'agent-result.json'), '{not-json', 'utf8');
      try {
        parseAgentResultJson('{not-json');
        return malformedOutcome({
          stdout: '',
          stderr: 'expected parse failure',
          message: 'Malformed agent output was not rejected',
          code: 'MALFORMED_OUTPUT',
        });
      } catch (error) {
        const message = error instanceof AgentOutputError ? error.message : String(error);
        const code = error instanceof AgentOutputError ? error.code : 'MALFORMED_OUTPUT';
        return malformedOutcome({
          stdout: '{not-json',
          stderr: '',
          message,
          code,
        });
      }
    }

    if (behavior === 'forbidden_verdict') {
      const payload = JSON.stringify({
        summary: 'I declare PASS',
        claimed_success: true,
        status: 'PASS',
      });
      writeFileSync(join(context.workspaceDir, 'agent-result.json'), payload, 'utf8');
      try {
        parseAgentResultJson(payload);
        return malformedOutcome({
          stdout: payload,
          stderr: '',
          message: 'Forbidden pipeline verdict was not rejected',
          code: 'FORBIDDEN_PIPELINE_VERDICT',
        });
      } catch (error) {
        const message = error instanceof AgentOutputError ? error.message : String(error);
        return malformedOutcome({
          stdout: payload,
          stderr: '',
          message,
          code: 'FORBIDDEN_PIPELINE_VERDICT',
        });
      }
    }

    // success (and retryable after first failure)
    const writtenFiles = writeSuccessArtifacts(context);
    const envelope = {
      summary: `Mock agent completed task ${context.task.id}`,
      claimed_success: true,
      changed_files: writtenFiles,
    };
    writeFileSync(
      join(context.workspaceDir, 'agent-result.json'),
      `${JSON.stringify(envelope, null, 2)}\n`,
      'utf8',
    );

    const after = snapshotWorkspace(context.workspaceDir);
    const changes = diffSnapshots(before, after);
    const parsed = parseAgentResultJson(
      JSON.stringify({
        summary: envelope.summary,
        claimed_success: envelope.claimed_success,
        changed_files: envelope.changed_files,
      }),
    );

    return {
      claimedSuccess: parsed.claimed_success,
      summary: parsed.summary,
      stdout: 'mock stdout: success',
      stderr: '',
      failureClass: 'recoverable',
      failureCode: 'MOCK_SUCCESS',
      changedFiles: parsed.changed_files ?? changes.changedFiles,
      diff: changes.diff,
    };
  }
}

function writeSuccessArtifacts(context: ExecutionContext): string[] {
  const written: string[] = [];
  const containsPaths = new Set(
    context.task.validationSteps
      .filter((step) => step.type === 'workspace_file_contains')
      .map((step) => step.path.replace(/^\.\//, '')),
  );

  for (const step of context.task.validationSteps) {
    if (step.type === 'workspace_file_contains') {
      const absolute = context.assertWritablePath(step.path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${step.contains}\n`, 'utf8');
      written.push(step.path.replace(/^\.\//, ''));
    } else if (
      step.type === 'workspace_file_exists' &&
      !containsPaths.has(step.path.replace(/^\.\//, ''))
    ) {
      const absolute = context.assertWritablePath(step.path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `// created for ${context.task.id}\n`, 'utf8');
      written.push(step.path.replace(/^\.\//, ''));
    }
  }
  if (written.length === 0) {
    const targetRel = resolveWritableTarget(context);
    const absolute = context.assertWritablePath(targetRel);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `// mock agent change for ${context.task.id}\n`, 'utf8');
    written.push(targetRel);
  }
  return [...new Set(written)];
}

function resolveWritableTarget(context: ExecutionContext): string {
  const allow = context.writeAllowlist[0] ?? context.task.writeAllowlist[0] ?? 'src';
  return `${allow.replace(/\/$/, '')}/mock-agent-output.txt`;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
