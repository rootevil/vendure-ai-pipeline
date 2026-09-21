import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { assertSafeScreenshotName } from '../../safety/redaction.js';
import { createCheckResult } from '../check-result.js';
import type { BrowserPage, CheckRunnerContext } from '../check-types.js';
import { assertHttpUrl } from '../http-fetcher.js';

export interface PlaywrightJourneyStepResult {
  readonly index: number;
  readonly action: string;
  readonly detail: string;
  readonly status: 'PASS' | 'FAIL' | 'ERROR';
  readonly screenshot?: string;
  readonly title?: string;
  readonly message?: string;
}

export interface PlaywrightResultsFile {
  readonly engine: 'playwright';
  readonly journeyId: string;
  readonly startUrl: string;
  readonly status: 'PASS' | 'FAIL' | 'ERROR';
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly screenshots: readonly string[];
  readonly steps: readonly PlaywrightJourneyStepResult[];
  readonly summary: string;
}

/**
 * Multi-step Playwright storefront journey.
 *
 * Typical demo:
 *   Open storefront → Find product → Open product → Add to cart → Checkout → Verify
 * Screenshots (client demo):
 *   01-home.png, 02-product.png, 03-cart.png, 04-checkout.png
 * Also writes playwright-results.json under the run artifact directory.
 */
