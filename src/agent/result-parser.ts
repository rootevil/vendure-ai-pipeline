import { z } from 'zod';

import type { AgentResultEnvelope, AgentRunOutcome } from './agent-adapter.js';
import { agentOutcome } from './agent-adapter.js';

const AgentResultEnvelopeSchema = z
  .object({
    summary: z.string(),
    claimed_success: z.boolean(),
    changed_files: z.array(z.string()).optional(),
    commands_executed: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
  })
  .strict();

export class AgentOutputError extends Error {
  override readonly name = 'AgentOutputError';
  constructor(
    message: string,
    readonly code: 'MALFORMED_OUTPUT' | 'FORBIDDEN_PIPELINE_VERDICT',
  ) {
    super(message);
  }
}

export function parseAgentResultEnvelope(raw: unknown): AgentResultEnvelope {
  if (raw !== null && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ['status', 'pipeline_status', 'pass', 'block']) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        throw new AgentOutputError(
          `Agent must not declare pipeline verdict via '${key}'`,
          'FORBIDDEN_PIPELINE_VERDICT',
        );
      }
    }
  }

  const parsed = AgentResultEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentOutputError(
      `Malformed agent result envelope: ${parsed.error.message}`,
      'MALFORMED_OUTPUT',
    );
  }
  return {
    summary: parsed.data.summary,
    claimed_success: parsed.data.claimed_success,
    ...(parsed.data.changed_files !== undefined
      ? { changed_files: parsed.data.changed_files }
      : {}),
    ...(parsed.data.commands_executed !== undefined
      ? { commands_executed: parsed.data.commands_executed }
      : {}),
    ...(parsed.data.errors !== undefined ? { errors: parsed.data.errors } : {}),
  };
}

export function parseAgentResultJson(text: string): AgentResultEnvelope {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AgentOutputError(`Agent result is not valid JSON: ${message}`, 'MALFORMED_OUTPUT');
  }
  return parseAgentResultEnvelope(json);
}

/**
 * Extract the last JSON object line from OpenHands --json JSONL output, if any.
 */
export function tryParseOpenHandsJsonl(stdout: string): AgentResultEnvelope | null {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event['type'] === 'agent_result' || event['kind'] === 'agent_result') {
        return parseAgentResultEnvelope(event['result'] ?? event);
      }
      if (typeof event['summary'] === 'string' && typeof event['claimed_success'] === 'boolean') {
        return parseAgentResultEnvelope(event);
      }
    } catch {
      // keep scanning
    }
  }
  return null;
}

export function malformedOutcome(parts: {
  readonly stdout: string;
  readonly stderr: string;
  readonly message: string;
  readonly code: 'MALFORMED_OUTPUT' | 'FORBIDDEN_PIPELINE_VERDICT';
}): AgentRunOutcome {
  return agentOutcome({
    claimedSuccess: false,
    summary: parts.message,
    stdout: parts.stdout,
    stderr: parts.stderr,
    failureClass: 'recoverable',
    failureCode: parts.code,
    errors: [parts.code, parts.message],
    finalReport: parts.message,
  });
}
