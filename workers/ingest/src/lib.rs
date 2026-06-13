//! helio-ingest — Cloudflare Worker: Ingest + Snapshot Writer
//!
//! ## Wave-1 Owners (each owns their submodule):
//! - `feeds/swpc_l1/`  — W1-P1a-B (GPT builder, model: openai-codex/gpt-5.5)
//! - `feeds/swpc_indices/` — W1-P1b-B (DeepSeek builder, model: deepseek/deepseek-v4-pro)
//! - `feeds/ovation/`  — W1-P1c-B (GPT builder)
//! - `feeds/donki/`    — W1-P1d-B (DeepSeek builder)
//! - `feeds/goes_csm/` — W1-P1e-B (GPT builder)
//! - `snapshot/` + `storage/` — W1-P1f-B (DeepSeek builder)
//!
//! ## Rules
//! - Each feed adapter validates its output against the relevant schema in contracts/schemas/.
//! - The snapshot writer combines feed outputs into a `Snapshot` object matching
//!   contracts/schemas/snapshot.schema.json and writes per contracts/r2-layout.md.
//! - Do NOT modify sibling feed adapters. Coordinate at the Snapshot schema boundary.
//! - All HTTP pulls use the Fetch API (reqwasm). No secrets in fixtures.

pub mod feeds;
pub mod snapshot;
pub mod storage;

use worker::*;

/// Cron trigger entrypoint.  Dispatches on the cron pattern configured in
/// wrangler.toml.  Each feed adapter performs its own fetch + parse; the
/// snapshot writer assembles a combined snapshot and returns key plans for
/// the storage layer.
///
/// ## Secrets note
/// The worker boundary expects `.dev.vars` / Cloudflare secrets for:
///   - NASA DONKI API key (DEMO_KEY works for dev)
///   - VAPID keys (alert worker only)
/// No secrets are required for local fixture tests.
#[event(fetch)]
async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let router = Router::new();
    router
        .get("/", |_req, _ctx| Response::ok("helio-ingest v0.1"))
        .get_async("/health", |_req, _ctx| async move {
            // Liveness: returns a KeyPlan snapshot to prove storage layer is wired.
            let now = chrono::Utc::now();
            let plan = crate::storage::plan_write_safe(&now);
            Response::from_json(&plan)
        })
        .run(req, env)
        .await
}
