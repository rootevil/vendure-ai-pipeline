/** Write-scope and network permission helpers. */
export {
  assertNetworkAllowed,
  createExecutionContext,
  SafetyError,
  type ExecutionContext,
} from './execution-context.js';
export { assertTaskSafe } from '../task/task-safety.js';
