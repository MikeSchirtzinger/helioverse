# Local development

## Prerequisites

| Tool | Minimum | Purpose |
| --- | --- | --- |
| Node.js | 20 | Frontend and tooling |
| pnpm via Corepack | 9 | Workspace package manager |
| Rust | 1.80 | Physics core |
| `wasm-pack` | current | Rust → browser WASM |
| Python | 3.11 | Contract validation |
| `uv` | current | Python environment runner |

## Install and configure

```bash
corepack pnpm install
cp .env.example apps/web/.env.local
```

Set `NASA_DONKI_KEY` in `apps/web/.env.local`. Vite reads it server-side for
the `/donki` development proxy. Variables without a `VITE_` prefix are not
exposed to the browser bundle.

## Daily commands

```bash
# Physics contracts, TypeScript, ESLint, and frontend unit tests
corepack pnpm check:all

# Rust physics unit and golden-vector tests
corepack pnpm rust:test

# Rebuild WASM and create the production frontend bundle
corepack pnpm build:web

# Build WASM if needed and launch Vite on port 3000
corepack pnpm dev:web
```

## Local Pages Worker

To test the exact edge routes and security headers used in production:

```bash
corepack pnpm build:web
cp apps/web/.dev.vars.example apps/web/.dev.vars
# Fill NASA_DONKI_KEY in apps/web/.dev.vars.

cd apps/web
corepack pnpm exec wrangler pages dev dist
```

The Worker intentionally returns HTTP 503 from DONKI routes when the secret is
missing. It never falls back to NASA's shared demo key.

## Generated files

`apps/web/src/wasm/`, `apps/web/dist/`, Rust `target/`, Wrangler state, and local
secret files are ignored. Rebuild them from source rather than committing them.
