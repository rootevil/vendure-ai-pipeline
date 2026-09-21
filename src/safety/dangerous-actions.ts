/** Dangerous / unsafe action detection. */
export { scanTextForSafetyViolations, SafetyError } from './execution-context.js';
export { classifyFailure } from '../retry/failure-classifier.js';
export { SafetyKernel, defaultSafetyKernel } from './safety-kernel.js';
export { DESTRUCTIVE_COMMAND_PATTERNS } from './policy.js';
