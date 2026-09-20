import type { BrowserLauncher, BrowserPage } from './check-types.js';

/**
 * Launches a real Playwright Chromium page when available.
 * Tests should inject a fake launcher instead of depending on browsers.
 */
export const playwrightBrowserLauncher: BrowserLauncher = async () => {
  let playwright: {
    chromium: {
      launch: (options?: { headless?: boolean }) => Promise<{
        newPage: () => Promise<PlaywrightPage>;
        close: () => Promise<void>;
      }>;
    };
  };
  try {
    playwright = (await import('playwright')) as typeof playwright;
  } catch {
    throw new Error('browser_playwright requires the `playwright` package');
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  return wrapPlaywrightPage(page, async () => {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  });
};

interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  textContent(selector: string): Promise<string | null>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
}

function wrapPlaywrightPage(page: PlaywrightPage, onClose: () => Promise<void>): BrowserPage {
  return {
    goto: (url, options) => page.goto(url, options).then(() => undefined),
    title: () => page.title(),
    textContent: (selector) => page.textContent(selector),
    screenshot: (options) => page.screenshot(options),
    close: onClose,
  };
}

/** Deterministic fake browser for unit tests (no Chromium required). */
export function createFakeBrowserLauncher(state: {
  readonly title?: string;
  readonly textBySelector?: Record<string, string>;
  readonly failGoto?: string;
}): BrowserLauncher {
  return async () => {
    let closed = false;
    const page: BrowserPage = {
      async goto(url) {
        if (state.failGoto) {
          throw new Error(state.failGoto);
        }
        if (closed) {
          throw new Error('Browser already closed');
        }
        void url;
      },
      async title() {
        return state.title ?? '';
      },
      async textContent(selector) {
        return state.textBySelector?.[selector] ?? null;
      },
      async screenshot() {
        return Buffer.from('fake-screenshot');
      },
      async close() {
        closed = true;
      },
    };
    return page;
  };
}
