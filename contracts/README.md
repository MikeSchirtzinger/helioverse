# Helioverse contracts/ — Wave 0 artifacts (FROZEN v1.0.0, 2026-06-12)

These are the frozen interfaces every work package pins to (spec §11.2, Wave 0).
Packages develop and verify **against the fixtures here, not against each other** —
that is what lets nine Wave-1 loops run without blocking.

**Green light:** `uv run contracts/tests/validate.py` → exit 0.
Run it before dispatching Wave 1, and in every package's CI.

## What's here

| Artifact | File(s) | Consumed by |
|---|---|---|
| Combined snapshot schema | `schemas/snapshot.schema.json` | W1-P1 pollers (writer), W1-P5/P6/P8 UI (readers), W1-P7 alert sweep |
| Event schema (+ Prediction, Outcome) | `schemas/event.schema.json` | W1-P1 DONKI poller, W1-P6 timeline, eval machinery |
| Alert subscription schema | `schemas/alert-subscription.schema.json` | W1-P7 alerts |
| WASM API surface | `wasm-api/helio_core_api.rs` | W1-P2 physics crate (implements), client + Workers (call) |
| R2 layout + retention + budget math | `r2-layout.md` | W1-P1, W1-P4, W1-P9 writers; all client readers |
| Golden fixtures (instances) | `fixtures/snapshot/`, `fixtures/events/` | every package's tests |
| Golden vectors (numeric) | `fixtures/vectors/*.json` | W1-P2 — the crate MUST reproduce these |
| Reference semantics (executable) | `tests/formulas.py` | generator + validator; the pinned math in runnable form |

## Rules

1. **Units live in field names** (`_kms`, `_nt`, `_pcc`, `_deg`, `_s`, `_k`). Never strip them.
   All timestamps ISO-8601 UTC `...Z`; B-field is GSM frame; heliographic = Stonyhurst.
2. **Schemas are closed** (`additionalProperties: false`). Adding a field = minor version bump
   (`schema_version` pattern admits any `1.x.y`); removing/renaming/retyping = major bump +
   migration note here. Same rule for any constant in the WASM API doc — change a go-look
   weight, bump the version, regenerate vectors (`uv run contracts/tests/gen_vectors.py`).
3. **The Rust crate is correct iff it reproduces `fixtures/vectors/` to the stated tolerances.**
   Numeric semantics are pinned in `wasm-api/helio_core_api.rs` (closed forms where they exist,
   explicit Euler where an integrator is needed) precisely so independent implementations agree.
4. **Leakage gate:** `prediction.inputs_as_of` ≤ `predicted_at`, and hindcasts may only use
   kinematics versions with `measured_at` ≤ `inputs_as_of`. The validator enforces this on
   fixtures; the Wave-3 adversarial pass enforces it on the live system.
5. **Degraded rule:** stale/gapped L1 plasma → `delay_s = 1800`, `delay_quality =
   "degraded_fixed"`, and the UI shows the degraded label (spec §2.1). Never silently
   extrapolate a dead speed reading.
6. Archive keys in R2 are **write-once** (`r2-layout.md` failure semantics) — the append-only
   as-of record is the foundation of the entire eval story. Treat any overwrite as a sev-1.

## Fixture inventory

- `snapshot-quiet.json` — calm conditions, all sources ok, measured delay (380 km/s → 3894.7 s,
  more than double NOAA's fixed 30 min — the §2.1 story in one number).
- `snapshot-storm.json` — G3 in progress: 720 km/s, Bz −17.4, Kp 7.33, active CME, SWPC alert.
- `snapshot-degraded.json` — stale plasma feed → fixed-delay fallback + nulls/gaps in series.
- `event-cme-halo.json` — in-flight X-flare-associated halo CME, two kinematics versions
  (revision history), one open DBM prediction. ETA is consistent with the `fast_halo_to_1au`
  vector in `vectors/dbm.json` (44.5 h transit).
- `event-cme-resolved.json` — closed record: prediction + nature's answer (hit, −3.2 h signed
  error, inside the stated 80 % window). The eval loop's unit of account.
- `event-flr.json` — the linked flare; shows the `causes`/`caused_by` graph edges.
