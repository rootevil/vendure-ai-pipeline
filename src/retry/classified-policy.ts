/**
 * Classified retry policy. There is no `while (failure) retry()` loop.
 * Same failure occurring MAX_RETRIES times opens the circuit breaker.
 */
export const MAX_RETRIES = 3;

export const RetryCategorySchema = [
  'temporary_container_failure',
  'browser_timeout',
  'code_bug',
  'dependency_error',
  'missing_credential',
  'business_ambiguity',
  'dangerous_operation',
  'production_target',
] as const;

export type RetryCategory = (typeof RetryCategorySchema)[number];

/** Client-facing action. CIRCUIT_BREAK replaces further retries. */
export const RetryDispositionSchema = [
  'RETRY',
  'RETRY_ONCE',
  'AGENT_REPAIR',
  'AGENT_INVESTIGATE',
  'AUTH_REQUIRED',
  'CLIENT_DECISION',
  'BLOCK',
  'CIRCUIT_BREAK',
] as const;

export type RetryDisposition = (typeof RetryDispositionSchema)[number];

export interface ClassifiedRetryRule {
  readonly category: RetryCategory;
  readonly disposition: RetryDisposition;
  /**
   * How many occurrences are allowed before stop.
   * 1 = do not retry. 2 = one retry. MAX_RETRIES = circuit-break on the 3rd hit.
   */
  readonly maxOccurrences: number;
}

export const CLASSIFIED_RETRY_TABLE: readonly ClassifiedRetryRule[] = [
  {
    category: 'temporary_container_failure',
    disposition: 'RETRY',
    maxOccurrences: MAX_RETRIES,
  },
  { category: 'browser_timeout', disposition: 'RETRY_ONCE', maxOccurrences: 2 },
  { category: 'code_bug', disposition: 'AGENT_REPAIR', maxOccurrences: MAX_RETRIES },
  { category: 'dependency_error', disposition: 'AGENT_INVESTIGATE', maxOccurrences: 2 },
  { category: 'missing_credential', disposition: 'AUTH_REQUIRED', maxOccurrences: 1 },
  { category: 'business_ambiguity', disposition: 'CLIENT_DECISION', maxOccurrences: 1 },
  { category: 'dangerous_operation', disposition: 'BLOCK', maxOccurrences: 1 },
  { category: 'production_target', disposition: 'BLOCK', maxOccurrences: 1 },
];

const BY_CATEGORY: ReadonlyMap<RetryCategory, ClassifiedRetryRule> = new Map(
  CLASSIFIED_RETRY_TABLE.map((rule) => [rule.category, rule]),
);

export function ruleForCategory(category: RetryCategory): ClassifiedRetryRule {
  const rule = BY_CATEGORY.get(category);
  if (!rule) {
    throw new Error(`No classified retry rule for ${category}`);
  }
  return rule;
}

export interface ClassifyRetryCategoryInput {
  readonly failureClass?: string;
  readonly failureCode?: string;
  readonly failureKind?: string;
  readonly message?: string;
}

/**
 * Map an observed failure onto the client category table.
 * Returns null when the legacy FailureKind path should decide.
 */
export function classifyRetryCategory(input: ClassifyRetryCategoryInput): RetryCategory | null {
  const code = (input.failureCode ?? '').toUpperCase();
  const message = (input.message ?? '').toLowerCase();

  if (
    code === 'PRODUCTION_INDICATOR' ||
    code === 'PRODUCTION_TARGET' ||
    /\bproduction\b/.test(message) ||
    input.failureClass === 'production'
  ) {
    return 'production_target';
  }

  if (
    input.failureClass === 'auth_required' ||
    code === 'AUTH_REQUIRED' ||
    code === 'MISSING_CREDENTIAL' ||
    /missing credential|unauthorized|auth required|api[_ ]?key missing/.test(message)
  ) {
    return 'missing_credential';
  }

  if (
    code === 'BUSINESS_AMBIGUITY' ||
    code === 'CLIENT_DECISION' ||
    /business ambig|acceptance unclear|client decision|requirement unclear/.test(message)
  ) {
    return 'business_ambiguity';
  }

  if (
    code === 'SECRET_PATTERN' ||
    code === 'IRREVERSIBLE_ACTION' ||
    code === 'DANGEROUS_OPERATION' ||
    code === 'PATH_ESCAPE' ||
    /dangerous|irreversible|secret material/.test(message)
  ) {
    return 'dangerous_operation';
  }

  if (
    code === 'BROWSER_TIMEOUT' ||
    code === 'PLAYWRIGHT_TIMEOUT' ||
    (/timeout|timed out/.test(message) && /browser|playwright/.test(message))
  ) {
    return 'browser_timeout';
  }

  if (
    code === 'DEPENDENCY_ERROR' ||
    code === 'MODULE_NOT_FOUND' ||
    /cannot find module|dependency error|missing dependency|peer dep/.test(message)
  ) {
    return 'dependency_error';
  }

  if (
    code === 'TOOL_CRASH' ||
    code === 'DOCKER_DAEMON_BUSY' ||
    code === 'CONTAINER_FAILURE' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    /container failure|docker daemon/.test(message)
  ) {
    return 'temporary_container_failure';
  }

  if (
    code === 'CODE_BUG' ||
    code.startsWith('MOCK_RETRYABLE') ||
    /code bug|implementation bug/.test(message)
  ) {
    return 'code_bug';
  }

  return null;
}

/** True when this disposition may run again until its occurrence cap or MAX_RETRIES. */
export function dispositionMayRepeat(disposition: RetryDisposition): boolean {
  return (
    disposition === 'RETRY' ||
    disposition === 'RETRY_ONCE' ||
    disposition === 'AGENT_REPAIR' ||
    disposition === 'AGENT_INVESTIGATE'
  );
}
