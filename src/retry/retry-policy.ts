import type { FailureClass, FailureKind } from '../models/types.js';
import { CircuitBreaker, type CircuitState } from './circuit-breaker.js';
import {
  classifyRetryCategory,
  dispositionMayRepeat,
  MAX_RETRIES,
  ruleForCategory,
  type RetryCategory,
  type RetryDisposition,
} from './classified-policy.js';
import { classifyFailure } from './failure-classifier.js';

export interface RetryPolicyOptions {
  readonly maxIdenticalRetries: number;
  readonly maxTotalAttempts: number;
  /** Stricter budget for transient infrastructure failures. Defaults to maxIdenticalRetries. */
  readonly maxTransientRetries?: number;
  /** Stricter budget for timeout failures. Defaults to maxIdenticalRetries. */
  readonly maxTimeoutRetries?: number;
}

export interface RetryDecision {
  readonly shouldRetry: boolean;
  readonly reason: string;
  readonly failureKind: FailureKind;
  readonly circuitState: CircuitState;
  readonly action: 'retry_agent' | 'stop' | 'stop_auth' | 'handoff_validator';
  /** Client table action (RETRY, AGENT_REPAIR, CIRCUIT_BREAK, …). */
  readonly disposition: RetryDisposition;
  readonly category: RetryCategory | null;
}

/**
 * Bounded recovery policy with circuit-breaker behavior.
 * Never retries indefinitely. Never grants PASS — that remains validator-only.
 * Same failure is circuit-broken at MAX_RETRIES (3). There is no open retry loop.
 */
export class RetryPolicy {
  private identicalCounts = new Map<string, number>();
  private totalAttempts = 0;
  private readonly circuit = new CircuitBreaker();
  private readonly maxTransientRetries: number;
  private readonly maxTimeoutRetries: number;

  constructor(private readonly options: RetryPolicyOptions) {
    if (options.maxIdenticalRetries < 1) {
      throw new Error('maxIdenticalRetries must be >= 1');
    }
    if (options.maxTotalAttempts < 1) {
      throw new Error('maxTotalAttempts must be >= 1');
    }
    this.maxTransientRetries = Math.min(
      options.maxTransientRetries ?? options.maxIdenticalRetries,
      MAX_RETRIES,
    );
    this.maxTimeoutRetries = Math.min(
      options.maxTimeoutRetries ?? options.maxIdenticalRetries,
      MAX_RETRIES,
    );
  }

  get attemptCount(): number {
    return this.totalAttempts;
  }

  get circuitState(): CircuitState {
    return this.circuit.currentState;
  }

  /**
   * Record an agent/control-loop attempt and decide whether to retry the agent.
   * Validation failures must not use this path to chase PASS — use recordValidationFailure.
   */
  recordAttempt(signature: string, failureClassOrKind: FailureClass | FailureKind): RetryDecision {
    const failureKind = isFailureKind(failureClassOrKind)
      ? failureClassOrKind
      : classifyFailure({ failureClass: failureClassOrKind });

    return this.decide({ signature, failureKind });
  }

