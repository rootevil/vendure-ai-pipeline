# Rollback (Phase 1)

Keep it simple.

```text
Before Agent modification:
  git checkpoint   (+ filesystem workspace-checkpoint/)

After successful run:
  commit / preserve   (evidence keeps git-diff.patch; optional local pipeline-preserve commit)

After unrecoverable failure:
  git diff
  git reset / restore workspace
```

The disposable run workspace is the only mutation surface. Client main and production are never rolled back by the pipeline.

## Acceptance conditions

The scenario compiler emits `cleanup` and `rollback` arrays on every technical scenario (see [SCENARIO_COMPILER.md](./SCENARIO_COMPILER.md)). Evidence always includes:

| File | Role |
| --- | --- |
| `rollback.md` | Human instructions + outcome |
| `rollback-outcome.json` | `{ action: preserve \| rollback, … }` |
| `git-diff.patch` | Captured before restore on failure |
| `workspace-checkpoint/` | Filesystem snapshot fallback |
| `checkpoint-meta.json` | Checkpoint metadata (includes git ref when available) |

## Code

| Module | Role |
| --- | --- |
| `src/safety/git-checkpoint.ts` | Pre-agent checkpoint, preserve, rollback |
| `src/safety/workspace-checkpoint.ts` | Filesystem snapshot / restore |
| `src/controller/pipeline-controller.ts` | Calls checkpoint before agent; apply policy after verdict |
| `packages/validator/bin/restore-checkpoint.mjs` | Manual restore CLI |

## Related

- [EVIDENCE_PACKAGE.md](./EVIDENCE_PACKAGE.md)  
- [SAFETY.md](./SAFETY.md)  
- [SCENARIO_COMPILER.md](./SCENARIO_COMPILER.md)  
