# Failure demonstration (autonomous debugging)

Proves autonomous debugging on the public catalog scenario without hardcoding PASS.

See also [AUTONOMOUS_DEBUGGING.md](./AUTONOMOUS_DEBUGGING.md) for the client recovery narrative.

## Recoverable path

```text
Deliberate failure (product set wrong on storefront)
  ↓
Capture logs / preserve failed-state/
  ↓
Classify → repair brief (reversible step)
  ↓
Agent investigates → smallest fix
  ↓
Targeted reproducer → regression / independent validation
  ↓
PASS | BLOCK  (circuit-break on repeated identical failures)
```

```bash
npm run scenario:failure-recoverable
npm run scenario:autonomous-debugging
```

Expected: `"status": "PASS"` after exactly one repair attempt. Evidence includes:

- `failure-demo.json` — step timeline + `recoveryProcess` + expected/actual
- `failed-state/` — preserved pre-repair logs and buggy catalog snapshot

## Unrecoverable path

```text
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
