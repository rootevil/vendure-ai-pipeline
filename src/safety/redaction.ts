/**
 * Shared Phase 1 safety helpers: redaction, URL destination policy, path basename checks.
 */

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk_(live|test)_[A-Za-z0-9]+\b/g,
  /\b(postgresql|postgres|mysql|mongodb):\/\/[^\s'"]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
];

const SECRET_ENV_KEY = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|database_url|redis_url|^pgpassword$|^aws_|github_token|openai|anthropic|stripe)/i;

/** Max captured agent stdout/stderr retained in evidence (bytes). */
export const MAX_CAPTURED_LOG_BYTES = 2 * 1024 * 1024;

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

export function truncateAndRedactLog(text: string, maxBytes = MAX_CAPTURED_LOG_BYTES): string {
  const redacted = redactSecrets(text);
  if (Buffer.byteLength(redacted, 'utf8') <= maxBytes) {
    return redacted;
  }
  // Keep head + note; avoid cutting mid-surrogate by using string slice on chars approx.
  const sliced = redacted.slice(0, Math.floor(maxBytes / 2));
  return `${sliced}\n…[truncated ${Buffer.byteLength(redacted, 'utf8') - Buffer.byteLength(sliced, 'utf8')} bytes]\n`;
}

export function scrubEnvForAgent(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (SECRET_ENV_KEY.test(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Phase 1 destination policy for validator HTTP(S) fetches.
 * Allows loopback and explicit PIPELINE_NETWORK_ALLOWLIST (comma-separated hosts).
 */
export function assertSafeHttpDestination(url: string, allowlistCsv?: string): void {
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

  const host = parsed.hostname.toLowerCase();
  const allowlist = new Set(
    (allowlistCsv ?? process.env.PIPELINE_NETWORK_ALLOWLIST ?? '')
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0),
  );
  // Always allow loopback for local demo servers.
  allowlist.add('127.0.0.1');
  allowlist.add('localhost');
  allowlist.add('::1');

  if (!allowlist.has(host)) {
    throw new Error(
      `URL host ${host} is not in PIPELINE_NETWORK_ALLOWLIST (Phase 1 SSRF guard): ${url}`,
    );
  }

  // Block cloud metadata / link-local even if somehow allowlisted by mistake.
  if (host === '169.254.169.254' || host.startsWith('169.254.')) {
    throw new Error(`Link-local / metadata hosts are forbidden: ${url}`);
  }
}

/** Stack dependency hosts allowed without full egress (Compose service names + loopback). */
export function isAllowedStackDependencyHost(host: string): boolean {
  const normalized = host.toLowerCase();
  const fromEnv = (process.env.PIPELINE_STACK_HOST_ALLOWLIST ?? 'redis,postgres,127.0.0.1,localhost,::1')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.includes(normalized);
}

export function assertSafeScreenshotName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error('screenshotName must not be blank');
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error(`Unsafe screenshotName: ${name}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`screenshotName must be a simple filename: ${name}`);
  }
}

export function assertSafeRelativeWorkspacePath(candidate: string): void {
  const normalized = candidate.replace(/\\/g, '/');
  if (
    !normalized ||
    isAbsolutePath(normalized) ||
    normalized.includes('..') ||
    normalized.includes('\0') ||
    normalized.startsWith('~/')
  ) {
    throw new Error(`Unsafe workspace-relative path: ${candidate}`);
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

export function looksLikeProductionTarget(value: string): boolean {
  return /prod|production|live[_-]?stripe|prod[_-]?db|amazonaws\.com|azure\.com|googleapis\.com/i.test(
    value,
  );
}
