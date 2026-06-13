# Plan: o-take-ownership-of-this-project-and-delig-20260612

## Objective
Take ownership of Helioverse after Wave-0 contract completion and drive Wave 1 as far as possible with a cross-model agent factory. Each code-producing engineer has a validator on the other model family: DeepSeek builders get GPT validators; GPT builders get DeepSeek validators.

Canonical project home: `~/dev/helioverse/`.

## Current State
- Wave 0 contracts are frozen and green: `uv run contracts/tests/validate.py`.
- Phase 0 bootstrap is complete: workspace, app shell, Rust/WASM crate, contract helpers, and worker package boundaries exist.
- Wave 1 local/fixture implementation is complete for W1-P1 through W1-P9 and cross-model validated; live deployment/live-key checks remain blocked by provisioning.
- Human provisioning still blocks live deployment/live-key checks for W1-P1, W1-P4, and W1-P7: Cloudflare account/domain/R2 public domain, NASA API key, VAPID keypair. Agents must not require secrets to pass local fixture tests.

## Execution Log — 2026-06-12
- **F0-B** DeepSeek builder + **F0-V** GPT validator: PASS. Added monorepo/workspace skeleton, docs, package boundaries, worker standalone workspace repair, and no-secret env examples.
- **W1-P1a** GPT builder + DeepSeek validator: PASS. SWPC L1 plasma/mag adapter with fixture parsers/tests.
- **W1-P1b** DeepSeek builder + GPT validator: PASS. SWPC Kp/Dst/F10.7/scales adapter with Kp→G vectors.
- **W1-P1c** GPT builder + DeepSeek validator: PASS. OVATION metadata/R2-pointer adapter.
- **W1-P1d** DeepSeek builder + GPT validator: PASS. DONKI event adapter with stable IDs, versioned kinematics, and links.
- **W1-P1e** GPT builder + DeepSeek validator: PASS. GOES CSM scalar-only point-answer boundary with forecast-only fallback.
- **W1-P1f** DeepSeek builder + GPT validator: PASS. Combined snapshot writer and append-only R2/KV key planner.
- **W1-P2** GPT builder + DeepSeek validator: PASS. Rust helio-core reproduces golden vectors.
- **W1-P3** DeepSeek builder + GPT validator: PASS after validator-driven fix to sync WebGPU detection.
- **W1-P4** GPT builder + DeepSeek validator: PASS. Imagery failover/thumbnail pipeline.
- **W1-P5** DeepSeek builder + GPT validator: PASS after validator-driven terminator and time-window fixes.
- **W1-P6** GPT builder + DeepSeek validator: PASS. Timeline scrubber model/story/hindcast safety.
- **W1-P7** DeepSeek builder + GPT validator: PASS. Alerts worker model/sweep/push-skip harness.
- **W1-P8** GPT builder + DeepSeek validator: PASS. Metric panels and event detail model.
- **W1-P9** DeepSeek builder + GPT validator: PASS. Backfill plan/types and coverage harness.
- **W2-Web Integration** GPT builder + DeepSeek validator: PASS. Fixture dashboard wires scene preview, metrics, aurora panel, timeline, event detail, B3 tie-in, NOAA/readiness text, and hindcast-safety indicator without modifying feature internals.
- **Final local gate**: `uv run contracts/tests/validate.py`; `cargo test -p helio-core`; `cargo test --manifest-path workers/{ingest,imagery,alerts,backfill}/Cargo.toml --lib`; `npm --prefix apps/web run check:types`; `npm --prefix apps/web run build` all pass.

## Dependency Analysis
- `contracts/` is the single source of truth. Downstream work must validate against JSON Schemas, golden fixtures, golden numeric vectors, and `contracts/r2-layout.md`, not against sibling package implementations.
- A bootstrap phase is required before Wave 1 fan-out because all Wave-1 packages otherwise contend over root workspace files (`package.json`, `Cargo.toml`, tsconfigs, wrangler config, app shell). Bootstrap creates package boundaries and stubs so Wave-1 agents can write in disjoint directories.
- After bootstrap, Wave-1 packages are independent by scope:
  - Rust/WASM math: `crates/helio-core/`.
  - Web client features: `apps/web/src/scene/`, `apps/web/src/features/aurora/`, `apps/web/src/features/timeline/`, `apps/web/src/features/panels/`.
  - Cloudflare workers: `workers/ingest/`, `workers/imagery/`, `workers/alerts/`, `workers/backfill/`.
  - Shared generated/read-only contracts: `packages/contracts/` created by bootstrap and treated as stable during Wave 1.
- Wave 2 integration is blocked on named Wave-1 validators only; it should wire features together, not redefine contracts.

## Global Agent Rules
1. Read this plan and `helioverse_spec.md` before implementation.
2. Never modify `contracts/**` unless a task explicitly says so. Contract drift is forbidden.
3. Never commit or invent secrets. Use `.dev.vars.example`, `.env.example`, documented placeholders, and skipped live tests when keys are absent.
4. Builders must run their local checks plus `uv run contracts/tests/validate.py` before reporting done when practical.
5. Validators are read-only. They output `PASS` or `FAIL` with exact commands run and concrete remediation.
6. Keep work inside assigned WRITE scope. Cross-scope writes are task failure.

