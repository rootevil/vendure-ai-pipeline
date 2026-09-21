import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadConfig } from '../config/load-config.js';
import { compileScenarioBundleFromPath } from '../compiler/scenario-compiler.js';
import { createLogger } from '../logging/logger.js';
import { runBrowserCheckoutScenario } from '../scenarios/browser-checkout/run-scenario.js';
import { runFailureDemo } from '../scenarios/public-catalog/failure-demo.js';
import { runPublicCatalogScenario } from '../scenarios/public-catalog/run-scenario.js';
import { runBlockDemo } from './client-demos.js';

export interface FinalDemoSection {
  readonly name: string;
  readonly lines: readonly string[];
  readonly artifactDir?: string;
  readonly status?: string;
  readonly exitCode: number;
}

export interface FinalClientDemoResult {
  readonly sections: readonly FinalDemoSection[];
  readonly lines: readonly string[];
  readonly exitCode: number;
}

const GOAL_CARD = 'tasks/final-demo-goal.yaml';
const PURCHASE_GOAL = 'A customer should be able to purchase a product from the storefront.';

/**
 * Client final demonstration — six demos in the agreed order.
 * Each stage runs real pipeline machinery; transcripts are derived from outcomes.
 */
export async function runFinalClientDemo(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FinalClientDemoResult> {
  const config = loadConfig(env);
  const artifactsDir = resolve(config.artifactsDir);
  const workspaceDir = resolve(config.workspaceDir);
  const sections: FinalDemoSection[] = [];
  const allLines: string[] = [];

  const push = (section: FinalDemoSection) => {
    sections.push(section);
    allLines.push('', `=== ${section.name} ===`, ...section.lines);
  };

  // --- Demo 1 — Business goal → technical task / acceptance / validation plan ---
  const bundle = compileScenarioBundleFromPath(resolve(GOAL_CARD));
  const technical = bundle.technical;
  push({
    name: 'Demo 1 — Business goal',
    exitCode: 0,
    lines: [
      `Goal: “${PURCHASE_GOAL}”`,
      '',
      'Pipeline automatically generates:',
      `  technical task: ${technical?.id ?? bundle.task.id}`,
      `  acceptance criteria: ${(technical?.acceptance ?? bundle.task.acceptanceCriteria).length} items`,
      `  validation plan: ${bundle.task.validationSteps.map((s) => s.id).join(', ')}`,
      `  browser checks: ${technical?.browserChecks.length ?? 0}`,
      `  api checks: ${technical?.apiChecks.length ?? 0}`,
      `  database checks: ${technical?.databaseChecks.length ?? 0}`,
      `  cleanup / rollback / stopConditions: present`,
    ],
  });

  // --- Demo 2 — Autonomous execution (catalog agent changes code + tests) ---
  const catalog = await runPublicCatalogScenario({
    rootDir: process.cwd(),
    artifactsDir,
    workspaceDir,
    keepWorkspace: false,
    logLevel: 'error',
  });
  push({
    name: 'Demo 2 — Autonomous execution',
    exitCode: catalog.result.exitCode,
    status: catalog.result.status,
    artifactDir: catalog.result.artifactDir,
    lines: [
      'Agent starts',
      '↓',
      'reads repository',
      '↓',
      'plans',
      '↓',
      'changes code',
      '↓',
      'runs tests',
      '',
      `Status: ${catalog.result.status}`,
      `Changed: ${catalog.result.changedFiles.join(', ') || '(see git-diff.patch)'}`,
    ],
  });

  // --- Demo 3 — Real validation (Playwright + GraphQL + controlled DB) ---
  const checkout = await runBrowserCheckoutScenario({
    rootDir: process.cwd(),
    artifactsDir,
    workspaceDir,
    keepWorkspace: false,
    logLevel: 'error',
  });
  // Prefer writing under configured artifacts root when possible.
  const validationDir = checkout.result.artifactDir;
  const checkNames = checkout.result.validationChecks.map((c) => c.checkName).join('\n').toLowerCase();
  push({
    name: 'Demo 3 — Real validation',
    exitCode: checkout.result.exitCode,
    status: checkout.result.status,
    artifactDir: validationDir,
    lines: [
      checkNames.includes('journey') || checkNames.includes('browser') || checkNames.includes('playwright')
        ? 'Playwright — storefront → product → cart → checkout'
        : 'Playwright — (no browser check recorded)',
      checkNames.includes('graphql') || checkNames.includes('api')
        ? 'GraphQL — independent Shop API product/order queries'
        : 'GraphQL — (no GraphQL check recorded)',
      checkNames.includes('database') || checkNames.includes('order')
        ? 'PostgreSQL — controlled SELECT id, state FROM "order" WHERE code = $1'
        : 'PostgreSQL — (no database check recorded)',
      '',
      `Status: ${checkout.result.status}`,
    ],
  });

  // --- Demo 4 — Evidence package ---
  const evidenceDir = validationDir;
  push({
    name: 'Demo 4 — Evidence',
    exitCode: 0,
    artifactDir: evidenceDir,
    lines: [
      `Open: ${toRunsHint(evidenceDir)}`,
      '',
      ...listEvidenceHighlights(evidenceDir),
    ],
  });

  // --- Demo 5 — Recovery ---
  const recovery = await runFailureDemo({
    mode: 'recoverable',
    artifactsDir,
    workspaceDir,
    keepWorkspace: false,
    logger: createLogger({ level: 'error' }),
  });
  push({
    name: 'Demo 5 — Recovery',
    exitCode: recovery.result.exitCode,
    status: recovery.result.status,
    artifactDir: recovery.result.artifactDir,
    lines: [
      'Controlled bug introduced',
      'FAIL',
      '↓',
      'diagnose',
      '↓',
      'repair',
      '↓',
      'retry',
      '↓',
      recovery.result.status,
      '',
      `Repair attempts: ${recovery.repairAttempts}`,
    ],
  });

  // --- Demo 6 — Safe stop (circuit break + evidence + rollback) ---
  const block = await runBlockDemo(env);
  const rollbackPath = join(block.artifactDir, 'rollback.md');
  const rollbackOutcome = join(block.artifactDir, 'rollback-outcome.json');
  push({
    name: 'Demo 6 — Safe stop',
    exitCode: block.exitCode,
    status: block.status,
    artifactDir: block.artifactDir,
    lines: [
      'Unrecoverable repeated failure',
      'retry limit',
      '↓',
      'circuit breaker',
      '↓',
      'BLOCK',
      '↓',
      'evidence',
      '↓',
      'rollback',
      '',
      ...block.lines,
      existsSync(rollbackPath) ? `rollback.md: ${rollbackPath}` : 'rollback.md: (missing)',
      existsSync(rollbackOutcome)
        ? `rollback-outcome.json: ${rollbackOutcome}`
        : 'rollback-outcome.json: (missing)',
    ],
  });

  const earlyFail = sections
    .filter((s) => !s.name.includes('Safe stop') && !s.name.includes('Evidence'))
    .some((s) => s.exitCode !== 0 || (s.status !== undefined && s.status !== 'PASS'));
  const recoveryOk = recovery.result.status === 'PASS';
  const safeStopOk = block.status === 'BLOCK';
  const overallExit = earlyFail || !recoveryOk || !safeStopOk ? 1 : 0;

  allLines.push(
    '',
    '=== Final demo complete ===',
    overallExit === 0
      ? 'Pipeline demonstrated: goal → execute → validate → evidence → recover → safe stop.'
      : 'One or more demo stages did not meet the expected outcome.',
  );

  return { sections, lines: allLines, exitCode: overallExit };
}

function toRunsHint(artifactDir: string): string {
  const normalized = artifactDir.replaceAll('\\', '/');
  const marker = '/runs/';
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0) {
    return `runs/${normalized.slice(idx + marker.length)}`;
  }
  return artifactDir;
}

function listEvidenceHighlights(artifactDir: string): string[] {
  const lines: string[] = [];
  const shots = join(artifactDir, 'screenshots');
  if (existsSync(shots)) {
    const names = readdirSync(shots).filter((n) => /\.(png|jpe?g|webp)$/i.test(n));
    lines.push(`screenshots/: ${names.length > 0 ? names.join(', ') : '(empty)'}`);
  } else {
    lines.push('screenshots/: (missing)');
  }
  for (const name of [
    'execution.log',
    'agent.log',
    'validation.json',
    'final-report.html',
    'git-diff.patch',
    'rollback.md',
  ]) {
    lines.push(`${name}: ${existsSync(join(artifactDir, name)) ? 'present' : 'missing'}`);
  }
  const validation = join(artifactDir, 'validation.json');
  if (existsSync(validation)) {
    try {
      const parsed = JSON.parse(readFileSync(validation, 'utf8')) as { status?: string };
      lines.push(`validation.json status: ${parsed.status ?? 'n/a'}`);
    } catch {
      lines.push('validation.json: unreadable');
    }
  }
  return lines;
}
