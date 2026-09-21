import { z } from 'zod';

/**
 * Client-shaped technical scenario produced by the PM / E2E Scenario Compiler.
 * Business goal cards compile into this before (or alongside) the runnable TaskDefinition.
 */
export const TechnicalCheckSchema = z.object({
  id: z.string().min(1),
  /** Human-readable metric derived from a business acceptance bullet. */
  description: z.string().min(1),
  /** Originating business acceptance text, when applicable. */
  fromAcceptance: z.string().min(1).optional(),
  /** Independent validator step type when this check is executable. */
  validationType: z
    .enum([
      'evidence_present',
      'application_health',
      'http_response',
      'graphql_request',
      'browser_playwright',
      'browser_journey',
      'database_state',
      'workspace_file_exists',
      'workspace_file_contains',
      'changed_files_include',
      'path_invariant',
      'redis_ping',
      'postgres_ready',
    ])
    .optional(),
  /** Technical parameters for the validator (URL, query, selector, …). */
  params: z.record(z.unknown()).default({}),
  /** Evidence artifacts this check should leave. */
  evidence: z.array(z.string().min(1)).default([]),
});

export type TechnicalCheck = z.infer<typeof TechnicalCheckSchema>;

export const TechnicalScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  /** Business acceptance bullets preserved for audit. */
  acceptance: z.array(z.string().min(1)).min(1),
  environment: z.object({
    target: z.string().min(1),
    baseUrl: z.string().optional(),
    storefrontUrl: z.string().optional(),
    shopApiUrl: z.string().optional(),
    adminApiUrl: z.string().optional(),
  }),
  preconditions: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)).default([]),
  /** Cross-cutting / logical assertions (not tied to one transport). */
  assertions: z.array(TechnicalCheckSchema).default([]),
  browserChecks: z.array(TechnicalCheckSchema).default([]),
  apiChecks: z.array(TechnicalCheckSchema).default([]),
  databaseChecks: z.array(TechnicalCheckSchema).default([]),
  /** Required evidence filenames / artifact kinds. */
  evidenceRequirements: z.array(z.string().min(1)).default([]),
  cleanup: z.array(z.string().min(1)).default([]),
  rollback: z.array(z.string().min(1)).default([]),
  /** Circuit-break / safe-stop conditions. */
  stopConditions: z.array(z.string().min(1)).default([]),
  writeAllowlist: z.array(z.string().min(1)).default([]),
  mode: z.enum(['baseline', 'acceptance', 'full']).default('acceptance'),
  timeoutMs: z.number().int().positive().default(300_000),
});

export type TechnicalScenario = z.infer<typeof TechnicalScenarioSchema>;
