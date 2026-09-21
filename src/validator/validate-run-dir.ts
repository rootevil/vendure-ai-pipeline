import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { RunStatus } from '../models/types.js';

export interface ValidateRunDirInput {
  readonly runDir: string;
}

export interface ValidateRunDirResult {
  readonly status: RunStatus;
  readonly exitCode: number;
  readonly notes: readonly string[];
  readonly runId: string | null;
}

const TERMINAL_PASS: ReadonlySet<string> = new Set(['PASS', 'BASELINE_BLOCKED_EXPECTED']);

/**
 * Artifact-only validator CLI authority.
 * Ignores agent prose; requires status.json + evidence presence; optionally audits checks.
 */
export function validateRunDir(input: ValidateRunDirInput): ValidateRunDirResult {
  const notes: string[] = [];
  const runDir = input.runDir;

  if (!existsSync(runDir)) {
    return {
      status: 'BLOCK',
      exitCode: 1,
      notes: [`Run directory missing: ${runDir}`],
      runId: null,
    };
  }

  const agentSummary = readOptional(join(runDir, 'agent-summary.md'));
  if (agentSummary && /pass|success|done/i.test(agentSummary)) {
    notes.push('Agent summary claimed success; ignored for PASS/BLOCK decision');
  }

  const statusPath = join(runDir, 'status.json');
  if (!existsSync(statusPath)) {
    return {
      status: 'BLOCK',
      exitCode: 1,
      notes: [...notes, 'Missing required evidence: status.json'],
      runId: null,
    };
  }

  let statusRaw: { status?: string; run_id?: string; exit_code?: number };
  try {
    statusRaw = JSON.parse(readFileSync(statusPath, 'utf8')) as typeof statusRaw;
  } catch (error) {
    return {
      status: 'BLOCK',
      exitCode: 1,
      notes: [
        ...notes,
        `status.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
      runId: null,
    };
  }

  const status = normalizeStatus(statusRaw.status);
  const runId = typeof statusRaw.run_id === 'string' ? statusRaw.run_id : null;

  const required = resolveRequiredEvidence(runDir);
  const present = listPresentEvidence(runDir);
  const missing = required.filter((name) => !present.has(name));
  if (missing.length > 0) {
    notes.push(`Missing required evidence: ${missing.join(', ')}`);
    return { status: 'BLOCK', exitCode: 1, notes, runId };
  }

  const checkAudit = auditValidationChecks(runDir);
  notes.push(...checkAudit.notes);

  if (!status) {
    notes.push('status.json missing usable status field');
    return { status: 'BLOCK', exitCode: 1, notes, runId };
  }

  // Refuse forgeable PASS: require independent check artifacts with zero failures.
  if (status === 'PASS') {
    if (!checkAudit.audited) {
      notes.push(
        'status.json claims PASS but validation-results.json/validation.json is missing; refusing forgeable PASS',
      );
      return { status: 'BLOCK', exitCode: 1, notes, runId };
    }
    if (checkAudit.checkCount < 1) {
      notes.push('status.json claims PASS but no validation checks were recorded');
      return { status: 'BLOCK', exitCode: 1, notes, runId };
    }
    if (checkAudit.failed.length > 0) {
      notes.push(
        `status.json claims PASS but validation checks failed: ${checkAudit.failed.join(', ')}`,
      );
      return { status: 'BLOCK', exitCode: 1, notes, runId };
    }
  }

  if (status === 'BASELINE_BLOCKED_EXPECTED') {
    // Baseline expected block still requires evidence files; check audit optional.
    notes.push('Artifact validator accepted status=BASELINE_BLOCKED_EXPECTED');
    return { status, exitCode: 0, notes, runId };
  }

  if (TERMINAL_PASS.has(status)) {
    notes.push(`Artifact validator accepted status=${status}`);
    return { status, exitCode: 0, notes, runId };
  }

  notes.push(`Artifact validator blocked on status=${status}`);
  return { status, exitCode: 1, notes, runId };
}

function normalizeStatus(value: unknown): RunStatus | null {
  if (value === 'PASS' || value === 'BLOCK' || value === 'BASELINE_BLOCKED_EXPECTED' || value === 'AUTH_REQUIRED') {
    return value;
  }
  return null;
}

function resolveRequiredEvidence(runDir: string): string[] {
  const taskPath = join(runDir, 'task.json');
  if (existsSync(taskPath)) {
    try {
      const task = JSON.parse(readFileSync(taskPath, 'utf8')) as {
        requiredEvidence?: string[];
      };
      if (Array.isArray(task.requiredEvidence) && task.requiredEvidence.length > 0) {
        return task.requiredEvidence;
      }
    } catch {
      // fall through to defaults
    }
  }
  return [
    'run-manifest.json',
    'status.json',
    'stdout.log',
    'stderr.log',
    'change-summary.md',
    'rollback.md',
    'summary.md',
  ];
}

function listPresentEvidence(runDir: string): Set<string> {
  const present = new Set<string>();
  for (const name of readdirSync(runDir)) {
    present.add(name);
  }
  // Directory markers used by evidence_present defaults
  if (present.has('screenshots')) {
    present.add('screenshots/');
  }
  if (present.has('api-responses')) {
    present.add('api-responses/');
  }
  return present;
}

function auditValidationChecks(runDir: string): {
  failed: string[];
  notes: string[];
  audited: boolean;
  checkCount: number;
} {
  const notes: string[] = [];
  const failed: string[] = [];
  const candidates = ['validation-results.json', 'validation.json'];
  for (const name of candidates) {
    const path = join(runDir, name);
    if (!existsSync(path)) {
      continue;
    }
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      const checks = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { checks?: unknown }).checks)
          ? (raw as { checks: unknown[] }).checks
          : null;
      if (!checks) {
        continue;
      }
      for (const check of checks) {
        if (!check || typeof check !== 'object') {
          continue;
        }
        const record = check as { checkName?: string; status?: string };
        if (record.status === 'FAIL' || record.status === 'ERROR') {
          failed.push(record.checkName ?? 'unknown');
        }
      }
      notes.push(`Audited ${checks.length} checks from ${name}`);
      return { failed, notes, audited: true, checkCount: checks.length };
    } catch (error) {
      notes.push(
        `Unable to audit ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  notes.push('No validation-results.json or validation.json found for audit');
  return { failed, notes, audited: false, checkCount: 0 };
}

function readOptional(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, 'utf8');
}
