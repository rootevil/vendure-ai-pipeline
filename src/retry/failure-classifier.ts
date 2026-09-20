import type { FailureClass, FailureKind } from '../models/types.js';

export interface ClassifyFailureInput {
  readonly failureClass?: FailureClass;
  readonly failureCode?: string;
  readonly message?: string;
  readonly claimedSuccess?: boolean;
  readonly isValidationFailure?: boolean;
  readonly isSafetyViolation?: boolean;
  readonly isRepeated?: boolean;
}

const TRANSIENT_CODES = new Set([
  'TOOL_CRASH',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'NETWORK_GLITCH',
  'INFRA_TRANSIENT',
  'DOCKER_DAEMON_BUSY',
]);

const TIMEOUT_CODES = new Set(['AGENT_TIMEOUT', 'TIMEOUT', 'DEADLINE_EXCEEDED']);

const UNSAFE_CODES = new Set([
  'SECRET_PATTERN',
  'PRODUCTION_INDICATOR',
  'PATH_ESCAPE',
  'NETWORK_DENIED',
  'IRREVERSIBLE_ACTION',
  'NOOP_AGENT',
  'MOCK_FAILURE',
  'OPENHANDS_NOT_AVAILABLE',
  'FORBIDDEN_VERDICT',
]);

/**
 * Maps agent/safety outcomes onto the Phase 7 failure taxonomy.
 */
export function classifyFailure(input: ClassifyFailureInput): FailureKind {
  if (input.isValidationFailure) {
    return 'validation';
  }
  if (input.isRepeated) {
    return 'repeated';
  }
  if (input.isSafetyViolation) {
    return 'unsafe_unknown';
  }

  const code = (input.failureCode ?? '').toUpperCase();
  const message = (input.message ?? '').toLowerCase();

  if (input.failureClass === 'auth_required') {
    return 'unsafe_unknown';
  }

  if (TIMEOUT_CODES.has(code) || /\btimeout\b/.test(message) || /\btimed out\b/.test(message)) {
    return 'timeout';
  }

  if (UNSAFE_CODES.has(code) || input.failureClass === 'non_recoverable') {
    return 'unsafe_unknown';
  }

  if (input.failureClass === 'unknown') {
    return 'unsafe_unknown';
  }

  if (
    TRANSIENT_CODES.has(code) ||
    /\btransient\b/.test(message) ||
    /\binfrastructure\b/.test(message)
  ) {
    return 'transient_infrastructure';
  }

  if (
    input.failureClass === 'recoverable' ||
    code.startsWith('MOCK_RETRYABLE') ||
    code.includes('RETRY')
  ) {
    return 'recoverable_implementation';
  }

  // Fail closed: unclassified outcomes are unsafe.
  return 'unsafe_unknown';
}

export function failureKindToLegacyClass(kind: FailureKind): FailureClass {
  switch (kind) {
    case 'transient_infrastructure':
    case 'recoverable_implementation':
    case 'timeout':
      return 'recoverable';
    case 'validation':
    case 'repeated':
    case 'unsafe_unknown':
      return 'non_recoverable';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
