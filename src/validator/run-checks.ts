import type { ValidationCheckResult, ValidationStep } from '../models/types.js';
import { playwrightBrowserLauncher } from './browser-launcher.js';
import type { CheckRunnerContext } from './check-types.js';
import { runBrowserPlaywrightCheck } from './checks/browser.js';
import { runBrowserJourneyCheck } from './checks/browser-journey.js';
import { runDatabaseStateCheck } from './checks/database.js';
import { runGraphqlRequestCheck } from './checks/graphql.js';
import { runApplicationHealthCheck } from './checks/health.js';
import { runHttpResponseCheck } from './checks/http.js';
import { runPathInvariantCheck } from './checks/path-invariant.js';
import { runPostgresReadyCheck, runRedisPingCheck } from './checks/service-ping.js';
import { runWorkspaceCheck } from './checks/workspace.js';
import { defaultDatabaseExecutor } from './database-executor.js';
import { defaultHttpFetcher } from './http-fetcher.js';

export async function runIndependentCheck(
  step: ValidationStep,
  ctx: CheckRunnerContext,
): Promise<ValidationCheckResult> {
  switch (step.type) {
    case 'evidence_present':
    case 'workspace_file_exists':
    case 'workspace_file_contains':
    case 'changed_files_include':
      return runWorkspaceCheck(step, ctx);
    case 'application_health':
      return runApplicationHealthCheck(step, ctx);
    case 'http_response':
      return runHttpResponseCheck(step, ctx);
    case 'graphql_request':
      return runGraphqlRequestCheck(step, ctx);
    case 'database_state':
      return runDatabaseStateCheck(step, ctx);
    case 'browser_playwright':
      return runBrowserPlaywrightCheck(step, ctx);
    case 'browser_journey':
      return runBrowserJourneyCheck(step, ctx);
    case 'path_invariant':
      return runPathInvariantCheck(step, ctx);
    case 'redis_ping':
      return runRedisPingCheck(step, ctx);
    case 'postgres_ready':
      return runPostgresReadyCheck(step, ctx);
    default: {
      const exhaustive: never = step;
      throw new Error(`Unsupported validation step: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function createDefaultCheckContext(
  partial: Omit<CheckRunnerContext, 'fetchHttp' | 'executeDatabase' | 'launchBrowser'> &
    Partial<Pick<CheckRunnerContext, 'fetchHttp' | 'executeDatabase' | 'launchBrowser'>>,
): CheckRunnerContext {
  return {
    ...partial,
    fetchHttp: partial.fetchHttp ?? defaultHttpFetcher,
    executeDatabase: partial.executeDatabase ?? defaultDatabaseExecutor,
    launchBrowser: partial.launchBrowser ?? playwrightBrowserLauncher,
  };
}
