# Failure demonstration (Phase 9)

Proves autonomous debugging on the public catalog scenario without hardcoding PASS.

## Recoverable path

```
controlled bug → detect → classify → repair brief for Agent
  → bounded repair → targeted validation → broader validation → PASS|BLOCK
```

```bash
npm run scenario:failure-recoverable
```

Expected: `"status": "PASS"` after exactly one repair attempt. Evidence includes `failure-demo.json` with the step timeline.

## Unrecoverable path

```
unsafe/secret failure → classify → immediate stop → BLOCK + evidence
```

No repair loop is entered.

```bash
npm run scenario:failure-unrecoverable
```

Expected: `"status": "BLOCK"`, `"repairAttempts": 0`.

## Notes

- Controlled bug lives in `evaluation-demo/app/src/catalog.buggy.mjs` (inactive kept + `internalNote` leaked).
- Repair applies the published `expected-results/reference-catalog.mjs` only after reading `.pipeline/repair-brief.json`.
- Broader PASS/BLOCK still comes from the independent validator, not the Agent claim.
