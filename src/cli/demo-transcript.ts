/**
 * Client demo transcript. Lines are emitted only for stages that actually ran.
 */
export function demoTranscript(input: {
  readonly status: string;
  readonly checkNames: readonly string[];
}): readonly string[] {
  const names = input.checkNames.join('\n').toLowerCase();
  const lines = [
    '[PIPELINE] Task received',
    '[COMPILER] Creating acceptance criteria',
    '[AGENT] Starting isolated workspace',
    '[AGENT] Inspecting repository',
    '[AGENT] Implementing changes',
  ];
  if (/health|api|graphql|http/.test(names)) {
    lines.push('[VALIDATOR] Running API checks');
  }
  if (/playwright|browser/.test(names)) {
    lines.push('[VALIDATOR] Running Playwright');
  }
  if (/database|db-state|\bdb\b/.test(names)) {
    lines.push('[VALIDATOR] Checking database');
  }
  lines.push('[EVIDENCE] Collecting artifacts');
  lines.push(`[RESULT] ${input.status}`);
  return lines;
}

export function isDemoTaskPath(taskPath: string): boolean {
  return /(?:^|\/)demo-task\.(?:ya?ml|json)$/i.test(taskPath.replaceAll('\\', '/'));
}
