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

export const TaskStageSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  preconditions: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
  expectedChecks: z.array(z.string()).default([]),
  cleanup: z.array(z.string()).default([]),
});
export type TaskStage = z.infer<typeof TaskStageSchema>;

export const TaskDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
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
});
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

export interface AttemptRecord {
  readonly attempt: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly failureClass: FailureClass;
  readonly signature: string;
  readonly message: string;
  readonly agentClaimedSuccess: boolean;
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