  decide(input: {
    readonly signature: string;
    readonly failureKind: FailureKind;
    readonly authRequired?: boolean;
    readonly category?: RetryCategory | null;
    readonly failureCode?: string;
    readonly message?: string;
    readonly failureClass?: string;
  }): RetryDecision {
    this.totalAttempts += 1;
    const identical = (this.identicalCounts.get(input.signature) ?? 0) + 1;
    this.identicalCounts.set(input.signature, identical);

    const category =
      input.category !== undefined
        ? input.category
        : classifyRetryCategory({
            ...(input.failureClass !== undefined ? { failureClass: input.failureClass } : {}),
            ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
            ...(input.message !== undefined ? { message: input.message } : {}),
            failureKind: input.failureKind,
          });

    if (this.circuit.isOpen()) {
      return stopDecision(
        'repeated',
        `Circuit breaker open: ${this.circuit.reason ?? 'previous hard stop'}`,
        this.circuit.currentState,
        input.authRequired ? 'stop_auth' : 'stop',
        'CIRCUIT_BREAK',
        category,
      );
    }

    if (category) {
      const ruled = applyClassifiedRule({
        category,
        identical,
        authRequired: input.authRequired === true,
        circuit: this.circuit,
        signature: input.signature,
        configuredCap: this.options.maxIdenticalRetries,
      });
      if (ruled) {
        return ruled;
      }
    }

    if (input.authRequired || input.failureKind === 'unsafe_unknown') {
      const reason =
        input.authRequired === true
          ? 'Authentication or authorization is required'
          : 'Unsafe or unknown failure — immediate stop';
      this.circuit.trip(reason);
      return stopDecision(
        'unsafe_unknown',
        reason,
        this.circuit.currentState,
        input.authRequired ? 'stop_auth' : 'stop',
        input.authRequired ? 'AUTH_REQUIRED' : 'BLOCK',
        category,
      );
    }

    if (input.failureKind === 'validation') {
      const reason = 'Validation failure — evidence required; will not bypass validator for PASS';
      this.circuit.trip(reason);
      return stopDecision('validation', reason, this.circuit.currentState, 'stop', 'BLOCK', category);
    }

    if (input.failureKind === 'repeated') {
      const reason = 'Repeated failure — circuit breaker open';
      this.circuit.trip(reason);
      return stopDecision(
        'repeated',
        reason,
        this.circuit.currentState,
        'stop',
        'CIRCUIT_BREAK',
        category,
      );
    }

    if (this.totalAttempts >= this.options.maxTotalAttempts) {
      const reason = `Total attempt budget exhausted (${this.options.maxTotalAttempts})`;
      this.circuit.trip(reason);
      return stopDecision(
        'repeated',
        reason,
        this.circuit.currentState,
        'stop',
        'CIRCUIT_BREAK',
        category,
      );
    }

    const kindBudget = Math.min(
      kindRetryBudget(input.failureKind, {
        identical: this.options.maxIdenticalRetries,
        transient: this.maxTransientRetries,
        timeout: this.maxTimeoutRetries,
      }),
      MAX_RETRIES,
    );

    if (identical >= kindBudget) {
      const reason = `CIRCUIT_BREAK: identical ${input.failureKind} failure reached budget (${kindBudget}): ${input.signature}`;
      this.circuit.trip(reason);
      return stopDecision(
        'repeated',
        reason,
        this.circuit.currentState,
        'stop',
        'CIRCUIT_BREAK',
        category,
      );
    }

    if (
      input.failureKind === 'transient_infrastructure' ||
      input.failureKind === 'recoverable_implementation' ||
      input.failureKind === 'timeout'
    ) {
      const disposition: RetryDisposition =
        input.failureKind === 'timeout'
          ? 'RETRY_ONCE'
          : input.failureKind === 'recoverable_implementation'
            ? 'AGENT_REPAIR'
            : 'RETRY';
      return {
        shouldRetry: true,
        reason: `${disposition} ${input.failureKind} (identical=${identical}/${kindBudget}, total=${this.totalAttempts}, max=${MAX_RETRIES})`,
        failureKind: input.failureKind,
        circuitState: this.circuit.currentState,
        action: 'retry_agent',
        disposition,
        category,
      };
    }

    this.circuit.trip('No retry rule matched — fail closed');
    return stopDecision(
      'unsafe_unknown',
      'No retry rule matched — fail closed',
      this.circuit.currentState,
      'stop',
      'BLOCK',
      category,
    );
  }

  /**
   * Validation failures always stop recovery and require evidence.
   * They never return to the agent in order to obtain PASS.
   */
  recordValidationFailure(detail: string): RetryDecision {
    const reason = `Validation failure with evidence: ${detail}`;
    this.circuit.trip(reason);
    return stopDecision('validation', reason, this.circuit.currentState, 'stop', 'BLOCK', null);
  }

  reset(): void {
    this.identicalCounts.clear();
    this.totalAttempts = 0;
    this.circuit.reset();
  }
}

