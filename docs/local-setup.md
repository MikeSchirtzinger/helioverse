# Local Development Setup

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 20 | Frontend, Workers, tooling |
| **pnpm** | ≥ 9 | Package manager (Corepack: `corepack enable && corepack prepare pnpm@9.15.4 --activate`) |
| **Rust** | ≥ 1.80 (edition 2021) | helio-core physics crate |
| **wasm-pack** | latest | Rust→WASM build (`cargo install wasm-pack`) |
| **Python** | ≥ 3.11 | Contract validation |
| **uv** | latest | Python runner (`pip install uv` or `brew install uv`) |

## One-Time Setup

```bash
# 1. Clone and enter
cd ~/dev/helioverse

# 2. Install Node dependencies (fast — mostly TypeScript tooling, no heavy frameworks yet)
pnpm install

# 3. Verify contracts are green
uv run contracts/tests/validate.py
# Expected: CONTRACTS GREEN — all schemas, fixtures, invariants, and vectors agree

# 4. Build the Rust crate (optional; needed for WASM + golden-vector tests)
cd crates/helio-core && cargo build

# 5. Verify golden vectors (once crate is implemented)
cd crates/helio-core && cargo test
```

## Day-to-Day

```bash
# Contract validation (always green)
uv run contracts/tests/validate.py

# Type-check all packages (skips if deps not installed)
pnpm check:types

# Start web dev server
pnpm dev:web

# Run Rust tests
pnpm rust:test

# Build WASM (for client import)
pnpm rust:wasm
```

## Secrets

No secrets are committed. See `.env.example` and `.dev.vars.example` for the placeholder structure. Copy them to `.env` / `.dev.vars` and fill in values for live deployment. All local tests and fixtures work without secrets.

## Cloudflare Workers (local dev)

Each worker has its own `Cargo.toml` and `wrangler.toml`:

```bash
cd workers/ingest
# Edit wrangler.toml with your account_id
npx wrangler dev
```

Workers run locally with `wrangler dev` against fixtures, not live upstreams.