## Proposed Repository Layout
```text
apps/web/                 # Vite React TypeScript client, three.js/WebGPU primary + WebGL2 fallback
crates/helio-core/        # Rust -> WASM physics/scoring crate implementing frozen API semantics
packages/contracts/       # generated/read-only TS contract helpers from Wave-0 schemas/fixtures
workers/ingest/           # Cloudflare Worker scheduled ingest + feed adapters + snapshot writer
workers/imagery/          # imagery cache/failover + Helioviewer ROI thumbnail writer
workers/alerts/           # Web Push subscription API + cron sweep
workers/backfill/         # 30-day history/event backfill tooling
contracts/                # frozen Wave-0 artifacts; do not modify
specs/                    # orchestration plans
```

## Team Members / Model Pairing
| Stream | Builder Model | Validator Model | Rule |
|---|---|---|---|
| DeepSeek builder streams | `deepseek/deepseek-v4-pro` | `openai-codex/gpt-5.4-mini` | GPT validates DeepSeek output |
| GPT builder streams | `openai-codex/gpt-5.5` | `deepseek/deepseek-v4-flash` | DeepSeek validates GPT output |

## Phase 0 — Bootstrap / Shared Boundaries

### F0-B: Bootstrap monorepo and harness
- **Agent role**: engineer
- **Model**: `deepseek/deepseek-v4-pro`
- **Dependencies**: none
- **READ**: `helioverse_spec.md`, `contracts/**`
- **WRITE**: root workspace files, `apps/web/**`, `crates/**`, `packages/**`, `workers/**`, `tests/**`, `docs/**`
- **Acceptance Criteria**:
  - Workspace skeleton exists without secrets.
  - Root scripts include contract validation and reasonable lint/type/test entry points.
  - App/worker/crate package boundaries exist so Wave-1 agents can write in disjoint scopes.
  - `uv run contracts/tests/validate.py` remains green.
  - Documentation explains local setup and provisioning placeholders.

### F0-V: Validate bootstrap
- **Agent role**: validator
- **Model**: `openai-codex/gpt-5.4-mini`
- **Dependencies**: F0-B
- **READ**: entire repo
- **Acceptance Criteria**:
  - F0-B criteria are objectively verified.
  - No contract drift, no secrets, no cross-scope surprises.

## Phase 1 — Wave-1 Fan-Out
All Phase-1 builders depend on F0-V. All validators depend on their paired builder.

### W1-P1a-B: SWPC L1 plasma/mag feed adapter
- **Builder Model**: `openai-codex/gpt-5.5`
- **Validator Model**: `deepseek/deepseek-v4-flash`
- **WRITE**: `workers/ingest/src/feeds/swpc_l1*`, related tests/fixtures under `workers/ingest/`
- **Acceptance**: fixture parser + optional live pull; produces typed speed/density/temp/Bz samples with source/as-of timestamps.

### W1-P1b-B: SWPC indices feed adapter
- **Builder Model**: `deepseek/deepseek-v4-pro`
- **Validator Model**: `openai-codex/gpt-5.4-mini`
- **WRITE**: `workers/ingest/src/feeds/swpc_indices*`, related tests/fixtures
- **Acceptance**: Kp/Dst adapter with schema-valid normalized output and clock metadata.

### W1-P1c-B: OVATION feed adapter
- **Builder Model**: `openai-codex/gpt-5.5`
- **Validator Model**: `deepseek/deepseek-v4-flash`
- **WRITE**: `workers/ingest/src/feeds/ovation*`, related tests/fixtures
- **Acceptance**: auroral oval metadata/pointer generation validates against snapshot schema expectations.

### W1-P1d-B: DONKI event adapter
- **Builder Model**: `deepseek/deepseek-v4-pro`
- **Validator Model**: `openai-codex/gpt-5.4-mini`
- **WRITE**: `workers/ingest/src/feeds/donki*`, related tests/fixtures
- **Acceptance**: stable event IDs, versioned kinematics, link edges; event fixtures validate against `contracts/schemas/event.schema.json`.

### W1-P1e-B: GOES CSM sampler stub + adapter boundary
- **Builder Model**: `openai-codex/gpt-5.5`
- **Validator Model**: `deepseek/deepseek-v4-flash`
- **WRITE**: `workers/ingest/src/feeds/goes_csm*`, related tests/fixtures
- **Acceptance**: Tier-0 point-answer interface, graceful unavailable/forecast-only fallback, no raster decoding in worker.

### W1-P1f-B: Combined snapshot writer + append-only as-of store
- **Builder Model**: `deepseek/deepseek-v4-pro`
- **Validator Model**: `openai-codex/gpt-5.4-mini`
- **WRITE**: `workers/ingest/src/snapshot*`, `workers/ingest/src/storage*`, related tests
- **Acceptance**: combines normalized feed outputs into `snapshot.schema.json`, writes latest + immutable archive keys per `contracts/r2-layout.md`, enforces append-only/as-of invariants.

