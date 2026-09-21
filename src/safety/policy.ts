/**
 * Code-owned safety policy for the adaptive pipeline.
 * Fail closed: anything not explicitly allowed is denied.
 */

export const AllowedAgentActionSchema = [
  'read_source',
  'write_source',
  'run_tests',
  'run_approved_commands',
  'run_browser',
  'query_test_database',
] as const;

export type AllowedAgentAction = (typeof AllowedAgentActionSchema)[number];

export const ForbiddenDefaultSchema = [
  'production_access',
  'host_filesystem',
  'ssh',
  'arbitrary_credentials',
  'destructive_host_commands',
  'unlimited_network',
  'unlimited_retries',
  'minipc_unrestricted',
] as const;

export type ForbiddenDefault = (typeof ForbiddenDefaultSchema)[number];

/** Basename allowlist for agent-spawned processes (fail closed). */
export const DEFAULT_APPROVED_COMMANDS: readonly string[] = [
  'node',
  'npm',
  'npx',
  'openhands',
  'git',
  'tsc',
  'tsx',
  'playwright',
  'psql',
  'redis-cli',
  'pg_isready',
];

/** Substrings / patterns that must never appear in approved command lines. */
export const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\bssh\b/i,
  /\bscp\b/i,
  /\bsudo\b/i,
  /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bchown\s+-R\b/i,
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /\bcurl\b.*\|\s*(sh|bash)/i,
  /\bwget\b.*\|\s*(sh|bash)/i,
  /\bminipc\b/i,
  /\bproduction\b/i,
];

export interface SafetyPolicy {
  readonly allowedActions: readonly AllowedAgentAction[];
  readonly forbiddenByDefault: readonly ForbiddenDefault[];
  readonly approvedCommands: readonly string[];
  /** Workspace root containing per-run dirs: <workspaceRoot>/<runId>/ */
  readonly workspaceRootStyle: 'runs';
  readonly maxIdenticalRetriesCap: number;
  readonly maxTotalAttemptsCap: number;
  readonly allowNetworkDefault: boolean;
  readonly allowHostFilesystem: false;
  readonly allowSsh: false;
  readonly allowProduction: false;
  readonly allowUnrestrictedMinipc: false;
}

export const DEFAULT_SAFETY_POLICY: SafetyPolicy = {
  allowedActions: [...AllowedAgentActionSchema],
  forbiddenByDefault: [...ForbiddenDefaultSchema],
  approvedCommands: DEFAULT_APPROVED_COMMANDS,
  workspaceRootStyle: 'runs',
  maxIdenticalRetriesCap: 10,
  maxTotalAttemptsCap: 20,
  allowNetworkDefault: false,
  allowHostFilesystem: false,
  allowSsh: false,
  allowProduction: false,
  allowUnrestrictedMinipc: false,
};
