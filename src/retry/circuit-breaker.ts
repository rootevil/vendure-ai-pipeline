export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Simple fail-closed circuit breaker for bounded recovery.
 * Once open, further retries are refused until an explicit reset (new run).
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private openReason: string | null = null;

  get currentState(): CircuitState {
    return this.state;
  }

  get reason(): string | null {
    return this.openReason;
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  /** Allow a single probe after open — unused by default (fail-closed). */
  allowHalfOpen(): void {
    if (this.state === 'open') {
      this.state = 'half_open';
    }
  }

  trip(reason: string): void {
    this.state = 'open';
    this.openReason = reason;
  }

  close(): void {
    this.state = 'closed';
    this.openReason = null;
  }

  reset(): void {
    this.close();
  }
}
