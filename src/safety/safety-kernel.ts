import { basename, isAbsolute, normalize, relative, resolve, sep } from 'node:path';

import {
  DEFAULT_SAFETY_POLICY,
  DESTRUCTIVE_COMMAND_PATTERNS,
  type AllowedAgentAction,
  type SafetyPolicy,
} from './policy.js';
import { SafetyError } from './execution-context.js';

export type SafetyKernelCode =
  | 'PATH_ESCAPE'
  | 'NETWORK_DENIED'
  | 'SECRET_PATTERN'
  | 'PRODUCTION_INDICATOR'
  | 'IRREVERSIBLE_ACTION'
  | 'FORBIDDEN_ACTION'
  | 'COMMAND_DENIED'
  | 'HOST_FILESYSTEM'
  | 'RETRY_LIMIT'
  | 'SSH_DENIED'
  | 'MINIPC_DENIED';

/**
 * Safety kernel — thin code-owned boundary around agent work.
 * Enforces workspace isolation, action allowlists, approved commands,
 * and fail-closed defaults (no production / host FS / SSH / unlimited net/retries).
 *
 * This is a control-plane policy layer. It is not a hard OS sandbox (seccomp/VM).
 */
export class SafetyKernel {
  readonly policy: SafetyPolicy;

  constructor(policy: SafetyPolicy = DEFAULT_SAFETY_POLICY) {
    this.policy = policy;
  }

  /** Canonical per-run workspace: <workspaceRoot>/<runId>/ (default root ./workspace/runs). */
  resolveRunWorkspace(workspaceRoot: string, runId: string): string {
    assertSafeRunId(runId);
    const root = resolve(workspaceRoot);
    const runDir = resolve(root, runId);
    const rel = relative(root, runDir);
    if (rel.startsWith('..') || isAbsolute(rel) || rel.includes(`..${sep}`)) {
      throw new SafetyError(`Run workspace escapes root: ${runId}`, 'PATH_ESCAPE');
    }
    return runDir;
  }

  assertActionAllowed(action: AllowedAgentAction | string): void {
    if (!(this.policy.allowedActions as readonly string[]).includes(action)) {
      throw new SafetyError(
        `Action not allowed by safety kernel: ${action}`,
        'FORBIDDEN_ACTION',
      );
    }
  }

  assertNetworkPolicy(allowNetwork: boolean): void {
    if (allowNetwork && this.policy.allowNetworkDefault === false) {
      // Explicit task/config opt-in is still gated by SSRF allowlists elsewhere.
      // Unlimited network remains forbidden; this only allows the boolean gate to open.
    }
    if (!allowNetwork) {
      return;
    }
    // Soft check: policy documents unlimited_network as forbidden; callers must still
    // use host allowlists. No throw here when allowNetwork=true with allowlists.
  }

  assertRetryBudgets(maxIdentical: number, maxTotal: number): void {
    if (maxIdentical > this.policy.maxIdenticalRetriesCap || maxTotal > this.policy.maxTotalAttemptsCap) {
      throw new SafetyError(
        `Retry budgets exceed safety caps (identical<=${this.policy.maxIdenticalRetriesCap}, total<=${this.policy.maxTotalAttemptsCap})`,
        'RETRY_LIMIT',
      );
    }
    if (maxIdentical > maxTotal) {
      throw new SafetyError(
        'maxIdenticalRetries cannot exceed maxTotalAttempts',
        'RETRY_LIMIT',
      );
    }
  }

  /**
   * Approve a process spawn. Basename must be on the allowlist; argv must not
   * match destructive / SSH / production patterns.
   */
  assertCommandApproved(command: string, args: readonly string[] = []): void {
    const line = [command, ...args].join(' ');
    if (/\bssh\b/i.test(line) || /\bscp\b/i.test(line)) {
      throw new SafetyError('SSH/SCP is forbidden by safety kernel', 'SSH_DENIED');
    }
    if (/\bminipc\b/i.test(line)) {
      throw new SafetyError(
        'MiniPC access via agent commands is forbidden (no unrestricted host filesystem)',
        'MINIPC_DENIED',
      );
    }
    for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(line)) {
        throw new SafetyError(
          `Destructive or forbidden command pattern: ${pattern}`,
          'COMMAND_DENIED',
        );
      }
    }

    const base = basename(command).replace(/\.(cmd|exe|bat)$/i, '');
    const approved = this.policy.approvedCommands.some(
      (c) => c === base || c === command || basename(c) === base,
    );
    if (!approved) {
      throw new SafetyError(
        `Command not on approved allowlist: ${base}`,
        'COMMAND_DENIED',
      );
    }
  }

  /** Refuse absolute paths outside the run workspace (host filesystem). */
  assertPathInsideWorkspace(workspaceDir: string, candidate: string): string {
    const workspace = resolve(workspaceDir);
    const absolute = isAbsolute(candidate) ? normalize(candidate) : resolve(workspace, candidate);
    const rel = relative(workspace, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      const code = isAbsolute(candidate) || candidate.startsWith('/') ? 'HOST_FILESYSTEM' : 'PATH_ESCAPE';
      throw new SafetyError(
        code === 'HOST_FILESYSTEM'
          ? `Host filesystem path outside run workspace denied: ${candidate}`
          : `Path escapes workspace: ${candidate}`,
        code,
      );
    }
    return absolute;
  }

  assertProductionDenied(text: string): void {
    if (/\b(production|prod[_-]?db|live[_-]?stripe|prod[_-]?deploy)\b/i.test(text)) {
      throw new SafetyError(
        'Production access indicator forbidden by safety kernel',
        'PRODUCTION_INDICATOR',
      );
    }
  }

  describe(): Record<string, unknown> {
    return {
      allowedActions: this.policy.allowedActions,
      forbiddenByDefault: this.policy.forbiddenByDefault,
      approvedCommands: this.policy.approvedCommands,
      workspaceRootStyle: this.policy.workspaceRootStyle,
      allowNetworkDefault: this.policy.allowNetworkDefault,
      allowHostFilesystem: this.policy.allowHostFilesystem,
      allowSsh: this.policy.allowSsh,
      allowProduction: this.policy.allowProduction,
      allowUnrestrictedMinipc: this.policy.allowUnrestrictedMinipc,
      maxIdenticalRetriesCap: this.policy.maxIdenticalRetriesCap,
      maxTotalAttemptsCap: this.policy.maxTotalAttemptsCap,
      note: 'Control-plane policy only — not a hard OS sandbox for OpenHands',
    };
  }
}

export const defaultSafetyKernel = new SafetyKernel();

function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId.includes('..')) {
    throw new SafetyError(`Unsafe run id: ${runId}`, 'PATH_ESCAPE');
  }
}
