# Evidence package

Every pipeline run writes a reviewable package under:

```text
runs/
└── 2026-09-21-001/
    ├── task.json
    ├── scenario.json
    ├── execution.log
    ├── agent.log
    ├── git-diff.patch
    ├── validation.json
    ├── api/
    ├── graphql/
    ├── screenshots/
    ├── playwright/
    ├── database/
    ├── recovery.json
    ├── rollback.md
    └── final-report.html
```

Root defaults to `PIPELINE_ARTIFACTS_DIR` (`./runs`). Run ids are `YYYY-MM-DD-NNN` unless `PIPELINE_RUN_ID` is set.

Compatibility aliases remain (`result.json`, `summary.html`, `git.diff`, `api-responses/`, `evidence-manifest.json`, …).

## Final report questions

`final-report.html` answers:

1. WHAT WAS REQUESTED?
2. WHAT DID THE AGENT DO?
3. WHAT CHANGED?
4. WHAT WAS TESTED?
5. WHAT ACTUALLY PASSED?
6. WHAT FAILED?
7. WAS ANY RETRY PERFORMED?
8. WHY?
9. WAS ROLLBACK NEEDED?
10. FINAL RESULT?

PASS/BLOCK comes from the independent validator and this package — not from the agent self-report. See also `recovery.json` (retries / circuit break) and `rollback.md`.

## Code

| Module | Role |
| --- | --- |
| `src/evidence/evidence-collector.ts` | Mid-run logs, dirs, early files |
| `src/evidence/evidence-pack.ts` | Finalize client layout + `final-report.html` |
| `src/safety/execution-context.ts` | Sequential `YYYY-MM-DD-NNN` run ids |

## Related

- [VALIDATION.md](./VALIDATION.md)  
- [RETRY_POLICY.md](./RETRY_POLICY.md)  
- [QUICKSTART.md](./QUICKSTART.md)  