export async function runBrowserJourneyCheck(
  step: Extract<ValidationStep, { type: 'browser_journey' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const expected = `Playwright journey from ${step.startUrl} (${step.actions.length} actions)`;
  const startedAt = (ctx.now ?? (() => new Date()))().toISOString();

  if (!ctx.allowNetwork) {
    return createCheckResult({
      checkName: step.id,
      status: 'FAIL',
      expected,
      actual: 'Network disabled for this run',
      output: 'PIPELINE_ALLOW_NETWORK is false; browser_journey requires network',
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }

  let page: BrowserPage | null = null;
  const stepResults: PlaywrightJourneyStepResult[] = [];
  const screenshots: string[] = [];
  const screenshotsDir = join(ctx.runDir, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });

  try {
    assertHttpUrl(step.startUrl);
    page = await ctx.launchBrowser({ headless: true });
    const origin = new URL(step.startUrl).origin;

    for (let i = 0; i < step.actions.length; i += 1) {
      const action = step.actions[i]!;
      try {
        const result = await runJourneyAction({
          action,
          page,
          origin,
          startUrl: step.startUrl,
          timeoutMs: step.timeoutMs,
          screenshotsDir,
        });
        stepResults.push({
          index: i,
          action: action.type,
          detail: result.detail,
          status: result.failures.length === 0 ? 'PASS' : 'FAIL',
          ...(result.screenshot !== undefined ? { screenshot: result.screenshot } : {}),
          ...(result.title !== undefined ? { title: result.title } : {}),
          ...(result.failures.length > 0 ? { message: result.failures.join('; ') } : {}),
        });
        if (result.screenshot) {
          screenshots.push(result.screenshot);
        }
        if (result.failures.length > 0) {
          break;
        }
      } catch (error) {
        stepResults.push({
          index: i,
          action: action.type,
          detail: summarizeAction(action),
          status: 'ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    const finishedAt = (ctx.now ?? (() => new Date()))().toISOString();
    const failed = stepResults.some((s) => s.status !== 'PASS');
    const status: PlaywrightResultsFile['status'] = stepResults.some((s) => s.status === 'ERROR')
      ? 'ERROR'
      : failed
        ? 'FAIL'
        : 'PASS';

    const results: PlaywrightResultsFile = {
      engine: 'playwright',
      journeyId: step.id,
      startUrl: step.startUrl,
      status,
      startedAt,
      finishedAt,
      screenshots,
      steps: stepResults,
      summary: failed
        ? `Journey ${status}: ${stepResults.find((s) => s.status !== 'PASS')?.message ?? 'assertion failed'}`
        : `Journey PASS with ${screenshots.length} screenshot(s)`,
    };

    const resultsPath = join(ctx.runDir, step.resultsFileName);
    writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

    return createCheckResult({
      checkName: step.id,
      status: status === 'PASS' ? 'PASS' : status === 'ERROR' ? 'ERROR' : 'FAIL',
      expected,
      actual: results.summary,
      output: JSON.stringify(results, null, 2),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  } catch (error) {
    const finishedAt = (ctx.now ?? (() => new Date()))().toISOString();
    const results: PlaywrightResultsFile = {
      engine: 'playwright',
      journeyId: step.id,
      startUrl: step.startUrl,
      status: 'ERROR',
      startedAt,
      finishedAt,
      screenshots,
      steps: stepResults,
      summary: error instanceof Error ? error.message : String(error),
    };
    try {
      writeFileSync(
        join(ctx.runDir, step.resultsFileName),
        `${JSON.stringify(results, null, 2)}\n`,
        'utf8',
      );
    } catch {
      /* best-effort */
    }
    return createCheckResult({
      checkName: step.id,
      status: 'ERROR',
      expected,
      actual: results.summary,
      output: JSON.stringify(results, null, 2),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
  }
}

async function runJourneyAction(input: {
  readonly action: Extract<ValidationStep, { type: 'browser_journey' }>['actions'][number];
  readonly page: BrowserPage;
  readonly origin: string;
  readonly startUrl: string;
  readonly timeoutMs: number;
  readonly screenshotsDir: string;
}): Promise<{
  readonly detail: string;
  readonly failures: string[];
  readonly screenshot?: string;
  readonly title?: string;
}> {
  const { action, page, origin, startUrl, timeoutMs, screenshotsDir } = input;
  const failures: string[] = [];
  let screenshot: string | undefined;
  let title: string | undefined;

  switch (action.type) {
    case 'goto': {
      const url = resolveJourneyUrl(origin, startUrl, action.path);
      await page.goto(url, { timeout: timeoutMs });
      await page.waitForSelector('body', { timeout: timeoutMs });
      title = await page.title();
      failures.push(...(await assertPage(page, action, title)));
      if (action.screenshot) {
        screenshot = await captureScreenshot(page, screenshotsDir, action.screenshot);
      }
      return { detail: `goto ${url}`, failures, ...(screenshot ? { screenshot } : {}), title };
    }
    case 'click': {
      await page.waitForSelector(action.selector, { timeout: timeoutMs });
      await page.click(action.selector);
      if (action.expectSelector) {
        await page.waitForSelector(action.expectSelector, { timeout: timeoutMs });
      }
      title = await page.title();
      failures.push(...(await assertPage(page, action, title)));
      if (action.screenshot) {
        screenshot = await captureScreenshot(page, screenshotsDir, action.screenshot);
      }
      return {
        detail: `click ${action.selector}`,
        failures,
        ...(screenshot ? { screenshot } : {}),
        title,
      };
    }
    case 'fill': {
      await page.waitForSelector(action.selector, { timeout: timeoutMs });
      await page.fill(action.selector, action.value);
      return { detail: `fill ${action.selector}`, failures };
    }
    case 'assert': {
      title = await page.title();
      failures.push(...(await assertPage(page, action, title)));
      if (action.screenshot) {
        screenshot = await captureScreenshot(page, screenshotsDir, action.screenshot);
      }
      return { detail: 'assert', failures, ...(screenshot ? { screenshot } : {}), title };
    }
    case 'screenshot': {
      screenshot = await captureScreenshot(page, screenshotsDir, action.name);
      title = await page.title();
      return { detail: `screenshot ${action.name}`, failures, screenshot, title };
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported journey action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function assertPage(
  page: BrowserPage,
  expectations: {
    readonly expectTitleContains?: string | undefined;
    readonly expectSelector?: string | undefined;
    readonly expectTextContains?: string | undefined;
  },
  title: string,
): Promise<string[]> {
  const failures: string[] = [];
  if (expectations.expectTitleContains && !title.includes(expectations.expectTitleContains)) {
    failures.push(`title ${JSON.stringify(title)} missing ${JSON.stringify(expectations.expectTitleContains)}`);
  }
  if (expectations.expectSelector) {
    const text = await page.textContent(expectations.expectSelector);
    if (text === null) {
      failures.push(`selector ${expectations.expectSelector} not found`);
    } else if (
      expectations.expectTextContains &&
      !text.includes(expectations.expectTextContains)
    ) {
      failures.push(
        `selector text missing ${JSON.stringify(expectations.expectTextContains)}`,
      );
    }
  } else if (expectations.expectTextContains) {
    failures.push('expectTextContains requires expectSelector');
  }
  return failures;
}

async function captureScreenshot(
  page: BrowserPage,
  screenshotsDir: string,
  name: string,
): Promise<string> {
  assertSafeScreenshotName(name);
  const screenshotPath = join(screenshotsDir, name);
  const shot = await page.screenshot({ path: screenshotPath, fullPage: true });
  if (shot) {
    writeFileSync(screenshotPath, shot);
  }
  return `screenshots/${name}`;
}

function resolveJourneyUrl(origin: string, startUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (path === '.' || path === './') {
    return startUrl;
  }
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

function summarizeAction(
  action: Extract<ValidationStep, { type: 'browser_journey' }>['actions'][number],
): string {
  switch (action.type) {
    case 'goto':
      return `goto ${action.path}`;
    case 'click':
      return `click ${action.selector}`;
    case 'fill':
      return `fill ${action.selector}`;
    case 'assert':
      return 'assert';
    case 'screenshot':
      return `screenshot ${action.name}`;
    default: {
      const exhaustive: never = action;
      return JSON.stringify(exhaustive);
    }
  }
}
