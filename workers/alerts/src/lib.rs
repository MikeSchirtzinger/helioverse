//! helio-alerts — Cloudflare Worker: Web Push Alerts
//!
//! W1-P7: Web Push subscription API + cron alert sweep
//! Owner: DeepSeek builder (deepseek/deepseek-v4-pro) / GPT validator
//!
//! ## Architecture
//! - **Subscribe endpoint** (`POST /subscribe`): Accepts a subscription JSON
//!   body matching `contracts/schemas/alert-subscription.schema.json`, validates
//!   it, and stores it in D1.
//! - **Cron sweep** (`#[event(scheduled)]`): Loads all subscriptions from D1,
//!   loads the latest snapshot, evaluates thresholds, and sends Web Push
//!   notifications for crossing subscriptions.
//! - **VAPID config**: Secrets-based; no-op when absent (local dev/test path).
//!
//! ## Acceptance criteria (from task W1-P7-B)
//! 1. D1 subscription row model validates against alert schema shape.
//! 2. VAPID config placeholders / no secrets in repo.
//! 3. Subscription privacy rounding (lat/lon to 1 decimal).
//! 4. Cron sweep against synthetic snapshot thresholds.
//! 5. Synthetic threshold-cross push test with actual network/push skipped
//!    when secrets absent.
//!
//! ## Secrets (placeholders — set in Cloudflare dashboard for prod)
//! | Secret | Purpose |
//! |--------|---------|
//! | `VAPID_SUBJECT` | `mailto:` or app URL |
//! | `VAPID_PUBLIC_KEY` | Base64url EC P-256 public key |
//! | `VAPID_PRIVATE_KEY` | Base64url EC P-256 private key |
//!
//! ## D1 table
//! ```sql
//! CREATE TABLE IF NOT EXISTS subscriptions (
//!   subscription_id TEXT PRIMARY KEY,
//!   created_at      TEXT NOT NULL,
//!   json_body       TEXT NOT NULL,
//!   lat_deg         REAL NOT NULL,
//!   lon_deg         REAL NOT NULL
//! );
//! ```

pub mod model;
pub mod push;
pub mod sweep;

use worker::*;

use crate::model::SubscriptionRow;
use crate::push::{send_web_push_batch, VapidConfig};
use crate::sweep::{evaluate_sweep, SweepSnapshot};

// ═══════════════════════════════════════════════════════════════════════════
// Fetch handler — subscribe / unsubscribe / health
// ═══════════════════════════════════════════════════════════════════════════

