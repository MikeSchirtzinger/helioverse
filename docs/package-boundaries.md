# Helioverse Package Boundaries

This document defines ownership, dependency rules, and integration contracts for each Wave-1 package. It is the **authoritative boundary reference** — agents must not cross scopes.

## Dependency Hierarchy

```
contracts/  (FROZEN — all packages validate against this)
    │
    ├── packages/contracts/  (read-only TS helpers; depends on contracts/)
    │       │
    │       ├── apps/web/  (depends on packages/contracts + crates/helio-core WASM)
    │       │
    │       └── workers/*  (each depends on packages/contracts + optional crates/helio-core)
    │
    └── crates/helio-core/  (independent; validates against contracts/fixtures/vectors/)
```

## Package Ownership

### apps/web/ (Vite React TS client)

**Wave-1 Owners:**
- `apps/web/src/scene/` — W1-P3 (WebGPU scene skeleton)
- `apps/web/src/features/aurora/` — W1-P5 (Aurora card + map)
- `apps/web/src/features/timeline/` — W1-P6 (Timeline scrubber)
- `apps/web/src/features/panels/` — W1-P8 (Metric panels)

**Rules:**
- Each feature directory is owned by exactly one builder during Wave 1.
- Shared UI/components go in `apps/web/src/components/` (bootstrap provides stubs).
- The app shell (`apps/web/src/App.tsx`, routing) is shared; coordinate changes through the spec.
- Consumes `@helioverse/contracts` for types and `crates/helio-core` for WASM physics.
- Does NOT import from any `workers/` directory.

### crates/helio-core/ (Rust→WASM physics crate)

**Wave-1 Owner:** W1-P2

**Rules:**
- Implements functions from `contracts/wasm-api/helio_core_api.rs` exactly.
- Must reproduce all golden vectors in `contracts/fixtures/vectors/` to stated tolerances.
- Publishes WASM bindings for browser (primary) and Workers (secondary).
- Does NOT depend on any other package in the repo.
- Does NOT make network calls or use system APIs.

### packages/contracts/ (TS contract helpers)

**Wave-0 Owner:** Bootstrap (generated once, frozen during Wave 1)

**Rules:**
- Read-only generated TS types and validators from Wave-0 schemas/fixtures.
- Points to contract schemas for validation; does NOT alter them.
- Provides typed JSON helpers for snapshot, event, and alert-subscription schemas.
- Published as `@helioverse/contracts` in the pnpm workspace.

### workers/ingest/ (Cloudflare Worker: ingest + snapshot)

**Wave-1 Owners:**
- `workers/ingest/src/feeds/swpc_l1*` — W1-P1a (SWPC L1 plasma/mag)
- `workers/ingest/src/feeds/swpc_indices*` — W1-P1b (SWPC indices)
- `workers/ingest/src/feeds/ovation*` — W1-P1c (OVATION)
- `workers/ingest/src/feeds/donki*` — W1-P1d (DONKI events)
- `workers/ingest/src/feeds/goes_csm*` — W1-P1e (GOES CSM)
- `workers/ingest/src/snapshot*`, `workers/ingest/src/storage*` — W1-P1f (snapshot writer)

**Rules:**
- Each feed adapter is owned by exactly one builder.
- All feed adapters produce typed output conforming to snapshot/event schemas.
- The snapshot writer (W1-P1f) combines feed outputs; coordinates with all feed owners.

### workers/imagery/ (Cloudflare Worker: imagery + thumbnails)

**Wave-1 Owner:** W1-P4

### workers/alerts/ (Cloudflare Worker: alerts)

**Wave-1 Owner:** W1-P7

### workers/backfill/ (Cloudflare Worker: backfill)

**Wave-1 Owner:** W1-P9

## Integration Contracts

### Client ↔ WASM
- `apps/web` imports wasm functions from `crates/helio-core/pkg/` via Vite WASM plugin.
- Function signatures match `contracts/wasm-api/helio_core_api.rs`.

### Client ↔ R2 (via CDN)
- Client fetches `v1/snapshot/latest.json` from the R2 public domain.
- Client fetches imagery from `v1/imagery/...` paths.
- Client fetches events from `v1/events/...` paths.
- All keys follow `contracts/r2-layout.md`.

### Workers → R2/KV
- Ingest worker writes snapshot to KV (`snapshot/latest`) and R2 (`v1/snapshot/...`).
- Imagery worker writes thumbnails and edge-caches SDO frames.
- Alerts worker reads KV snapshots for the alert sweep.

## Cross-Scope Rules

1. **No cross-scope writes during Wave 1.** Each builder writes only to their assigned directory.
2. **Validate against contracts, not siblings.**
3. **Coordinate at shared interfaces** through the contract schemas and R2 layout.
4. **Wave 2 (integration) owns all cross-package wiring.**
