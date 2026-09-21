/** Rollback / checkpoint helpers (Phase 1). */
export {
  createWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
  type CheckpointMeta,
} from './workspace-checkpoint.js';
export {
  createPreAgentCheckpoint,
  applyRollbackPolicy,
  type PreAgentCheckpointResult,
  type RollbackOutcome,
  type RollbackAction,
  type GitCheckpointState,
} from './git-checkpoint.js';