#[event(fetch)]
async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    // CORS preflight
    if req.method() == Method::Options {
        let mut resp = Response::empty()?;
        let headers = resp.headers_mut();
        let _ = headers.set("Access-Control-Allow-Origin", "*");
        let _ = headers.set("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
        let _ = headers.set("Access-Control-Allow-Headers", "Content-Type");
        return Ok(resp);
    }

    let router = Router::new();

    router
        .get("/", |_req, _ctx| Response::ok("helio-alerts v0.1"))
        .get_async("/health", |_req, ctx| async move {
            let vapid_configured = read_vapid_secrets(&ctx.env).is_configured();
            Response::from_json(&serde_json::json!({
                "status": "ok",
                "version": "0.1.0",
                "vapid_configured": vapid_configured,
            }))
        })
        .post_async("/subscribe", |mut req, ctx| async move {
            match handle_subscribe(&mut req, &ctx.env).await {
                Ok(resp) => Ok(resp),
                Err(e) => Response::error(e.to_string(), 400),
            }
        })
        .delete_async("/subscribe/:id", |_req, ctx| async move {
            let id: String = ctx.param("id").map(|s| s.clone()).unwrap_or_default();
            match handle_unsubscribe(&id, &ctx.env).await {
                Ok(resp) => Ok(resp),
                Err(e) => Response::error(e.to_string(), 400),
            }
        })
        .run(req, env)
        .await
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduled handler — cron sweep
// ═══════════════════════════════════════════════════════════════════════════

#[event(scheduled)]
async fn scheduled(_event: ScheduledEvent, env: Env, _ctx: ScheduleContext) {
    // In production, this runs on a cron trigger (e.g. every 5 min).
    // For local dev/test (no D1/KV bindings), the sweep is tested via
    // unit tests against synthetic data. The scheduled handler itself
    // is a no-op when bindings are absent.
    let _ = run_sweep(&env).await;
}

async fn run_sweep(env: &Env) -> Result<()> {
    // Load subscriptions from D1
    let db = env.d1("DB")?;
    let stmt = db.prepare("SELECT json_body FROM subscriptions");
    let rows = stmt.all().await?;

    let mut subscriptions: Vec<SubscriptionRow> = Vec::new();
    for row in rows.results::<serde_json::Value>()? {
        if let Some(body) = row.get("json_body").and_then(|v| v.as_str()) {
            if let Ok(sub) = SubscriptionRow::from_json_string(body) {
                subscriptions.push(sub);
            }
        }
    }

    if subscriptions.is_empty() {
        return Ok(());
    }

    // Load snapshot from KV
    let kv = env.kv("SNAPSHOT")?;
    let snap_json_opt = kv.get("latest").text().await?;
    let snap_json = snap_json_opt.unwrap_or_default();

    let snap: serde_json::Value =
        serde_json::from_str(&snap_json).unwrap_or(serde_json::Value::Null);

    let sweep_snap = snapshot_from_json(&snap);

    // Evaluate thresholds
    let decisions = evaluate_sweep(&subscriptions, &sweep_snap);

    if decisions.is_empty() {
        return Ok(());
    }

    // Send pushes (no-op when VAPID secrets absent)
    let vapid = read_vapid_secrets(env);
    let outcomes = send_web_push_batch(&decisions, &vapid).await;

    // Log summary
    let sent = outcomes
        .iter()
        .filter(|o| **o == push::PushOutcome::Sent)
        .count();
    let skipped = outcomes
        .iter()
        .filter(|o| **o == push::PushOutcome::SkippedNoSecrets)
        .count();
    console_log!(
        "helio-alerts sweep: {} decisions, {} sent, {} skipped (no VAPID secrets)",
        decisions.len(),
        sent,
        skipped
    );

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════════════════

async fn handle_subscribe(req: &mut Request, env: &Env) -> Result<Response> {
    let body: SubscriptionRow = req.json().await?;

    // Validate
    body.validate().map_err(|e| Error::RustError(e))?;

    // Store in D1
    let db = env.d1("DB")?;
    let json_body = body
        .to_json_string()
        .map_err(|e| Error::RustError(e.to_string()))?;

    db.prepare(
        "INSERT OR REPLACE INTO subscriptions (subscription_id, created_at, json_body, lat_deg, lon_deg)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&[
        wasm_bindgen::JsValue::from_str(&body.subscription_id),
        wasm_bindgen::JsValue::from_str(&body.created_at),
        wasm_bindgen::JsValue::from_str(&json_body),
        wasm_bindgen::JsValue::from_f64(body.location.lat_deg),
        wasm_bindgen::JsValue::from_f64(body.location.lon_deg),
    ])?
    .run()
    .await?;

    Response::from_json(&serde_json::json!({
        "status": "subscribed",
        "subscription_id": body.subscription_id,
    }))
}

async fn handle_unsubscribe(id: &str, env: &Env) -> Result<Response> {
    let db = env.d1("DB")?;
    let result = db
        .prepare("DELETE FROM subscriptions WHERE subscription_id = ?1")
        .bind(&[wasm_bindgen::JsValue::from_str(id)])?
        .run()
        .await?;

    let deleted = result
        .meta()
        .ok()
        .flatten()
        .and_then(|m| m.rows_written)
        .unwrap_or(0);
    if deleted > 0 {
        Response::from_json(&serde_json::json!({
            "status": "unsubscribed",
            "subscription_id": id,
        }))
    } else {
        Response::from_json(&serde_json::json!({
            "status": "not_found",
            "subscription_id": id,
        }))
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/// Read VAPID secrets from environment. Returns `VapidConfig::absent()` when
/// any secret is missing — this is the standard local dev/test path.
fn read_vapid_secrets(env: &Env) -> VapidConfig {
    let subject = env.secret("VAPID_SUBJECT").ok().map(|s| s.to_string());
    let public_key = env.secret("VAPID_PUBLIC_KEY").ok().map(|s| s.to_string());
    let private_key = env.secret("VAPID_PRIVATE_KEY").ok().map(|s| s.to_string());
    VapidConfig::from_env(subject, public_key, private_key)
}

/// Extract the sweep-relevant fields from a snapshot JSON value.
/// Returns a minimal snapshot even if fields are missing (for resilience).
fn snapshot_from_json(snap: &serde_json::Value) -> SweepSnapshot {
    let bz_gsm_nt = snap
        .pointer("/solar_wind/bz_gsm_nt")
        .and_then(|v| v.as_f64());

    let bz_series = snap
        .pointer("/solar_wind/series/bz_gsm_nt")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|v| v.as_f64())
                .collect::<Vec<Option<f64>>>()
        })
        .unwrap_or_default();

    let cadence_s = snap
        .pointer("/cadence_s")
        .and_then(|v| v.as_u64())
        .unwrap_or(300) as u32;

    let kp_value = snap
        .pointer("/indices/kp/value")
        .and_then(|v| v.as_f64());

    let hemispheric_power_gw = snap
        .pointer("/ovation/hemispheric_power_gw")
        .and_then(|v| v.as_f64());

    let delay_quality = snap
        .pointer("/l1_to_earth/delay_quality")
        .and_then(|v| v.as_str())
        .unwrap_or("degraded_fixed")
        .to_string();

    SweepSnapshot {
        bz_gsm_nt,
        bz_series,
        cadence_s,
        kp_value,
        hemispheric_power_gw,
        delay_quality,
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Integration tests (using contract fixture data)
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::model::{
        AlertThresholds, AuroraTonightThreshold, BzTurnThreshold, PushTriple, RoundedLocation,
    };

    /// Simulate a SweepSnapshot from `snapshot-storm.json` fixture data.
    fn snapshot_from_storm_fixture() -> SweepSnapshot {
        SweepSnapshot {
            bz_gsm_nt: Some(-17.4),
            bz_series: vec![
                Some(-17.4),
                Some(-17.0),
                Some(-16.5),
                Some(-15.8),
                Some(-14.2),
                Some(-13.0),
            ],
            cadence_s: 60,
            kp_value: Some(7.33),
            hemispheric_power_gw: Some(95.3),
            delay_quality: "measured".into(),
        }
    }

    /// Simulate a SweepSnapshot from `snapshot-quiet.json` fixture data.
    fn snapshot_from_quiet_fixture() -> SweepSnapshot {
        SweepSnapshot {
            bz_gsm_nt: Some(2.1),
            bz_series: vec![
                Some(2.1),
                Some(2.3),
                Some(1.5),
                Some(2.0),
                Some(2.4),
                Some(1.8),
            ],
            cadence_s: 300,
            kp_value: Some(2.33),
            hemispheric_power_gw: Some(12.4),
            delay_quality: "measured".into(),
        }
    }

    /// Simulate a SweepSnapshot from `snapshot-degraded.json` fixture data.
    fn snapshot_from_degraded_fixture() -> SweepSnapshot {
        SweepSnapshot {
            bz_gsm_nt: Some(1.4),
            bz_series: vec![
                Some(1.4),
                Some(1.5),
                None,
                None,
                Some(1.6),
                Some(1.2),
            ],
            cadence_s: 300,
            kp_value: Some(2.0),
            hemispheric_power_gw: Some(10.1),
            delay_quality: "degraded_fixed".into(),
        }
    }

    fn make_sub_alaska_aurora() -> SubscriptionRow {
        SubscriptionRow {
            schema_version: "1.0.0".into(),
            subscription_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d".into(),
            created_at: "2026-06-12T08:00:00Z".into(),
            push: PushTriple {
                endpoint: "https://push.example.com/fairbanks".into(),
                p256dh: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
                    .into(),
                auth: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
            },
            location: RoundedLocation::new(64.8, -147.9),
            thresholds: AlertThresholds {
                aurora_tonight: AuroraTonightThreshold {
                    enabled: true,
                    min_go_look_score: 0.30,
                },
                bz_turn: BzTurnThreshold {
                    enabled: true,
                    bz_south_nt: -5.0,
                    min_sustained_minutes: 5,
                },
                kp_min: None,
            },
        }
    }

    fn make_sub_tromso_bz_only() -> SubscriptionRow {
        SubscriptionRow {
            schema_version: "1.0.0".into(),
            subscription_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e".into(),
            created_at: "2026-06-12T08:00:00Z".into(),
            push: PushTriple {
                endpoint: "https://push.example.com/tromso".into(),
                p256dh: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC="
                    .into(),
                auth: "BBBBBBBBBBBBBBBBBBBBBB==".into(),
            },
            location: RoundedLocation::new(69.6, 19.0),
            thresholds: AlertThresholds {
                aurora_tonight: AuroraTonightThreshold {
                    enabled: false,
                    min_go_look_score: 1.0,
                },
                bz_turn: BzTurnThreshold {
                    enabled: true,
                    bz_south_nt: -8.0,
                    min_sustained_minutes: 3,
                },
                kp_min: None,
            },
        }
    }

    fn make_sub_ohio_kp() -> SubscriptionRow {
        SubscriptionRow {
            schema_version: "1.0.0".into(),
            subscription_id: "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f".into(),
            created_at: "2026-06-12T08:00:00Z".into(),
            push: PushTriple {
                endpoint: "https://push.example.com/cleveland".into(),
                p256dh: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD="
                    .into(),
                auth: "CCCCCCCCCCCCCCCCCCCCCC==".into(),
            },
            location: RoundedLocation::new(41.5, -81.7),
            thresholds: AlertThresholds {
                aurora_tonight: AuroraTonightThreshold {
                    enabled: true,
                    min_go_look_score: 0.10,
                },
                bz_turn: BzTurnThreshold {
                    enabled: false,
                    bz_south_nt: 0.0,
                    min_sustained_minutes: 0,
                },
                kp_min: Some(7.0),
            },
        }
    }

    // ── Storm tests ───────────────────────────────────────────────────

    #[test]
    fn storm_sweep_triggers_alaska_aurora() {
        let subs = vec![make_sub_alaska_aurora()];
        let snap = snapshot_from_storm_fixture();
        let decisions = evaluate_sweep(&subs, &snap);

        assert_eq!(decisions.len(), 2);
        let has_aurora = decisions
            .iter()
            .any(|d| matches!(d.reason, sweep::AlertReason::AuroraTonight { .. }));
        let has_bz = decisions
            .iter()
            .any(|d| matches!(d.reason, sweep::AlertReason::BzTurn { .. }));
        assert!(has_aurora, "expected aurora_tonight alert");
        assert!(has_bz, "expected bz_turn alert");
    }

    #[test]
    fn storm_sweep_triggers_tromso_bz() {
        let subs = vec![make_sub_tromso_bz_only()];
        let snap = snapshot_from_storm_fixture();
        let decisions = evaluate_sweep(&subs, &snap);

        assert_eq!(decisions.len(), 1);
        assert!(matches!(
            decisions[0].reason,
            sweep::AlertReason::BzTurn { .. }
        ));
    }

    #[test]
    fn storm_sweep_triggers_ohio_kp() {
        let subs = vec![make_sub_ohio_kp()];
        let snap = snapshot_from_storm_fixture();
        let decisions = evaluate_sweep(&subs, &snap);

        // Ohio at 41.5N: during a G3 storm, aurora can be visible at mid-latitudes.
        // Aurora proxy score ~0.26 > 0.10 threshold → aurora fires.
        // Kp 7.33 ≥ 7.0 → kp fires.
        // Total: 2 alerts.
        assert_eq!(decisions.len(), 2);
        let has_aurora = decisions.iter().any(|d| matches!(d.reason, sweep::AlertReason::AuroraTonight { .. }));
        let has_kp = decisions.iter().any(|d| matches!(d.reason, sweep::AlertReason::KpThreshold { .. }));
        assert!(has_aurora, "expected aurora_tonight alert");
        assert!(has_kp, "expected kp_threshold alert");
    }

    // ── Quiet tests ───────────────────────────────────────────────────

    #[test]
    fn quiet_sweep_triggers_nothing() {
        let subs = vec![
            make_sub_alaska_aurora(),
            make_sub_tromso_bz_only(),
            make_sub_ohio_kp(),
        ];
        let snap = snapshot_from_quiet_fixture();
        let decisions = evaluate_sweep(&subs, &snap);

        assert!(
            decisions.is_empty(),
            "quiet conditions should produce no alerts, got {decisions:?}"
        );
    }

    // ── Degraded tests ────────────────────────────────────────────────

    #[test]
    fn degraded_sweep_bz_gap_no_trigger() {
        let subs = vec![make_sub_alaska_aurora()];
        let snap = snapshot_from_degraded_fixture();
        let decisions = evaluate_sweep(&subs, &snap);

        assert!(
            decisions.is_empty(),
            "degraded quiet should not trigger, got {decisions:?}"
        );
    }

    // ── End-to-end push test (skipped when secrets absent) ─────────────

    #[test]
    fn end_to_end_push_skipped_no_secrets() {
        let subs = vec![make_sub_alaska_aurora()];
        let snap = snapshot_from_storm_fixture();
        let decisions = evaluate_sweep(&subs, &snap);
        assert!(!decisions.is_empty(), "storm should produce decisions");

        let vapid = VapidConfig::absent();
        let outcomes = futures::executor::block_on(send_web_push_batch(&decisions, &vapid));
        assert_eq!(outcomes.len(), decisions.len());
        for o in &outcomes {
            assert_eq!(*o, push::PushOutcome::SkippedNoSecrets);
        }
    }

    #[test]
    fn end_to_end_sweep_and_skip_with_placeholder_vapid() {
        let subs = vec![
            make_sub_alaska_aurora(),
            make_sub_tromso_bz_only(),
            make_sub_ohio_kp(),
        ];
        let snap = snapshot_from_storm_fixture();

        let decisions = evaluate_sweep(&subs, &snap);
        // Alaska: aurora + bz = 2, Tromsø: bz = 1, Ohio: aurora + kp = 2 → total 5
        assert_eq!(decisions.len(), 5);

        let vapid = VapidConfig::dev_placeholder();
        let outcomes = futures::executor::block_on(send_web_push_batch(&decisions, &vapid));
        assert!(outcomes.iter().all(|o| *o == push::PushOutcome::Sent));

        let vapid_absent = VapidConfig::absent();
        let outcomes2 =
            futures::executor::block_on(send_web_push_batch(&decisions, &vapid_absent));
        assert!(outcomes2
            .iter()
            .all(|o| *o == push::PushOutcome::SkippedNoSecrets));
    }

    // ── Snapshot parsing tests ─────────────────────────────────────────

    #[test]
    fn snapshot_from_json_parses_storm_fields() {
        let json = serde_json::json!({
            "solar_wind": {
                "bz_gsm_nt": -17.4,
                "series": { "bz_gsm_nt": [-17.4, -17.0, -16.5] }
            },
            "cadence_s": 60,
            "indices": { "kp": { "value": 7.33 } },
            "ovation": { "hemispheric_power_gw": 95.3 },
            "l1_to_earth": { "delay_quality": "measured" }
        });
        let snap = snapshot_from_json(&json);
        assert_eq!(snap.bz_gsm_nt, Some(-17.4));
        assert_eq!(snap.bz_series.len(), 3);
        assert_eq!(snap.cadence_s, 60);
        assert_eq!(snap.kp_value, Some(7.33));
        assert_eq!(snap.hemispheric_power_gw, Some(95.3));
        assert_eq!(snap.delay_quality, "measured");
    }

    #[test]
    fn snapshot_from_json_missing_fields_defaults() {
        let json = serde_json::json!({});
        let snap = snapshot_from_json(&json);
        assert_eq!(snap.bz_gsm_nt, None);
        assert!(snap.bz_series.is_empty());
        assert_eq!(snap.cadence_s, 300);
        assert_eq!(snap.kp_value, None);
        assert_eq!(snap.hemispheric_power_gw, None);
        assert_eq!(snap.delay_quality, "degraded_fixed");
    }

    // ── Contract cross-check: subscription validates against schema ────

    #[test]
    fn subscription_contract_shape_alert_schema() {
        let sub = make_sub_alaska_aurora();
        let json = serde_json::to_value(&sub).unwrap();

        for required in &[
            "schema_version",
            "subscription_id",
            "created_at",
            "push",
            "location",
            "thresholds",
        ] {
            assert!(
                json.get(required).is_some(),
                "missing required field: {required}"
            );
        }

        let push = &json["push"];
        for required in &["endpoint", "p256dh", "auth"] {
            assert!(
                push.get(required).is_some(),
                "push missing required field: {required}"
            );
        }

        let loc = &json["location"];
        assert!(loc.get("lat_deg").is_some());
        assert!(loc.get("lon_deg").is_some());

        let thresh = &json["thresholds"];
        assert!(thresh.get("aurora_tonight").is_some());
        assert!(thresh.get("bz_turn").is_some());
        let at = &thresh["aurora_tonight"];
        assert!(at.get("enabled").is_some());
        assert!(at.get("min_go_look_score").is_some());
        let bz = &thresh["bz_turn"];
        assert!(bz.get("enabled").is_some());
        assert!(bz.get("bz_south_nt").is_some());
        assert!(bz.get("min_sustained_minutes").is_some());

        let allowed: std::collections::HashSet<&str> = [
            "schema_version",
            "subscription_id",
            "created_at",
            "push",
            "location",
            "thresholds",
        ]
        .iter()
        .copied()
        .collect();
        for key in json.as_object().unwrap().keys() {
            assert!(allowed.contains(key.as_str()), "unexpected field: {key}");
        }
    }

    #[test]
    fn subscription_privacy_rounding_enforced() {
        let sub = make_sub_alaska_aurora();
        assert!(sub.is_location_rounded());
        assert!((sub.location.lat_deg * 10.0).fract().abs() < 1e-9);
        assert!((sub.location.lon_deg * 10.0).fract().abs() < 1e-9);
    }
}