### W1-P2-B: Physics Rust->WASM crate
- **Builder Model**: `openai-codex/gpt-5.5`
- **Validator Model**: `deepseek/deepseek-v4-flash`
- **WRITE**: `crates/helio-core/**`
- **Acceptance**: implements DBM, Newell/Dst, L1 delay, go-look score, darkness/moon semantics from `contracts/wasm-api/helio_core_api.rs`; golden vectors pass within tolerance.

### W1-P3-B: WebGPU scene skeleton
- **Builder Model**: `deepseek/deepseek-v4-pro`
- **Validator Model**: `openai-codex/gpt-5.4-mini`
- **WRITE**: `apps/web/src/scene/**`, scene tests/stories only
- **Acceptance**: WebGPU feature detection, WebGL2 fallback path, Sun/Earth/L1/Parker grid, camera, true/compressed scale toggle, screenshot-capable browser story.

### W1-P4-B: Imagery pipeline
- **Builder Model**: `openai-codex/gpt-5.5`
- **Validator Model**: `deepseek/deepseek-v4-flash`
- **WRITE**: `workers/imagery/**`
- **Acceptance**: Helioviewer primary -> direct SDO/SUVI -> last-good fallback route table, ROI thumbnail object keys, staleness badge metadata, failover tests. No secret required for local fixtures.

### W1-P5-B: Aurora card + map
- **Builder Model**: `deepseek/deepseek-v4-pro`
- **Validator Model**: `openai-codex/gpt-5.4-mini`
- **WRITE**: `apps/web/src/features/aurora/**`, aurora tests/stories only
- **Acceptance**: fixture-driven tonight card, probability/window, oval render, viewline, terminator, user pin, degraded-delay label.

### W1-P6-B: Timeline scrubber
- **Builder Model**: `openai-codex/gpt-5.5`
- **Validator Model**: `deepseek/deepseek-v4-flash`
- **WRITE**: `apps/web/src/features/timeline/**`, timeline tests/stories only
- **Acceptance**: 30-day history/live/project scrub modes, event chips with thumbnail slots, click-to-focus event interface, fixture browser story.

### W1-P7-B: Alerts
- **Builder Model**: `deepseek/deepseek-v4-pro`
- **Validator Model**: `openai-codex/gpt-5.4-mini`
- **WRITE**: `workers/alerts/**`
- **Acceptance**: D1 subscription model validates against alert schema, VAPID config placeholders, synthetic threshold-cross push test with secrets skipped when absent.

### W1-P8-B: Metric panels
- **Builder Model**: `openai-codex/gpt-5.5`
- **Validator Model**: `deepseek/deepseek-v4-flash`
- **WRITE**: `apps/web/src/features/panels/**`, panel tests/stories only
- **Acceptance**: metric strip with Bz prominent, sparklines, threshold coloring, event detail panel, three-clock badge data model.

### W1-P9-B: History backfill
- **Builder Model**: `deepseek/deepseek-v4-pro`
- **Validator Model**: `openai-codex/gpt-5.4-mini`
- **WRITE**: `workers/backfill/**`
- **Acceptance**: 30-day in-situ/event/imagery backfill plan + executable tooling against fixtures, row counts, R2 key layout, archive-thin fallback note.

## Phase 2 — Integration Packages
Create after Phase 1 validators pass, or execute if already in task graph.

### W2-I1: Particles-on-DBM
Depends on W1-P2-V and W1-P3-V. Wire 100k+ GPU particle field to DBM outputs with cone/shell uncertainty widening.

### W2-I2: B3 tie-in
Depends on W1-P2-V, W1-P3-V, W1-P5-V. Earth-coupled tracked event lights predicted oval on globe.

### W2-I3: Ours-vs-NOAA toggle + three-clock badges
Depends on W1-P1f-V, W1-P5-V, W1-P8-V. Wire snapshot clocks and NOAA comparison into UI.

### W2-I4: Scrub modes and honest hindcast
Depends on W1-P1f-V, W1-P6-V, W1-P9-V. Past replay uses only prediction-time as-of data.

### W2-I5: Full repo integration pass
Depends on all Wave-1 validators and W2-I1..I4. Resolve package wiring, imports, app shell, worker scripts, and top-level checks.

## Phase 3 — Verification Fleet
- Contract/fixture CI sweep: all schemas, vectors, app/worker/crate tests.
- Browser QA user-flow stories and screenshot artifacts for canvas gate.
- Adversarial leakage pass: prove no prediction path reads future/as-outcome data.
- Device matrix plan and soak checklist; start 12-24h soak when deploy credentials exist.

## Initial Dispatch Decision
Proceed immediately with Phase 0. On F0-V PASS, fan out Phase 1 builders in parallel. Keep live deployment checks marked blocked on provisioning, but do not block local implementation or fixture validation.
