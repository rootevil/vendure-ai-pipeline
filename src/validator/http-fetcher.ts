import { assertSafeHttpDestination } from '../safety/redaction.js';

export async function defaultHttpFetcher(input: {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
}): Promise<{ status: number; bodyText: string }> {
  assertHttpUrl(input.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const init: RequestInit = {
      method: input.method,
      headers: input.headers,
      signal: controller.signal,
    };
    if (input.body !== undefined) {
      init.body = input.body;
    }
    const response = await fetch(input.url, init);
    const bodyText = await response.text();
    return { status: response.status, bodyText };
  } finally {
    clearTimeout(timer);
  }
}

export function assertHttpUrl(url: string): void {
  assertSafeHttpDestination(url);
}
