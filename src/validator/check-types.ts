import type { ExecutionContext } from '../safety/execution-context.js';
import type { ValidationCheckResult, ValidationStep } from '../models/types.js';

export interface HttpResponseLike {
  readonly status: number;
  readonly bodyText: string;
}

export type HttpFetcher = (input: {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
}) => Promise<HttpResponseLike>;

export interface DatabaseQueryResult {
  readonly rows: unknown[];
  readonly rowCount: number;
  readonly value?: unknown;
}

export type DatabaseExecutor = (input: {
  readonly driver: 'json_fixture' | 'postgres';
  readonly fixturePath?: string;
  readonly connectionString?: string;
  readonly query: string;
  readonly params?: readonly unknown[];
  readonly controlledQueryId?: string;
  readonly workspaceDir: string;
}) => Promise<DatabaseQueryResult>;

export interface BrowserPage {
  goto(url: string, options?: { timeout?: number }): Promise<void>;
  title(): Promise<string>;
  textContent(selector: string): Promise<string | null>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<Buffer | undefined>;
  close(): Promise<void>;
}


export type BrowserLauncher = (input: { readonly headless?: boolean }) => Promise<BrowserPage>;

export interface CheckRunnerContext {
  readonly context: ExecutionContext;
  readonly presentEvidence: readonly string[];
  readonly changedFiles: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly allowNetwork: boolean;
  readonly runDir: string;
  readonly evidenceDir: string;
  readonly fetchHttp: HttpFetcher;
  readonly executeDatabase: DatabaseExecutor;
  readonly launchBrowser: BrowserLauncher;
  readonly now?: () => Date;
}

export type CheckRunner = (
  step: ValidationStep,
  ctx: CheckRunnerContext,
) => Promise<ValidationCheckResult>;
