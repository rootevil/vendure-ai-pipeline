# Offline validators

Artifact-only PASS/BLOCK re-check lives in:

```bash
node packages/validator/bin/validate.mjs --run-dir artifacts/<run_id>
```

In-process independent checks: `src/validators/` (façade) → `src/validator/` (implementation).
