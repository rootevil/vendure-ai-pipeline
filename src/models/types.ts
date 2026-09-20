import { z } from 'zod';

export const RunModeSchema = z.enum(['baseline', 'acceptance', 'full']);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RunStatusSchema = z.enum([
  'PASS',
  'BLOCK',
  'BASELINE_BLOCKED_EXPECTED',
  'AUTH_REQUIRED',
  'ERROR',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const FailureClassSchema = z.enum([
  'recoverable',
  'non_recoverable',
  'auth_required',
  'unknown',
]);
export type FailureClass = z.infer<typeof FailureClassSchema>;

/** Phase 7 bounded-recovery taxonomy. */
export const FailureKindSchema = z.enum([
  'transient_infrastructure',
  'recoverable_implementation',
  'validation',
  'timeout',
  'repeated',
  'unsafe_unknown',
]);
export type FailureKind = z.infer<typeof FailureKindSchema>;

export const AllowedToolSchema = z.enum(['filesystem', 'git', 'node_test', 'mock', 'openhands']);
export type AllowedTool = z.infer<typeof AllowedToolSchema>;

export const TaskRetryPolicySchema = z.object({
  maxIdenticalRetries: z.number().int().positive().max(20),
  maxTotalAttempts: z.number().int().positive().max(50),
});
export type TaskRetryPolicy = z.infer<typeof TaskRetryPolicySchema>;

export const ValidationCheckStatusSchema = z.enum(['PASS', 'FAIL', 'ERROR']);
export type ValidationCheckStatus = z.infer<typeof ValidationCheckStatusSchema>;

export const ValidationStepSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('evidence_present'),
    files: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('workspace_file_exists'),
    path: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('workspace_file_contains'),
    path: z.string().min(1),
    contains: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('changed_files_include'),
    path: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('application_health'),
    url: z.string().url(),
    expectStatus: z.number().int().min(100).max(599).default(200),
    timeoutMs: z.number().int().positive().max(120_000).default(10_000),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('http_response'),
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    headers: z.record(z.string()).default({}),
    body: z.string().optional(),
    expectStatus: z.number().int().min(100).max(599),
    expectBodyContains: z.string().optional(),
    timeoutMs: z.number().int().positive().max(120_000).default(10_000),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('graphql_request'),
    url: z.string().url(),
    query: z.string().min(1),
    variables: z.record(z.unknown()).default({}),
    headers: z.record(z.string()).default({}),
    expectNoErrors: z.boolean().default(true),
    expectDataPath: z.string().min(1).optional(),
    expectDataEquals: z.unknown().optional(),
    timeoutMs: z.number().int().positive().max(120_000).default(10_000),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('database_state'),
    driver: z.enum(['json_fixture', 'postgres']).default('json_fixture'),
    /** Workspace-relative JSON fixture path when driver is json_fixture. */
    fixturePath: z.string().min(1).optional(),
    /** Connection string or env var reference for postgres driver. */
    connectionString: z.string().min(1).optional(),
    /** JSON path (dot notation) or SQL SELECT depending on driver. */
    query: z.string().min(1),
    expectEquals: z.unknown().optional(),
    expectRowCount: z.number().int().nonnegative().optional(),
    expectContains: z.unknown().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('browser_playwright'),
    url: z.string().url(),
    expectTitleContains: z.string().min(1).optional(),
    expectSelector: z.string().min(1).optional(),
    expectTextContains: z.string().min(1).optional(),
    screenshotName: z.string().min(1).default('browser.png'),
    timeoutMs: z.number().int().positive().max(120_000).default(15_000),
  }),
]);
export type ValidationStep = z.infer<typeof ValidationStepSchema>;

export const TaskStageSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  preconditions: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
  expectedChecks: z.array(z.string()).default([]),
  cleanup: z.array(z.string()).default([]),
});
export type TaskStage = z.infer<typeof TaskStageSchema>;

