import type { ProcessRunner, ProcessRunRequest, ProcessRunResult } from '../agent/process-runner.js';
import { SpawnProcessRunner } from '../agent/process-runner.js';
import { defaultSafetyKernel, type SafetyKernel } from './safety-kernel.js';

/**
 * Process runner that refuses non-approved / destructive commands before spawn.
 */
export class GuardingProcessRunner implements ProcessRunner {
  private readonly inner: ProcessRunner;
  private readonly kernel: SafetyKernel;

  constructor(options?: { readonly inner?: ProcessRunner; readonly kernel?: SafetyKernel }) {
    this.inner = options?.inner ?? new SpawnProcessRunner();
    this.kernel = options?.kernel ?? defaultSafetyKernel;
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.kernel.assertActionAllowed('run_approved_commands');
    this.kernel.assertCommandApproved(request.command, request.args);
    return this.inner.run(request);
  }
}
