import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ValidationCheckResult, ValidationStep } from '../../models/types.js';
import { createCheckResult } from '../check-result.js';
import type { CheckRunnerContext } from '../check-types.js';
import { assertHttpUrl } from '../http-fetcher.js';

export async function runBrowserPlaywrightCheck(
  step: Extract<ValidationStep, { type: 'browser_playwright' }>,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  const evidenceFile = `${step.id}.json`;
  const expectedParts: string[] = [`load ${step.url}`];
  if (step.expectTitleContains) {
    expectedParts.push(`title contains ${JSON.stringify(step.expectTitleContains)}`);
  }
  if (step.expectSelector) {
    expectedParts.push(`selector ${step.expectSelector} present`);
  }
  if (step.expectTextContains) {
    expectedParts.push(`text contains ${JSON.stringify(step.expectTextContains)}`);
  }
  const expected = expectedParts.join('; ');

  if (!ctx.allowNetwork) {
    return createCheckResult({
      checkName: step.id,
      status: 'FAIL',
      expected,
      actual: 'Network disabled for this run',
      output: 'PIPELINE_ALLOW_NETWORK is false; browser_playwright requires network',
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  }

  let page: Awaited<ReturnType<CheckRunnerContext['launchBrowser']>> | null = null;
  try {
    assertHttpUrl(step.url);
    page = await ctx.launchBrowser({ headless: true });
    await page.goto(step.url, { timeout: step.timeoutMs });
    const title = await page.title();
    const failures: string[] = [];

    if (step.expectTitleContains && !title.includes(step.expectTitleContains)) {
      failures.push(`title ${JSON.stringify(title)} missing expected substring`);
    }

    let selectorText: string | null = null;
    if (step.expectSelector) {
      selectorText = await page.textContent(step.expectSelector);
      if (selectorText === null) {
        failures.push(`selector ${step.expectSelector} not found`);
      } else if (step.expectTextContains && !selectorText.includes(step.expectTextContains)) {
        failures.push(`selector text missing ${JSON.stringify(step.expectTextContains)}`);
      }
    } else if (step.expectTextContains) {
      failures.push('expectTextContains requires expectSelector');
    }

    const screenshotsDir = join(ctx.runDir, 'screenshots');
    mkdirSync(screenshotsDir, { recursive: true });
    const screenshotPath = join(screenshotsDir, step.screenshotName);
    const shot = await page.screenshot({ path: screenshotPath, fullPage: true });
    if (shot) {
      writeFileSync(screenshotPath, shot);
    }

    const passed = failures.length === 0;
    return createCheckResult({
      checkName: step.id,
      status: passed ? 'PASS' : 'FAIL',
      expected,
      actual: passed ? `title=${JSON.stringify(title)}` : failures.join('; '),
      output: JSON.stringify(
        {
          title,
          selector: step.expectSelector ?? null,
          selectorText,
          screenshotPath,
        },
        null,
        2,
      ),
      evidenceDir: ctx.evidenceDir,
      evidenceFileName: evidenceFile,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
  } catch (error) {
    return createCheckResult({
      checkName: step.id,
      status: 'ERROR',
      expected,
      actual: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? (error.stack ?? error.message) : String(error),
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
