import { z } from 'zod';

/**
 * Human business task card — goal language, not technical instructions.
 * Compiled by the scenario compiler into a machine TaskDefinition.
 */
export const BusinessEnvironmentSchema = z
  .object({
    target: z.string().min(1).default('isolated-vendure'),
    /** Optional base URL; port 0 means “bind ephemeral / rewrite in scenario”. */
    baseUrl: z.string().url().optional(),
    storefrontUrl: z.string().url().optional(),
    shopApiUrl: z.string().url().optional(),
    adminApiUrl: z.string().url().optional(),
  })
  .default({ target: 'isolated-vendure' });

export const BusinessTaskCardSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(256).optional(),
  goal: z.string().min(1).max(4000),
  /** Business acceptance bullets — converted into validationSteps. */
  acceptance: z.array(z.string().min(1)).min(1),
  environment: BusinessEnvironmentSchema,
  /** Optional overrides; compiler supplies safe defaults. */
  mode: z.enum(['baseline', 'acceptance', 'full']).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
  writeAllowlist: z.array(z.string().min(1)).optional(),
  allowedTools: z
    .array(z.enum(['filesystem', 'git', 'node_test', 'mock', 'openhands']))
    .optional(),
});

export type BusinessTaskCard = z.infer<typeof BusinessTaskCardSchema>;
export type BusinessEnvironment = z.infer<typeof BusinessEnvironmentSchema>;
