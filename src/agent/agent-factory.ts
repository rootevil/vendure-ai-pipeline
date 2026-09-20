import type { PipelineConfig } from '../config/load-config.js';
import type { AgentAdapter } from './agent-adapter.js';
import { NoopAgentAdapter } from './agent-adapter.js';
import { MockAgentAdapter, type MockAgentBehavior } from './mock-adapter.js';
import { OpenHandsAgentAdapter } from './openhands-adapter.js';
import type { ProcessRunner } from './process-runner.js';

export type AgentMode = 'mock' | 'openhands' | 'noop';

export interface CreateAgentAdapterOptions {
  readonly config: PipelineConfig;
  readonly runner?: ProcessRunner;
  readonly mockBehavior?: MockAgentBehavior;
}

export function createAgentAdapter(options: CreateAgentAdapterOptions): AgentAdapter {
  const mode = options.config.agentMode;
  switch (mode) {
    case 'noop':
      return new NoopAgentAdapter();
    case 'mock':
      return new MockAgentAdapter({
        behavior: options.mockBehavior ?? options.config.mockAgentBehavior,
        timeoutMs: options.config.agentTimeoutMs,
      });
    case 'openhands':
      return new OpenHandsAgentAdapter({
        command: options.config.openhandsCommand,
        timeoutMs: options.config.agentTimeoutMs,
        ...(options.runner !== undefined ? { runner: options.runner } : {}),
      });
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unsupported agent mode: ${String(exhaustive)}`);
    }
  }
}
