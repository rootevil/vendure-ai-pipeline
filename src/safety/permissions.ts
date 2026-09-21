/** Write-scope and network permission helpers. */
export {
  assertNetworkAllowed,
  createExecutionContext,
  SafetyError,
  type ExecutionContext,
} from './execution-context.js';
export { assertTaskSafe } from '../task/task-safety.js';
export { SafetyKernel, defaultSafetyKernel } from './safety-kernel.js';
export {
  DEFAULT_SAFETY_POLICY,
  type SafetyPolicy,
  type AllowedAgentAction,
  type ForbiddenDefault,
} from './policy.js';
export { GuardingProcessRunner } from './command-guard.js';
