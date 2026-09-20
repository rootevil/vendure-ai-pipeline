export async function defaultHttpFetcher(input: {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
}): Promise<{ status: number; bodyText: string }> {
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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are allowed: ${url}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`URL credentials are not allowed: ${url}`);
  }
}
