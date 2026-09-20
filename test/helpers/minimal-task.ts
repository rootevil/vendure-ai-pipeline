import type { TaskDefinition } from '../../src/models/types.js';

/** Shared valid Phase 4 task skeleton for unit tests. */
export function minimalTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: 'catalog',
    title: 'Catalog',
    goal: 'Migrate catalog',
    acceptanceCriteria: ['Adapter transforms active records'],
    allowedTools: ['filesystem', 'mock'],
    timeoutMs: 60_000,
    retryPolicy: {
      maxIdenticalRetries: 3,
      maxTotalAttempts: 5,
    },
    validationSteps: [{ id: 'evidence', type: 'evidence_present' }],
    mode: 'acceptance',
    sourcePaths: [],
    writeAllowlist: ['src'],
    requiredEvidence: [
      'run-manifest.json',
      'status.json',
      'stdout.log',
      'stderr.log',
      'change-summary.md',
      'rollback.md',
      'summary.md',
    ],
    stages: [
      {
        id: 'one',
        description: 'Implement adapter',
        preconditions: [],
        actions: [],
        expectedChecks: [],
        cleanup: [],
      },
    ],
    circuitBreakRules: [],
    cleanupWorkspace: false,
    ...overrides,
  };
}
