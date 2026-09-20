import type { TaskDefinition } from '../models/types.js';

/**
 * Builds a structured task brief for OpenHands / mock agents.
 * Deliberately omits any instruction that the agent may declare Pipeline PASS/BLOCK.
 */
export function buildStructuredTaskPrompt(task: TaskDefinition, workspaceDir: string): string {
  return [
    '# Pipeline task brief',
    '',
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Goal: ${task.goal}`,
    `Mode: ${task.mode}`,
    `Workspace: ${workspaceDir}`,
    '',
    '## Write allowlist (relative to workspace)',
    ...(task.writeAllowlist.length > 0
      ? task.writeAllowlist.map((path) => `- ${path}`)
      : ['- (none; do not modify files)']),
    '',
    '## Source paths',
    ...(task.sourcePaths.length > 0 ? task.sourcePaths.map((path) => `- ${path}`) : ['- (none)']),
    '',
    '## Stages',
    ...task.stages.flatMap((stage) => [
      `### ${stage.id}: ${stage.description}`,
      'Preconditions:',
      ...stage.preconditions.map((item) => `- ${item}`),
      'Actions:',
      ...stage.actions.map((item) => `- ${item}`),
      'Expected checks:',
      ...stage.expectedChecks.map((item) => `- ${item}`),
      'Cleanup:',
      ...stage.cleanup.map((item) => `- ${item}`),
      '',
    ]),
    '## Circuit-break rules',
    ...task.circuitBreakRules.map((rule) => `- ${rule}`),
    '',
    '## Hard constraints',
    '- Stay inside the workspace and write allowlist.',
    '- Do not access production systems or request secrets.',
    '- Do not declare Pipeline PASS, BLOCK, or final acceptance.',
    '- The independent pipeline validator decides the final result.',
    '- When finished, write agent-result.json in the workspace root with shape:',
    '  {"summary":"string","claimed_success":true|false,"changed_files":["optional"]}',
    '- Do not include status, pipeline_status, pass, or block fields in agent-result.json.',
    '',
  ].join('\n');
}
