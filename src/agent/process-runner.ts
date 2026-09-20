import { spawn } from 'node:child_process';

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

export class SpawnProcessRunner implements ProcessRunner {
  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const started = Date.now();
    return await new Promise<ProcessRunResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, request.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
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
