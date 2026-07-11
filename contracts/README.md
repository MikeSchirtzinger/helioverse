# Helioverse physics contracts

This directory pins the numeric semantics shared by the Rust/WASM physics core
and its independent reference implementation.

```bash
uv run contracts/tests/validate.py
```

The command re-derives every golden vector from `tests/formulas.py`. The Rust
crate must reproduce the same vectors within each file's stated tolerance.

## Contents

| Artifact | Purpose |
| --- | --- |
| `wasm-api/helio_core_api.rs` | Units, validity ranges, and public physics surface |
| `fixtures/vectors/*.json` | Golden numeric cases for delay, DBM, coupling, astronomy, and local sky scoring |
| `tests/formulas.py` | Independent executable reference formulas |
| `tests/gen_vectors.py` | Vector regeneration tool |
| `tests/validate.py` | Reference-vector verifier |

These fixtures are test inputs only. They are never substituted for current
NOAA/NASA observations in the application.

## Rules

1. Units remain explicit in names: kilometres, km/s, nT, particles/cm³,
   degrees, and Unix seconds UTC.
2. Any numeric-semantic change requires regenerated vectors and matching Rust
   tests in the same commit.
3. Invalid or unavailable measurements return an error/unavailable state. The
   production UI must not turn them into a plausible-looking fallback value.