function applyClassifiedRule(input: {
  readonly category: RetryCategory;
  readonly identical: number;
  readonly authRequired: boolean;
  readonly circuit: CircuitBreaker;
  readonly signature: string;
  readonly configuredCap: number;
}): RetryDecision | null {
  const rule = ruleForCategory(input.category);

  if (rule.disposition === 'BLOCK') {
    const reason =
      input.category === 'production_target'
        ? 'Production target — BLOCK (no retry)'
        : 'Dangerous operation — BLOCK (no retry)';
    input.circuit.trip(reason);
    return stopDecision(
      'unsafe_unknown',
      reason,
      input.circuit.currentState,
      'stop',
      'BLOCK',
      input.category,
    );
  }

  if (rule.disposition === 'AUTH_REQUIRED' || input.authRequired) {
    const reason = 'Missing credential — AUTH_REQUIRED (no retry)';
    input.circuit.trip(reason);
    return stopDecision(
      'unsafe_unknown',
      reason,
      input.circuit.currentState,
      'stop_auth',
      'AUTH_REQUIRED',
      input.category,
    );
  }

  if (rule.disposition === 'CLIENT_DECISION') {
    const reason = 'Business ambiguity — CLIENT_DECISION (no retry)';
    input.circuit.trip(reason);
    return stopDecision(
      'unsafe_unknown',
      reason,
      input.circuit.currentState,
      'stop',
      'CLIENT_DECISION',
      input.category,
    );
  }

  if (!dispositionMayRepeat(rule.disposition)) {
    return null;
  }

  const cap = Math.min(rule.maxOccurrences, input.configuredCap, MAX_RETRIES);
  if (input.identical >= cap) {
    const circuit = input.identical >= MAX_RETRIES;
    const disposition: RetryDisposition = circuit ? 'CIRCUIT_BREAK' : rule.disposition;
    const reason = circuit
      ? `CIRCUIT_BREAK: same ${input.category} failure reached budget (${cap}): ${input.signature}`
      : `${rule.disposition} exhausted for ${input.category} after ${input.identical} occurrence(s) (budget ${cap})`;
    input.circuit.trip(reason);
    return stopDecision(
      'repeated',
      reason,
      input.circuit.currentState,
      'stop',
      disposition,
      input.category,
    );
  }

  return {
    shouldRetry: true,
    reason: `${rule.disposition} ${input.category} (identical=${input.identical}/${cap}, max=${MAX_RETRIES})`,
    failureKind:
      input.category === 'browser_timeout'
        ? 'timeout'
        : input.category === 'temporary_container_failure'
          ? 'transient_infrastructure'
          : 'recoverable_implementation',
    circuitState: input.circuit.currentState,
    action: 'retry_agent',
    disposition: rule.disposition,
    category: input.category,
  };
}

function kindRetryBudget(
  kind: FailureKind,
  budgets: { identical: number; transient: number; timeout: number },
): number {
  switch (kind) {
    case 'transient_infrastructure':
      return budgets.transient;
    case 'timeout':
      return budgets.timeout;
    case 'recoverable_implementation':
      return budgets.identical;
    default:
      return 1;
  }
}

function stopDecision(
  failureKind: FailureKind,
  reason: string,
  circuitState: CircuitState,
  action: RetryDecision['action'],
  disposition: RetryDisposition,
  category: RetryCategory | null,
): RetryDecision {
  return {
    shouldRetry: false,
    reason,
    failureKind,
    circuitState,
    action,
    disposition,
    category,
  };
}

function isFailureKind(value: string): value is FailureKind {
  return (
    value === 'transient_infrastructure' ||
    value === 'recoverable_implementation' ||
    value === 'validation' ||
    value === 'timeout' ||
    value === 'repeated' ||
    value === 'unsafe_unknown'
  );
}

export function buildFailureSignature(parts: {
  readonly failureClass: FailureClass;
  readonly message: string;
  readonly code?: string;
  readonly failureKind?: FailureKind;
}): string {
  const normalizedMessage = parts.message.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  return [
    parts.failureKind ?? parts.failureClass,
    parts.failureClass,
    parts.code ?? '',
    normalizedMessage,
  ].join('|');
}

export { MAX_RETRIES };
