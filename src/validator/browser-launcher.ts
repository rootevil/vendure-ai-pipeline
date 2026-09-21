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
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
}

function wrapPlaywrightPage(page: PlaywrightPage, onClose: () => Promise<void>): BrowserPage {
  return {
    goto: (url, options) => page.goto(url, options).then(() => undefined),
    title: () => page.title(),
    textContent: (selector) => page.textContent(selector),
    click: (selector) => page.click(selector).then(() => undefined),
    fill: (selector, value) => page.fill(selector, value).then(() => undefined),
    waitForSelector: (selector, options) =>
      page.waitForSelector(selector, options).then(() => undefined),
    screenshot: (options) => page.screenshot(options),
    close: onClose,
  };
}

/** Deterministic fake browser for unit tests (no Chromium required). */
export function createFakeBrowserLauncher(state: {
  readonly title?: string;
  readonly textBySelector?: Record<string, string>;
  readonly failGoto?: string;
  readonly failClick?: string;
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
      async click(selector) {
        if (state.failClick) {
          throw new Error(state.failClick);
        }
        void selector;
      },
      async fill(selector, value) {
        void selector;
        void value;
      },
      async waitForSelector(selector) {
        if (state.textBySelector && !(selector in state.textBySelector)) {
          // Allow waits for selectors that only need presence via text map keys.
          // Unknown selectors still succeed in the simple fake (single-page checks).
        }
        void selector;
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

export interface FakeJourneyPageState {
  readonly title: string;
  readonly textBySelector: Record<string, string>;
  /** Selector click → absolute or path URL to navigate to. */
  readonly links?: Record<string, string>;
}

/**
 * Stateful fake browser for multi-step checkout journey tests.
 * Simulates navigation via goto + click link maps without Chromium.
 */
export function createFakeJourneyBrowserLauncher(input: {
  readonly origin: string;
  readonly pages: Record<string, FakeJourneyPageState>;
  /** Optional: after clicking this selector, mutate cart/checkout state. */
  readonly onClick?: (selector: string, currentPath: string) => void;
}): BrowserLauncher {
  return async () => {
    let closed = false;
    let currentUrl = input.origin + '/';
    const pathOf = (url: string): string => {
      try {
        return new URL(url).pathname;
      } catch {
        return url.startsWith('/') ? url : `/${url}`;
      }
    };
    const current = (): FakeJourneyPageState => {
      const path = pathOf(currentUrl);
      return (
        input.pages[path] ??
        input.pages['/'] ?? {
          title: '',
          textBySelector: {},
        }
      );
    };

    const page: BrowserPage = {
      async goto(url) {
        if (closed) {
          throw new Error('Browser already closed');
        }
        currentUrl = url.startsWith('http') ? url : `${input.origin}${url.startsWith('/') ? url : `/${url}`}`;
      },
      async title() {
        return current().title;
      },
      async textContent(selector) {
        return current().textBySelector[selector] ?? null;
      },
      async click(selector) {
        input.onClick?.(selector, pathOf(currentUrl));
        const target = current().links?.[selector];
        if (target) {
          currentUrl = target.startsWith('http')
            ? target
            : `${input.origin}${target.startsWith('/') ? target : `/${target}`}`;
        }
      },
      async fill() {
        /* no-op */
      },
      async waitForSelector(selector) {
        const text = current().textBySelector[selector];
        if (text === undefined && !current().links?.[selector]) {
          // Still allow wait on known link targets without text.
          if (!Object.keys(current().textBySelector).some((k) => k === selector)) {
            // Soft-success for journey fakes unless selector is completely unknown
            // and not a link — keep tests deterministic.
          }
        }
        void selector;
      },
      async screenshot() {
        return Buffer.from(`fake-screenshot:${pathOf(currentUrl)}`);
      },
      async close() {
        closed = true;
      },
    };
    return page;
  };
}
