import type { FailureClass, FailureKind } from '../models/types.js';
import { CircuitBreaker, type CircuitState } from './circuit-breaker.js';
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
}

/**
 * Bounded recovery policy with circuit-breaker behavior.
 * Never retries indefinitely. Never grants PASS — that remains validator-only.
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
    this.maxTransientRetries = options.maxTransientRetries ?? options.maxIdenticalRetries;
    this.maxTimeoutRetries = options.maxTimeoutRetries ?? options.maxIdenticalRetries;
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
  }): RetryDecision {
    this.totalAttempts += 1;
    const identical = (this.identicalCounts.get(input.signature) ?? 0) + 1;
    this.identicalCounts.set(input.signature, identical);

    if (this.circuit.isOpen()) {
      return stopDecision(
        'repeated',
        `Circuit breaker open: ${this.circuit.reason ?? 'previous hard stop'}`,
        this.circuit.currentState,
        input.authRequired ? 'stop_auth' : 'stop',
      );
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
      );
    }

    if (input.failureKind === 'validation') {
      const reason = 'Validation failure — evidence required; will not bypass validator for PASS';
      this.circuit.trip(reason);
      return stopDecision('validation', reason, this.circuit.currentState, 'stop');
    }

    if (input.failureKind === 'repeated') {
      const reason = 'Repeated failure — circuit breaker open';
      this.circuit.trip(reason);
      return stopDecision('repeated', reason, this.circuit.currentState, 'stop');
    }

    if (this.totalAttempts >= this.options.maxTotalAttempts) {
      const reason = `Total attempt budget exhausted (${this.options.maxTotalAttempts})`;
      this.circuit.trip(reason);
      return stopDecision('repeated', reason, this.circuit.currentState, 'stop');
    }

    const kindBudget = kindRetryBudget(input.failureKind, {
      identical: this.options.maxIdenticalRetries,
      transient: this.maxTransientRetries,
      timeout: this.maxTimeoutRetries,
    });

    if (identical >= kindBudget) {
      const reason = `Identical ${input.failureKind} failure reached budget (${kindBudget}): ${input.signature}`;
      this.circuit.trip(reason);
      return stopDecision('repeated', reason, this.circuit.currentState, 'stop');
    }

    if (
      input.failureKind === 'transient_infrastructure' ||
      input.failureKind === 'recoverable_implementation' ||
      input.failureKind === 'timeout'
    ) {
      return {
        shouldRetry: true,
        reason: `Retrying ${input.failureKind} (identical=${identical}, total=${this.totalAttempts})`,
        failureKind: input.failureKind,
        circuitState: this.circuit.currentState,
        action: 'retry_agent',
      };
    }

    this.circuit.trip('No retry rule matched — fail closed');
    return stopDecision(
      'unsafe_unknown',
      'No retry rule matched — fail closed',
      this.circuit.currentState,
      'stop',
    );
  }

  /**
   * Validation failures always stop recovery and require evidence.
   * They never return to the agent in order to obtain PASS.
   */
  recordValidationFailure(detail: string): RetryDecision {
    const reason = `Validation failure with evidence: ${detail}`;
    this.circuit.trip(reason);
    return stopDecision('validation', reason, this.circuit.currentState, 'stop');
  }

  reset(): void {
    this.identicalCounts.clear();
    this.totalAttempts = 0;
    this.circuit.reset();
  }
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
): RetryDecision {
  return {
    shouldRetry: false,
    reason,
    failureKind,
    circuitState,
    action,
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
