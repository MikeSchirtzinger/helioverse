# Helioverse

**A data-grounded journey from the Sun to Earth's aurora.**

Production: [helioverse.app](https://helioverse.app)

Helioverse combines current NOAA and NASA observations with explicitly labelled
physics models to make the Sun → solar wind → magnetosphere → aurora chain
understandable. It never substitutes fixtures or decorative values when a live
source is unavailable.

## Truth model

- **Measured:** current NOAA RTSW, NASA DONKI, GOES, Helioviewer/SDO, GFZ, and
  OVATION fields.
- **Modelled:** DBM propagation, WSA–ENLIL outputs, Shue magnetopause, and Newell
  coupling.
- **Estimated:** derived quantities whose assumptions are shown.
- **Interpolated:** visual motion between real anchors, always labelled.

Current observations are withheld when the user scrubs to a historical event.
See [CLAUDE.md](./CLAUDE.md) for the full scientific and provenance contract.

## Stack

- React 19 + TypeScript + Vite
- Three.js WebGPU primary renderer with WebGL2 fallback
- Rust/WASM physics core with golden-vector tests
- Cloudflare Pages advanced Worker for static assets and bounded NASA,
  Helioviewer, and GFZ proxy routes
- Append-only DONKI event/outcome ledger with scheduled offline residual
  training, chronological holdout backtesting, and a shadow model registry

## Quick start

Requirements: Node 20+, Corepack/pnpm, Rust 1.80+, `wasm-pack`, Python 3.11+,
and `uv`.

```bash
corepack pnpm install
cp .env.example apps/web/.env.local
# Fill NASA_DONKI_KEY in apps/web/.env.local.

corepack pnpm check:all
corepack pnpm rust:test
corepack pnpm dev:web
```

`dev:web` builds the WASM package when needed and starts Vite on port 3000.
The NASA key is used only by the development proxy; it is never bundled into
browser JavaScript.

## Build and deploy

```bash
corepack pnpm build:web
cd apps/web
corepack pnpm exec wrangler pages deploy dist \
  --project-name helioverse \
  --branch main
```

The production Pages project stores `NASA_DONKI_KEY` as an encrypted secret.
`GET https://helioverse.app/api/health` reports whether that binding exists
without exposing it.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Responsive WebGPU experience and Cloudflare Pages Worker |
| `crates/helio-core/` | Rust/WASM physics implementation |
| `contracts/` | Executable physics contracts and golden numeric vectors |
| `learning/` | Versioned exact-link ledger, offline run reports, schemas, and model registry |
| `scripts/learning/` | Real DONKI collection, ridge-residual training, backtest, and ledger verification |
| `docs/` | Current setup and future visual design contracts |

## Validation boundary

`check:all` validates the physics contracts, TypeScript, ESLint rules, frontend
unit tests (including the compiled-WASM golden vectors), and the offline-learning
ledger/trainer tests. `check:learning` additionally proves the public gate counts
and production registry entry match the persisted ledger. `pnpm rust:check`
enforces formatting, native and WASM Clippy, Rust tests, and warning-free docs.

The weekly `Refresh learning ledger` workflow runs only with the repository's
`NASA_DONKI_KEY` secret. The residual learner remains disabled until both exact
link heads reach 10 outcomes; passing candidates enter shadow status, while
WSA–ENLIL plus DBM remains production. See [learning/README.md](./learning/README.md).
