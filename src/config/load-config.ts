import { z } from 'zod';

import { RunModeSchema } from '../models/types.js';

const BooleanFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  });

const PositiveIntFromEnv = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') {
        return fallback;
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Expected a positive integer, received: ${value}`);
      }
      return parsed;
    });

const CsvPaths = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined || value.trim() === '') {
      return [] as string[];
    }
    return value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  });

const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const AgentModeSchema = z.enum(['mock', 'openhands', 'noop']);
const MockBehaviorSchema = z.enum([
  'success',
  'failure',
  'timeout',
  'retryable',
  'malformed',
  'forbidden_verdict',
]);

const PipelineConfigSchema = z.object({
  mode: RunModeSchema.default('acceptance'),
  artifactsDir: z.string().min(1).default('./runs'),
  workspaceDir: z.string().min(1).default('./workspace'),
  maxIdenticalRetries: z.number().int().positive().default(3),
  maxTotalAttempts: z.number().int().positive().default(5),
  allowNetwork: z.boolean().default(false),
  logLevel: LogLevelSchema.default('info'),
  runId: z.string().optional(),
  writeAllowlist: z.array(z.string()).default([]),
  agentMode: AgentModeSchema.default('mock'),
  agentTimeoutMs: z.number().int().positive().default(120_000),
  openhandsCommand: z.string().min(1).default('openhands'),
  mockAgentBehavior: MockBehaviorSchema.default('success'),
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type AgentMode = z.infer<typeof AgentModeSchema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function readEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return {
    mode: env.PIPELINE_MODE,
    artifactsDir: env.PIPELINE_ARTIFACTS_DIR,
    workspaceDir: env.PIPELINE_WORKSPACE_DIR,
    maxIdenticalRetriesRaw: env.PIPELINE_MAX_IDENTICAL_RETRIES,
    maxTotalAttemptsRaw: env.PIPELINE_MAX_TOTAL_ATTEMPTS,
    allowNetworkRaw: env.PIPELINE_ALLOW_NETWORK,
    logLevel: env.PIPELINE_LOG_LEVEL,
    runId: env.PIPELINE_RUN_ID,
    writeAllowlistRaw: env.PIPELINE_WRITE_ALLOWLIST,
    agentMode: env.PIPELINE_AGENT_MODE,
    agentTimeoutMsRaw: env.PIPELINE_AGENT_TIMEOUT_MS,
    openhandsCommand: env.PIPELINE_OPENHANDS_COMMAND,
    mockAgentBehavior: env.PIPELINE_MOCK_AGENT_BEHAVIOR,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  try {
    const raw = readEnv(env);
    const maxIdenticalRetries = PositiveIntFromEnv(3).parse(raw.maxIdenticalRetriesRaw);
    const maxTotalAttempts = PositiveIntFromEnv(5).parse(raw.maxTotalAttemptsRaw);
    const allowNetwork = BooleanFromEnv.parse(raw.allowNetworkRaw);
    const writeAllowlist = CsvPaths.parse(raw.writeAllowlistRaw);
    const agentTimeoutMs = PositiveIntFromEnv(120_000).parse(raw.agentTimeoutMsRaw);

    const parsed = PipelineConfigSchema.parse({
      mode: raw.mode && raw.mode.length > 0 ? raw.mode : undefined,
      artifactsDir: raw.artifactsDir && raw.artifactsDir.length > 0 ? raw.artifactsDir : undefined,
      workspaceDir: raw.workspaceDir && raw.workspaceDir.length > 0 ? raw.workspaceDir : undefined,
      maxIdenticalRetries,
      maxTotalAttempts,
      allowNetwork,
      logLevel: raw.logLevel && raw.logLevel.length > 0 ? raw.logLevel : undefined,
      runId: raw.runId && raw.runId.length > 0 ? raw.runId : undefined,
      writeAllowlist,
      agentMode: raw.agentMode && raw.agentMode.length > 0 ? raw.agentMode : undefined,
      agentTimeoutMs,
      openhandsCommand:
        raw.openhandsCommand && raw.openhandsCommand.length > 0 ? raw.openhandsCommand : undefined,
      mockAgentBehavior:
        raw.mockAgentBehavior && raw.mockAgentBehavior.length > 0
          ? raw.mockAgentBehavior
          : undefined,
    });

    if (parsed.maxIdenticalRetries > parsed.maxTotalAttempts) {
      throw new ConfigError(
        'PIPELINE_MAX_IDENTICAL_RETRIES cannot exceed PIPELINE_MAX_TOTAL_ATTEMPTS',
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Invalid pipeline configuration: ${message}`);
  }
}
