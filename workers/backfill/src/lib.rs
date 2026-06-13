//! helio-backfill — Cloudflare Worker: History Backfill
//!
//! W1-P9-B: 30-day in-situ/event/imagery backfill plan + executable tooling
//! Owner: DeepSeek builder (deepseek/deepseek-v4-pro)
//!
//! Acceptance:
//! - 30-day in-situ/event/imagery backfill plan (types::BackfillPlan)
//! - Executable tooling against fixtures (build_backfill_plan)
//! - Row counts + coverage checks (CoverageReport)
//! - R2 key layout per contracts/r2-layout.md (r2 key helpers)
//! - Archive-thin fallback note/status (ArchiveStatus::Thin + notes)
//! - No live credentials required (requires_live_auth: false)

pub mod types;

use worker::*;

#[event(fetch)]
async fn main(_req: Request, _env: Env, _ctx: Context) -> Result<Response> {
    Response::ok("helio-backfill v0.1")
}
