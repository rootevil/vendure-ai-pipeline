import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RunStatus } from '../models/types.js';
import {
  UnconfiguredLoadTestAdapter,
  type LoadTestAdapter,
  type LoadTestResult,
} from './load/load-test-adapter.js';
import {
  UnconfiguredRedTeamAdapter,
  type RedTeamAdapter,
  type RedTeamResult,
} from './security/red-team-adapter.js';

export interface ExtendedValidationInput {
  readonly runId: string;
  readonly artifactDir: string;
  readonly workspaceDir: string;
  readonly businessStatus: RunStatus;
  readonly loadTest?: LoadTestAdapter;
  readonly redTeam?: RedTeamAdapter;
  readonly targetUrl?: string;
}

export interface ExtendedValidationReport {
  readonly businessStatus: RunStatus;
  readonly load: LoadTestResult;
  readonly security: RedTeamResult;
  /** True when a configured adapter reported FAIL. NOT_RUN does not block. */
  readonly blocksBusinessPass: boolean;
  readonly summary: string;
}

/**
 * After business validation:
 *   Business validation → Load test → Security/red-team → report files
 *
 * Unconfigured adapters record NOT_RUN. They do not grant or revoke PASS.
 */
export async function runExtendedValidation(
  input: ExtendedValidationInput,
): Promise<ExtendedValidationReport> {
  const loadTest = input.loadTest ?? new UnconfiguredLoadTestAdapter();
  const redTeam = input.redTeam ?? new UnconfiguredRedTeamAdapter();

  const load = await loadTest.run({
    runId: input.runId,
    artifactDir: input.artifactDir,
    workspaceDir: input.workspaceDir,
    businessStatus: input.businessStatus,
    ...(input.targetUrl !== undefined ? { targetUrl: input.targetUrl } : {}),
  });
  const security = await redTeam.run({
    runId: input.runId,
    artifactDir: input.artifactDir,
    workspaceDir: input.workspaceDir,
    businessStatus: input.businessStatus,
  });

  const blocksBusinessPass = load.status === 'FAIL' || security.status === 'FAIL';
  const summary = [
    `Business validation: ${input.businessStatus}.`,
    `Load test (${loadTest.name}): ${load.status} — ${load.summary}`,
    `Security/red-team (${redTeam.name}): ${security.status} — ${security.summary}`,
    blocksBusinessPass
      ? 'A configured load or red-team adapter reported FAIL.'
      : 'NOT_RUN stages are extension points only and do not count as formal load or red-team acceptance.',
  ].join(' ');

  const report: ExtendedValidationReport = {
    businessStatus: input.businessStatus,
    load,
    security,
    blocksBusinessPass,
    summary,
  };

  const loadDir = join(input.artifactDir, 'load');
  const securityDir = join(input.artifactDir, 'security');
  mkdirSync(loadDir, { recursive: true });
  mkdirSync(securityDir, { recursive: true });
  writeJson(join(loadDir, 'result.json'), { adapter: loadTest.name, ...load });
  writeJson(join(securityDir, 'result.json'), { adapter: redTeam.name, ...security });
  writeJson(join(input.artifactDir, 'extended-validation.json'), report);
  return report;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
