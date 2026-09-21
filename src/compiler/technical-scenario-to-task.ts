import type { TaskDefinition, TaskStage, ValidationStep } from '../models/types.js';
import type { TechnicalCheck, TechnicalScenario } from './technical-scenario.js';

/**
 * Project a client-shaped technical scenario onto the runnable TaskDefinition
 * consumed by the pipeline controller / independent validator.
 */
export function technicalScenarioToTaskDefinition(
  scenario: TechnicalScenario,
  sourcePaths: readonly string[] = [],
): TaskDefinition {
  const validationSteps: ValidationStep[] = [];
  const allChecks = [
    ...scenario.assertions,
    ...scenario.browserChecks,
    ...scenario.apiChecks,
    ...scenario.databaseChecks,
  ];

  for (const check of allChecks) {
    const step = technicalCheckToValidationStep(check);
    if (step) {
      validationSteps.push(step);
    }
  }

  if (!validationSteps.some((s) => s.type === 'evidence_present')) {
    validationSteps.unshift({ id: 'evidence', type: 'evidence_present' });
  }

  const stages: TaskStage[] = [
    {
      id: 'preconditions',
      description: 'Satisfy scenario preconditions before agent work',
      preconditions: [...scenario.preconditions],
      actions: ['Verify isolation and allowlists'],
      expectedChecks: ['preconditions recorded'],
      cleanup: [],
    },
    {
      id: 'agent-actions',
      description: 'Execute autonomous engineering actions toward the business goal',
      preconditions: ['Workspace ready'],
      actions: [...scenario.actions],
      expectedChecks: ['Reviewable diffs and logs'],
      cleanup: [],
    },
    {
      id: 'independent-validate',
      description: 'Independent validator evaluates browser/API/database/assertion metrics',
      preconditions: validationSteps.map((s) => `check:${s.id}`),
      actions: ['Run validationSteps', 'Write evidence pack'],
      expectedChecks: ['PASS only when all independent checks succeed'],
      cleanup: [...scenario.cleanup],
    },
  ];

  for (const bullet of scenario.acceptance) {
    stages.push({
      id: `accept-${slug(bullet)}`,
      description: `Business acceptance: ${bullet}`,
      preconditions: [`goal: ${summarize(scenario.goal)}`],
      actions: scenario.actions.filter((a) => a.toLowerCase().includes(bullet.split(' ')[0] ?? '')),
      expectedChecks: allChecks
        .filter((c) => c.fromAcceptance === bullet)
        .map((c) => c.id),
      cleanup: [],
    });
  }

  return {
    id: scenario.id,
    title: scenario.title,
    goal: scenario.goal,
    acceptanceCriteria: [...scenario.acceptance],
    allowedTools: ['filesystem', 'mock', 'openhands', 'node_test'],
    timeoutMs: scenario.timeoutMs,
    retryPolicy: {
      maxIdenticalRetries: 2,
      maxTotalAttempts: 4,
    },
    validationSteps,
    mode: scenario.mode,
    sourcePaths: [...sourcePaths],
    writeAllowlist: [...scenario.writeAllowlist],
    requiredEvidence: [...scenario.evidenceRequirements].filter((e) => !e.endsWith('/')),
    stages,
    circuitBreakRules: [...scenario.stopConditions],
    cleanupWorkspace: true,
  };
}

function technicalCheckToValidationStep(check: TechnicalCheck): ValidationStep | null {
  if (!check.validationType) {
    return null;
  }
  const p = check.params;
  switch (check.validationType) {
    case 'evidence_present':
      return {
        id: check.id,
        type: 'evidence_present',
        files: Array.isArray(p.files) ? (p.files as string[]) : undefined,
      };
    case 'application_health':
      return {
        id: check.id,
        type: 'application_health',
        url: String(p.url),
        expectStatus: Number(p.expectStatus ?? 200),
        timeoutMs: Number(p.timeoutMs ?? 10_000),
      };
    case 'http_response':
      return {
        id: check.id,
        type: 'http_response',
        url: String(p.url),
        method: (p.method as 'GET') ?? 'GET',
        headers: (p.headers as Record<string, string>) ?? {},
        expectStatus: Number(p.expectStatus ?? 200),
        expectBodyContains: p.expectBodyContains ? String(p.expectBodyContains) : undefined,
        timeoutMs: Number(p.timeoutMs ?? 10_000),
      };
    case 'graphql_request':
      return {
        id: check.id,
        type: 'graphql_request',
        url: String(p.url),
        query: String(p.query),
        variables: (p.variables as Record<string, unknown>) ?? {},
        headers: (p.headers as Record<string, string>) ?? {},
        expectNoErrors: p.expectNoErrors !== false,
        expectDataPath: p.expectDataPath ? String(p.expectDataPath) : undefined,
        expectDataEquals: p.expectDataEquals,
        timeoutMs: Number(p.timeoutMs ?? 10_000),
      };
    case 'browser_playwright':
      return {
        id: check.id,
        type: 'browser_playwright',
        url: String(p.url),
        expectTitleContains: p.expectTitleContains ? String(p.expectTitleContains) : undefined,
        expectSelector: p.expectSelector ? String(p.expectSelector) : undefined,
        expectTextContains: p.expectTextContains ? String(p.expectTextContains) : undefined,
        screenshotName: String(p.screenshotName ?? `${check.id}.png`),
        timeoutMs: Number(p.timeoutMs ?? 15_000),
      };
    case 'database_state':
      return {
        id: check.id,
        type: 'database_state',
        driver: (p.driver as 'json_fixture' | 'postgres') ?? 'json_fixture',
        fixturePath: p.fixturePath ? String(p.fixturePath) : undefined,
        connectionString: p.connectionString ? String(p.connectionString) : undefined,
        query: String(p.query ?? 'count'),
        expectEquals: p.expectEquals,
        expectRowCount: p.expectRowCount !== undefined ? Number(p.expectRowCount) : undefined,
        expectContains: p.expectContains,
      };
    case 'workspace_file_contains':
      return {
        id: check.id,
        type: 'workspace_file_contains',
        path: String(p.path),
        contains: String(p.contains),
      };
    case 'workspace_file_exists':
      return {
        id: check.id,
        type: 'workspace_file_exists',
        path: String(p.path),
      };
    case 'changed_files_include':
      return {
        id: check.id,
        type: 'changed_files_include',
        path: String(p.path),
      };
    case 'path_invariant':
      return {
        id: check.id,
        type: 'path_invariant',
        root: String(p.root),
        requiredRelativePaths: (p.requiredRelativePaths as string[]) ?? [],
        minFiles: p.minFiles !== undefined ? Number(p.minFiles) : undefined,
        allowedExtensions: (p.allowedExtensions as string[]) ?? [
          '.jpg',
          '.jpeg',
          '.png',
          '.JPG',
          '.JPEG',
          '.PNG',
        ],
      };
    case 'redis_ping':
      return {
        id: check.id,
        type: 'redis_ping',
        url: p.url ? String(p.url) : undefined,
        timeoutMs: Number(p.timeoutMs ?? 5_000),
      };
    case 'postgres_ready':
      return {
        id: check.id,
        type: 'postgres_ready',
        connectionString: p.connectionString ? String(p.connectionString) : undefined,
        timeoutMs: Number(p.timeoutMs ?? 5_000),
      };
    default:
      return null;
  }
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'step'
  );
}

function summarize(goal: string): string {
  const oneLine = goal.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}