export const TaskDefinitionSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(256),
    goal: z.string().min(1).max(4000),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    allowedTools: z.array(AllowedToolSchema).min(1),
    timeoutMs: z.number().int().positive().max(3_600_000),
    retryPolicy: TaskRetryPolicySchema,
    validationSteps: z.array(ValidationStepSchema).min(1),
    mode: RunModeSchema.default('acceptance'),
    sourcePaths: z.array(z.string().min(1)).default([]),
    writeAllowlist: z.array(z.string().min(1)).default([]),
    requiredEvidence: z
      .array(z.string().min(1))
      .default([
        'run-manifest.json',
        'status.json',
        'stdout.log',
        'stderr.log',
        'change-summary.md',
        'rollback.md',
        'summary.md',
      ]),
    stages: z.array(TaskStageSchema).min(1),
    circuitBreakRules: z.array(z.string()).default([]),
    cleanupWorkspace: z.boolean().default(true),
  })
  .superRefine((task, ctx) => {
    if (task.retryPolicy.maxIdenticalRetries > task.retryPolicy.maxTotalAttempts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'retryPolicy.maxIdenticalRetries cannot exceed maxTotalAttempts',
        path: ['retryPolicy', 'maxIdenticalRetries'],
      });
    }
  });
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

export interface AttemptRecord {
  readonly attempt: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly failureClass: FailureClass;
  readonly failureKind: FailureKind;
  readonly signature: string;
  readonly message: string;
  readonly agentClaimedSuccess: boolean;
}

export interface ValidationCheckResult {
  readonly checkName: string;
  readonly status: ValidationCheckStatus;
  readonly expected: string;
  readonly actual: string;
  readonly timestamp: string;
  readonly output: string;
  readonly evidencePath: string;
}

export interface ValidationStepResult {
  readonly id: string;
  readonly type: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly checkName: string;
  readonly status: ValidationCheckStatus;
  readonly expected: string;
  readonly actual: string;
  readonly timestamp: string;
  readonly output: string;
  readonly evidencePath: string;
}

export interface ExecutionReport {
  readonly runId: string;
  readonly taskId: string;
  readonly status: RunStatus;
  readonly exitCode: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly goal: string;
  readonly acceptanceCriteria: readonly string[];
  readonly allowedTools: readonly AllowedTool[];
  readonly timeoutMs: number;
  readonly retryPolicy: TaskRetryPolicy;
  readonly flow: readonly string[];
  readonly attempts: readonly AttemptRecord[];
  readonly changedFiles: readonly string[];
  readonly validationSteps: readonly ValidationStepResult[];
  readonly validationChecks: readonly ValidationCheckResult[];
  readonly validatorNotes: readonly string[];
  readonly agentSummary: string | null;
  readonly artifactDir: string;
  readonly workspaceCleaned: boolean;
  readonly reportPath: string;
}

export interface RunResult {
  readonly runId: string;
  readonly mode: RunMode;
  readonly status: RunStatus;
  readonly taskId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly artifactDir: string;
  readonly attempts: readonly AttemptRecord[];
  readonly validatorNotes: readonly string[];
  readonly agentSummary: string | null;
  readonly exitCode: number;
  readonly changedFiles: readonly string[];
  readonly validationSteps: readonly ValidationStepResult[];
  readonly validationChecks: readonly ValidationCheckResult[];
  readonly report: ExecutionReport | null;
  readonly workspaceCleaned: boolean;
  readonly evidenceManifest: EvidenceManifest | null;
}

export interface RunManifest {
  readonly run_id: string;
  readonly mode: RunMode;
  readonly task_id: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly network_used: boolean;
  readonly secrets_used: boolean;
  readonly attempts: number;
  readonly max_identical_retries: number;
  readonly status: RunStatus;
}

export type EvidenceFileType =
  | 'result'
  | 'task'
  | 'log'
  | 'validation'
  | 'screenshot'
  | 'api_response'
  | 'test_result'
  | 'diff'
  | 'summary'
  | 'rollback'
  | 'manifest'
  | 'other';

export interface EvidenceManifestEntry {
  readonly path: string;
  readonly type: EvidenceFileType;
  readonly description: string;
  readonly present: boolean;
}

export interface EvidenceManifest {
  readonly runId: string;
  readonly status: RunStatus;
  readonly generatedAt: string;
  readonly runDirectory: string;
  readonly entries: readonly EvidenceManifestEntry[];
}
