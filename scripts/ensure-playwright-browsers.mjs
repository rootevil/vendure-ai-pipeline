#!/usr/bin/env node
/**
 * Best-effort Playwright Chromium install for real-browser validation.
 * Never fails the parent npm install (Docker builds set PIPELINE_SKIP_PLAYWRIGHT_INSTALL=1).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

try {
  if (process.env.PIPELINE_SKIP_PLAYWRIGHT_INSTALL === '1') {
    process.exit(0);
  }

  const require = createRequire(import.meta.url);
  let cli;
  try {
    cli = require.resolve('playwright/cli.js');
  } catch {
    process.stderr.write(
      'playwright package not found; skip browser install. Run npm ci first.\n',
    );
    process.exit(0);
  }

  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.stderr.write(
      'playwright install chromium did not succeed; real-browser checks may FAIL until browsers are installed.\n' +
        'Manual fix: npx playwright install chromium\n',
    );
  }
} catch (error) {
  process.stderr.write(
    `playwright install skipped due to error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

process.exit(0);
