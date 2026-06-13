# Helioverse

**Aurora Forecasting on a Live 3D Heliosphere**

Helioverse tracks solar events — flares, CMEs, shocks — and propagates them through a live 3D simulation to answer one question: *can I see the aurora tonight from here?*

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Validate contracts (requires Python + uv)
uv run contracts/tests/validate.py

# 3. Build the Rust/WASM physics crate
cd crates/helio-core && cargo build

# 4. Start the web app
pnpm dev:web
```

## Repository Layout

| Directory | Purpose | Wave-1 Owner |
|---|---|---|
| `contracts/` | **FROZEN** Wave-0 schemas, fixtures, golden vectors, tests | Do not modify |
| `apps/web/` | Vite React TS client: 3D scene, aurora, timeline, panels | W1-P3, W1-P5, W1-P6, W1-P8 |
| `crates/helio-core/` | Rust→WASM physics/scoring crate | W1-P2 |
| `packages/contracts/` | Read-only TS helpers generated from Wave-0 schemas/fixtures | Bootstrap |
| `workers/ingest/` | Cloudflare Worker: SWPC/OVATION/DONKI pollers → snapshot writer | W1-P1 |
| `workers/imagery/` | Cloudflare Worker: Helioviewer ROI thumbnails + imagery cache | W1-P4 |
| `workers/alerts/` | Cloudflare Worker: Web Push subscriptions + alert sweep | W1-P7 |
| `workers/backfill/` | Cloudflare Worker: 30-day history backfill tooling | W1-P9 |
| `specs/` | Orchestration plans | Bootstrap |
| `docs/` | Agent documentation, setup guides, boundary rules | Bootstrap |

## Agent Rules

1. **Never modify `contracts/**`** unless a task explicitly says so. Contract drift is forbidden.
2. **Never commit secrets.** Use `.env.example`/`.dev.vars.example` as templates. Live tests skip when keys are absent.
3. **Validate against contracts, not siblings.** Verify against schemas, golden fixtures, and golden vectors in `contracts/`, not against other packages' implementations.
4. **Each Wave-1 package owns its directory.** Cross-scope writes are task failure. Coordinate at integration boundaries.
5. **Wave-1 builders must run `uv run contracts/tests/validate.py`** before reporting done.

## Contract Validation

The green light for all work:
```bash
uv run contracts/tests/validate.py   # exit 0 = contracts green
```

This validates:
- All fixtures against JSON Schemas (draft 2020-12)
- Snapshot cross-invariants (delay math, arriving-now alignment, degraded rule)
- Event cross-invariants (leakage gate, kinematics versioning)
- Golden vector re-derivation from the pinned formulas

## Package Boundaries

See `docs/package-boundaries.md` for detailed ownership, dependency rules, and integration contracts for each Wave-1 package.

## Provisioning (Blocked on Human)

These are documented in `.env.example`:
- Cloudflare account/domain/R2 public domain (W1-P1, W1-P4, W1-P7, W1-P9)
- NASA API key for DONKI (W1-P1d)
- VAPID keypair for Web Push (W1-P7)

No live tests require these; all local tests use fixtures from `contracts/fixtures/`.
