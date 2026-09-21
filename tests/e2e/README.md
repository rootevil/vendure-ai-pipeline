# Tests layout

Phase 1 executable tests live in the repo-root `test/` directory (`npm test`).

This tree mirrors the target layout:

| Path | Intent |
| --- | --- |
| `tests/unit/` | Pure classifiers, schema, safety |
| `tests/integration/` | Controller + validator with fixtures |
| `tests/e2e/` | Scenario demos (catalog, failure) |

Until tests are physically split, run:

```bash
npm test
npm run scenario:public-catalog
npm run scenario:failure-recoverable
```
