import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TaskDefinition } from '../models/types.js';
import type { AgentRequest } from './agent-request.js';

/**
 * Builds a structured task brief for OpenHands / mock agents.
 * Deliberately omits any instruction that the agent may declare Pipeline PASS/BLOCK.
 */
export function buildStructuredTaskPrompt(
  task: TaskDefinition,
  workspaceDir: string,
  request?: AgentRequest,
): string {
  const sections = [
    '# Pipeline task brief',
    '',
    '## Authority (read carefully)',
    '- You are a coding/debugging worker inside an isolated workspace.',
    '- Your claimed_success is informational only.',
    '- Agent success ≠ Pipeline PASS.',
    '- The independent pipeline validator alone decides PASS / BLOCK.',
    '- Do not include status, pipeline_status, pass, or block in agent-result.json.',
    '',
    '## Agent request',
    ...(request
      ? [
          `- task: ${request.taskId} — ${request.title}`,
          `- repository / workspace: ${request.workspace}`,
          `- time limit (ms): ${request.timeLimitMs}`,
          `- retry limit: identical=${request.retryLimit.maxIdenticalRetries}, total=${request.retryLimit.maxTotalAttempts}`,
          `- available tools: ${request.availableTools.join(', ')}`,
          `- pipelineAuthority: ${request.pipelineAuthority}`,
        ]
      : [
          `- Workspace: ${workspaceDir}`,
          `- Timeout ms: ${task.timeoutMs}`,
          `- Retry: identical=${task.retryPolicy.maxIdenticalRetries}, total=${task.retryPolicy.maxTotalAttempts}`,
        ]),
    '',
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Goal: ${task.goal}`,
    `Mode: ${task.mode}`,
    '',
    '## Acceptance criteria',
    ...task.acceptanceCriteria.map((item) => `- ${item}`),
    '',
    '## Available tools',
    ...task.allowedTools.map((tool) => `- ${tool}`),
    '',
    '## Write allowlist (relative to workspace)',
    ...(task.writeAllowlist.length > 0
      ? task.writeAllowlist.map((path) => `- ${path}`)
      : ['- (none; do not modify files)']),
    '',
    '## Source / repository paths',
    ...(task.sourcePaths.length > 0 ? task.sourcePaths.map((path) => `- ${path}`) : ['- (workspace root)']),
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
    '## Circuit-break / stop conditions',
    ...task.circuitBreakRules.map((rule) => `- ${rule}`),
    '',
    '## Hard constraints',
    '- Stay inside the workspace and write allowlist.',
    '- Do not access production systems, SSH, MiniPC host FS, or request secrets.',
    '- Do not declare Pipeline PASS, BLOCK, or final acceptance.',
    '- When finished, write agent-result.json in the workspace root with shape:',
    '  {"summary":"string","claimed_success":true|false,"changed_files":["optional"],"commands_executed":["optional"],"errors":["optional"]}',
    '',
  ];

  return sections.join('\n');
}

/** Persist machine-readable request next to the human brief. */
export function writeAgentRequestFiles(
  workspaceDir: string,
  task: TaskDefinition,
  request: AgentRequest,
): { readonly briefPath: string; readonly requestPath: string } {
  const briefPath = join(workspaceDir, 'task-brief.md');
  const requestPath = join(workspaceDir, 'agent-request.json');
  writeFileSync(briefPath, buildStructuredTaskPrompt(task, workspaceDir, request), 'utf8');
  writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
  return { briefPath, requestPath };
}
