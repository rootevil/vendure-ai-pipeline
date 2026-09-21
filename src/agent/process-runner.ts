import { spawn } from 'node:child_process';

import { truncateAndRedactLog } from '../safety/redaction.js';

export interface ProcessRunRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

export interface ProcessRunResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}

const HARD_CAPTURE_LIMIT = 4 * 1024 * 1024;

export class SpawnProcessRunner implements ProcessRunner {
  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const started = Date.now();
    return await new Promise<ProcessRunResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let truncated = false;

      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, request.timeoutMs);

      const append = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
        const text = chunk.toString();
        if (target === 'stdout') {
          stdout += text;
          if (Buffer.byteLength(stdout, 'utf8') > HARD_CAPTURE_LIMIT) {
            truncated = true;
            child.kill('SIGKILL');
          }
        } else {
          stderr += text;
          if (Buffer.byteLength(stderr, 'utf8') > HARD_CAPTURE_LIMIT) {
            truncated = true;
            child.kill('SIGKILL');
          }
        }
      };

      child.stdout?.on('data', (chunk: Buffer | string) => {
        append('stdout', chunk);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        append('stderr', chunk);
      });

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (truncated) {
          stderr += '\n[process output exceeded 4MB capture limit; killed]\n';
        }
        resolve({
          exitCode,
          signal,
          stdout: truncateAndRedactLog(stdout),
          stderr: truncateAndRedactLog(stderr),
          timedOut: timedOut || truncated,
          durationMs: Date.now() - started,
        });
      };

      child.on('error', (error) => {
        stderr += `${error.message}\n`;
        finish(null, null);
      });
      child.on('close', (code, signal) => {
        finish(code, signal);
      });
    });
  }
}
