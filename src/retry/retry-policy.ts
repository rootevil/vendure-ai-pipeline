import type { FailureClass } from '../models/types.js';

export interface RetryPolicyOptions {
  readonly maxIdenticalRetries: number;
  readonly maxTotalAttempts: number;
}

export interface RetryDecision {
  readonly shouldRetry: boolean;
  readonly reason: string;
}

export class RetryPolicy {
  private identicalCounts = new Map<string, number>();
  private totalAttempts = 0;

  constructor(private readonly options: RetryPolicyOptions) {
    if (options.maxIdenticalRetries < 1) {
      throw new Error('maxIdenticalRetries must be >= 1');
    }
    if (options.maxTotalAttempts < 1) {
      throw new Error('maxTotalAttempts must be >= 1');
    }
  }

  get attemptCount(): number {
    return this.totalAttempts;
  }

  recordAttempt(signature: string, failureClass: FailureClass): RetryDecision {
    this.totalAttempts += 1;
    const identical = (this.identicalCounts.get(signature) ?? 0) + 1;
    this.identicalCounts.set(signature, identical);

    if (failureClass === 'auth_required') {
      return { shouldRetry: false, reason: 'Authentication or authorization is required' };
    }

    if (failureClass === 'non_recoverable') {
      return { shouldRetry: false, reason: 'Failure classified as non-recoverable' };
    }

    if (this.totalAttempts >= this.options.maxTotalAttempts) {
      return {
        shouldRetry: false,
        reason: `Total attempt budget exhausted (${this.options.maxTotalAttempts})`,
      };
    }

    if (identical >= this.options.maxIdenticalRetries) {
      return {
        shouldRetry: false,
        reason: `Identical failure signature reached budget (${this.options.maxIdenticalRetries}): ${signature}`,
      };
    }

    if (failureClass === 'recoverable' || failureClass === 'unknown') {
      return {
        shouldRetry: true,
        reason: `Retrying recoverable failure (identical=${identical}, total=${this.totalAttempts})`,
      };
    }

    return { shouldRetry: false, reason: 'No retry rule matched' };
  }

  reset(): void {
    this.identicalCounts.clear();
    this.totalAttempts = 0;
  }
}

export function buildFailureSignature(parts: {
  readonly failureClass: FailureClass;
  readonly message: string;
  readonly code?: string;
}): string {
  const normalizedMessage = parts.message.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  return [parts.failureClass, parts.code ?? '', normalizedMessage].join('|');
}
