//! Cron sweep — evaluates subscriptions against the latest snapshot.
//!
//! The sweep runs on a cron trigger. It loads the current snapshot, iterates
//! through all subscriptions, and evaluates each against the aurora_tonight
//! and bz_turn thresholds. Subscriptions that cross their threshold are
//! collected into alert batches for the push layer.
//!
//! ## Threshold evaluation rules
//!
//! ### aurora_tonight
//! Uses a go-look-score proxy computed from snapshot data (oval probability
//! estimate + darkness/moon from server-computable inputs, cloud handled
//! client-side). The snapshots carry enough scalars for a server-side
//! approximation. The actual `go_look` function is in `helio-core` (WASM);
//! here we use the snapshot's `ovation.hemispheric_power_gw` and
//! `indices.kp.value` as proxies. Full implementation integrates helio-core
//! via wasm-bindgen when the crate is ready.
//!
//! ### bz_turn
//! Checks the trailing Bz series from the snapshot: if the most recent N
//! consecutive samples are all southward ≤ bz_south_nt and N ≥
//! min_sustained_minutes / cadence, fire.
//!
//! ### kp_min
//! Simple threshold on the current Kp value.
//!
//! ## Output
//! Returns a vec of `AlertDecision` — one per subscription that should fire.
//! The push layer converts these to Web Push messages (or no-ops when VAPID
//! keys are absent).

use crate::model::{RoundedLocation, SubscriptionRow};

/// An alert decision for a single subscription — one row that should fire.
#[derive(Debug, Clone, PartialEq)]
pub struct AlertDecision {
    pub subscription_id: String,
    pub push_endpoint: String,
    pub push_p256dh: String,
    pub push_auth: String,
    pub location: RoundedLocation,
    pub reason: AlertReason,
    pub title: String,
    pub body: String,
}

/// Why this alert is firing.
#[derive(Debug, Clone, PartialEq)]
pub enum AlertReason {
    AuroraTonight { go_look_score: f64 },
    BzTurn { bz_nt: f64, sustained_minutes: u32 },
    KpThreshold { kp: f64 },
}

/// Input snapshot data: the subset of snapshot fields the sweep needs.
/// This is a lightweight extract — the full snapshot lives in R2/KV.
#[derive(Debug, Clone)]
pub struct SweepSnapshot {
    pub bz_gsm_nt: Option<f64>,
    pub bz_series: Vec<Option<f64>>,    // latest first
    pub cadence_s: u32,
    pub kp_value: Option<f64>,
    pub hemispheric_power_gw: Option<f64>,
    pub delay_quality: String,
}

impl SweepSnapshot {
    /// Build from contract fixture-like data for testing.
    pub fn new(
        bz_gsm_nt: Option<f64>,
        bz_series: Vec<Option<f64>>,
        cadence_s: u32,
        kp_value: Option<f64>,
        hemispheric_power_gw: Option<f64>,
        delay_quality: &str,
    ) -> Self {
        Self {
            bz_gsm_nt,
            bz_series,
            cadence_s,
            kp_value,
            hemispheric_power_gw,
            delay_quality: delay_quality.into(),
        }
    }
}

/// Evaluate all subscriptions against the snapshot. Returns decisions for
/// those that should fire.
pub fn evaluate_sweep(
    subs: &[SubscriptionRow],
    snap: &SweepSnapshot,
) -> Vec<AlertDecision> {
    let mut decisions = Vec::new();

    for sub in subs {
        let reasons = evaluate_one(sub, snap);
        for reason in reasons {
            decisions.push(build_decision(sub, reason));
        }
    }

    decisions
}

/// Evaluate a single subscription — can yield 0, 1, or 2 reasons (aurora +
/// bz turn can both fire).
fn evaluate_one(sub: &SubscriptionRow, snap: &SweepSnapshot) -> Vec<AlertReason> {
    let mut reasons = Vec::new();

    // ── aurora_tonight ──────────────────────────────────────────────
    if sub.thresholds.aurora_tonight.enabled {
        if let Some(score) = proxy_go_look_score(&sub.location, snap) {
            if score >= sub.thresholds.aurora_tonight.min_go_look_score {
                reasons.push(AlertReason::AuroraTonight {
                    go_look_score: score,
                });
            }
        }
    }

    // ── bz_turn (southward Bz sustained) ────────────────────────────
    if sub.thresholds.bz_turn.enabled {
        if let Some(bz_reason) = evaluate_bz_turn(sub, snap) {
            reasons.push(bz_reason);
        }
    }

    // ── kp_min ──────────────────────────────────────────────────────
    if let Some(kp_thresh) = sub.thresholds.kp_min {
        if let Some(kp) = snap.kp_value {
            if kp >= kp_thresh {
                reasons.push(AlertReason::KpThreshold { kp });
            }
        }
    }

    reasons
}

/// Server-side proxy for go-look score.
///
/// The real helio-core WASM function needs oval grid access (lat interpolation).
/// This proxy uses hemispheric power as a rough oval-strength indicator and
/// applies a latitude decay. It's good enough for alert-threshold crossing
/// detection; the client always computes the authoritative score.
///
/// Returns `None` when data is insufficient.
fn proxy_go_look_score(loc: &RoundedLocation, snap: &SweepSnapshot) -> Option<f64> {
    let power_gw = snap.hemispheric_power_gw?;

    // Base visible probability from hemispheric power (empirical fit).
    // Typical values: quiet = 5–15 GW, minor storm = 30–60 GW, major = 90+ GW.
    let base_prob = (power_gw / 120.0).min(1.0);

    // Latitude decay: auroral oval peaks ~67° magnetic latitude.
    // Sub-oval (lower lat): rapid falloff; polar cap (higher lat): gradual.
    let abs_lat = loc.lat_deg.abs();
    let lat_factor = if abs_lat >= 65.0 {
        // Inside oval zone — high probability
        1.0
    } else if abs_lat >= 55.0 {
        // Mid-latitude transitional zone
        ((abs_lat - 45.0) / 20.0).clamp(0.0, 1.0)
    } else if abs_lat >= 40.0 {
        // Low-mid — rare but possible in major storms
        ((abs_lat - 35.0) / 10.0).clamp(0.0, 1.0) * 0.5
    } else {
        // Equatorial — essentially zero
        0.0
    };

    // Degraded fallback: scale down confidence when plasma is stale
    let quality_factor = if snap.delay_quality == "degraded_fixed" {
        0.7
    } else {
        1.0
    };

    Some(base_prob * lat_factor * quality_factor)
}

/// Evaluate Bz southward turn alert.
///
/// Looks at the trailing Bz series to find the most recent consecutive
/// southward samples. Fires when:
/// - The most recent sustained southward stretch ≥ min_sustained
/// - AND current Bz ≤ bz_south_nt
fn evaluate_bz_turn(sub: &SubscriptionRow, snap: &SweepSnapshot) -> Option<AlertReason> {
    let threshold = sub.thresholds.bz_turn.bz_south_nt;
    let min_sustained = sub.thresholds.bz_turn.min_sustained_minutes;

    // Count consecutive southward samples (most recent first)
    let mut sustained_count = 0u32;
    for bz_opt in &snap.bz_series {
        match bz_opt {
            Some(bz) if *bz <= threshold => {
                sustained_count += 1;
            }
            _ => break, // gap or northward breaks the streak
        }
    }

    // Convert sample count to minutes
    let cadence_minutes = snap.cadence_s as f64 / 60.0;
    let sustained_minutes = (sustained_count as f64 * cadence_minutes) as u32;

    if sustained_minutes >= min_sustained {
        // Use current Bz value
        let current_bz = snap.bz_gsm_nt.unwrap_or(threshold);
        return Some(AlertReason::BzTurn {
            bz_nt: current_bz,
            sustained_minutes,
        });
    }

    None
}

/// Build a full AlertDecision from a subscription and a reason.
fn build_decision(sub: &SubscriptionRow, reason: AlertReason) -> AlertDecision {
    let (title, body) = match &reason {
        AlertReason::AuroraTonight { go_look_score } => {
            let verdict = if *go_look_score >= 0.30 {
                "Likely"
            } else if *go_look_score >= 0.10 {
                "Possible"
            } else {
                "Possible" // won't normally fire below threshold
            };
            (
                format!("Aurora {verdict} Tonight"),
                format!(
                    "Aurora visibility {verdict} near your location. Go-look score: {:.0}%.",
                    go_look_score * 100.0
                ),
            )
        }
        AlertReason::BzTurn {
            bz_nt,
            sustained_minutes,
        } => (
            "Southward Bz Turn Detected".into(),
            format!(
                "Bz = {bz_nt:.0} nT sustained for {sustained_minutes} min — aurora may follow within ~30-60 min."
            ),
        ),
        AlertReason::KpThreshold { kp } => (
            format!("Kp {kp} Reached"),
            format!("Planetary K-index reached {kp}. Aurora activity elevated."),
        ),
    };

    AlertDecision {
        subscription_id: sub.subscription_id.clone(),
        push_endpoint: sub.push.endpoint.clone(),
        push_p256dh: sub.push.p256dh.clone(),
        push_auth: sub.push.auth.clone(),
        location: sub.location.clone(),
        reason,
        title,
        body,
    }
}

// ── tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AlertThresholds, AuroraTonightThreshold, BzTurnThreshold, PushTriple};

    fn make_sub(
        id: &str,
        lat: f64,
        lon: f64,
        aurora_enabled: bool,
        aurora_score: f64,
        bz_enabled: bool,
        bz_south: f64,
        bz_sustain: u32,
        kp_min: Option<f64>,
    ) -> SubscriptionRow {
        SubscriptionRow {
            schema_version: "1.0.0".into(),
            subscription_id: id.into(),
            created_at: "2026-06-12T08:00:00Z".into(),
            push: PushTriple {
                endpoint: format!("https://push.example.com/{id}"),
                p256dh: "BBBBBBBBBBBB=".into(),
                auth: "AAAAAAA=".into(),
            },
            location: RoundedLocation::new(lat, lon),
            thresholds: AlertThresholds {
                aurora_tonight: AuroraTonightThreshold {
                    enabled: aurora_enabled,
                    min_go_look_score: aurora_score,
                },
                bz_turn: BzTurnThreshold {
                    enabled: bz_enabled,
                    bz_south_nt: bz_south,
                    min_sustained_minutes: bz_sustain,
                },
                kp_min,
            },
        }
    }

    // ── storm snapshot (Bz −17.4, Kp 7.33, power 95.3 GW) ───────────
    fn storm_snap() -> SweepSnapshot {
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

    // ── quiet snapshot (Bz +2.1, Kp 2.33, power 12.4 GW) ────────────
    fn quiet_snap() -> SweepSnapshot {
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

    // ── test: aurora_tonight threshold crossing ──────────────────────

    #[test]
    fn aurora_tonight_storm_crosses_threshold() {
        // Tromsø at 69.6N — inside oval zone, storm conditions
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, true, 0.30, false, -5.0, 5, None);
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert_eq!(decisions.len(), 1);
        assert!(matches!(decisions[0].reason, AlertReason::AuroraTonight { .. }));
        if let AlertReason::AuroraTonight { go_look_score } = &decisions[0].reason {
            assert!(*go_look_score >= 0.30, "score {go_look_score} below 0.30 threshold");
            assert_eq!(decisions[0].title, "Aurora Likely Tonight");
        }
    }

    #[test]
    fn aurora_tonight_quiet_below_threshold() {
        // Same location, quiet conditions — below threshold
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, true, 0.30, false, -5.0, 5, None);
        let snap = quiet_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert!(decisions.is_empty());
    }

    #[test]
    fn aurora_tonight_disabled_does_not_fire() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, false, 0.30, false, -5.0, 5, None);
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        // Bz also disabled, so nothing
        assert!(decisions.is_empty());
    }

    #[test]
    fn aurora_tonight_midlat_storm_threshold() {
        // Minneapolis at 45N — needs strong storm; threshold at "Possible" (0.10)
        let sub = make_sub("b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2", 45.0, -93.0, true, 0.10, false, -5.0, 5, None);
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        // At 45°N, lat factor ≈ 0.5, base_prob ≈ 0.79, quality = 1.0
        // proxy ≈ 0.79 * 0.5 * 1.0 = 0.40, which exceeds 0.10
        assert_eq!(decisions.len(), 1);
        if let AlertReason::AuroraTonight { go_look_score } = &decisions[0].reason {
            assert!(*go_look_score >= 0.10);
        }
    }

    #[test]
    fn aurora_tonight_lowlat_no_alert() {
        // Miami at 25N — should never get aurora alert
        let sub = make_sub("c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3", 25.7, -80.2, true, 0.10, false, -5.0, 5, None);
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert!(decisions.is_empty());
    }

    // ── test: bz_turn threshold ─────────────────────────────────────

    #[test]
    fn bz_turn_storm_triggers() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, false, 0.30, true, -5.0, 5, None);
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert_eq!(decisions.len(), 1);
        assert!(matches!(decisions[0].reason, AlertReason::BzTurn { .. }));
        if let AlertReason::BzTurn {
            bz_nt,
            sustained_minutes,
        } = &decisions[0].reason
        {
            assert!(*bz_nt <= -5.0, "bz_nt = {bz_nt}");
            assert!(*sustained_minutes >= 5);
        }
    }

    #[test]
    fn bz_turn_quiet_no_trigger() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, false, 0.30, true, -5.0, 5, None);
        let snap = quiet_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert!(decisions.is_empty());
    }

    #[test]
    fn bz_turn_disabled_no_trigger() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, false, 0.30, false, -5.0, 5, None);
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert!(decisions.is_empty());
    }

    #[test]
    fn bz_turn_sustained_short_of_threshold() {
        // Require 10 min sustained, but cadence is 60s → need 10 consecutive samples
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, false, 0.30, true, -5.0, 10, None);
        // Storm has 6 samples → 6 min sustained < 10 min required
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert!(decisions.is_empty());
    }

    #[test]
    fn bz_turn_gap_breaks_sustained() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, false, 0.30, true, -5.0, 2, None);
        let snap = SweepSnapshot {
            bz_gsm_nt: Some(-8.0),
            // Gap after 2 southward samples — sustained count should be only 2
            bz_series: vec![Some(-8.0), Some(-7.0), None, Some(-9.0), Some(-10.0)],
            cadence_s: 60,
            kp_value: Some(3.0),
            hemispheric_power_gw: Some(30.0),
            delay_quality: "measured".into(),
        };
        // sustained = 2 min, which meets min_sustained = 2 → fires
        let decisions = evaluate_sweep(&[sub], &snap);
        assert_eq!(decisions.len(), 1);
        if let AlertReason::BzTurn { sustained_minutes, .. } = &decisions[0].reason {
            assert_eq!(*sustained_minutes, 2);
        }
    }

    #[test]
    fn bz_turn_northward_breaks_sustained() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, false, 0.30, true, -5.0, 3, None);
        let snap = SweepSnapshot {
            bz_gsm_nt: Some(1.0), // current is northward
            bz_series: vec![Some(1.0), Some(-6.0), Some(-7.0)], // northward breaks
            cadence_s: 60,
            kp_value: Some(3.0),
            hemispheric_power_gw: Some(30.0),
            delay_quality: "measured".into(),
        };
        let decisions = evaluate_sweep(&[sub], &snap);
        assert!(decisions.is_empty());
    }

    // ── test: kp_min threshold ──────────────────────────────────────

    #[test]
    fn kp_threshold_crosses() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 45.0, -93.0, false, 0.30, false, -5.0, 5, Some(6.0));
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert_eq!(decisions.len(), 1);
        assert!(matches!(decisions[0].reason, AlertReason::KpThreshold { .. }));
    }

    #[test]
    fn kp_threshold_no_cross() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 45.0, -93.0, false, 0.30, false, -5.0, 5, Some(8.0));
        let snap = storm_snap(); // Kp 7.33 < 8
        let decisions = evaluate_sweep(&[sub], &snap);
        assert!(decisions.is_empty());
    }

    #[test]
    fn kp_threshold_none_disabled() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 45.0, -93.0, false, 0.30, false, -5.0, 5, None);
        let snap = storm_snap();
        let decisions = evaluate_sweep(&[sub], &snap);
        assert!(decisions.is_empty()); // all disabled
    }

    // ── test: multiple subscriptions ─────────────────────────────────

    #[test]
    fn sweep_multiple_subs_mixed() {
        let tromso = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, true, 0.30, true, -5.0, 5, None);
        let minneapolis = make_sub("b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2", 45.0, -93.0, true, 0.10, false, -5.0, 5, Some(6.0));
        let miami = make_sub("c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3", 25.7, -80.2, true, 0.10, true, -5.0, 5, None);

        let subs = vec![tromso, minneapolis, miami];
        let snap = storm_snap();
        let decisions = evaluate_sweep(&subs, &snap);

        // Tromsø: aurora + bz → 2 decisions
        // Minneapolis: aurora (at 0.10) + kp → 2 decisions
        // Miami: only bz → 1 decision (aurora too low-lat)
        // Total: 5
        assert_eq!(decisions.len(), 5);

        // Verify Tromsø gets both
        let tromso_decisions: Vec<_> = decisions
            .iter()
            .filter(|d| d.subscription_id.starts_with("a1b2"))
            .collect();
        assert_eq!(tromso_decisions.len(), 2);

        // Minneapolis gets both
        let mpls_decisions: Vec<_> = decisions
            .iter()
            .filter(|d| d.subscription_id.starts_with("b2b2"))
            .collect();
        assert_eq!(mpls_decisions.len(), 2);

        // Miami gets bz only
        let miami_decisions: Vec<_> = decisions
            .iter()
            .filter(|d| d.subscription_id.starts_with("c3c3"))
            .collect();
        assert_eq!(miami_decisions.len(), 1);
        assert!(matches!(
            miami_decisions[0].reason,
            AlertReason::BzTurn { .. }
        ));
    }

    // ── test: degraded quality ──────────────────────────────────────

    #[test]
    fn degraded_quality_reduces_score() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, true, 0.30, false, -5.0, 5, None);
        let degraded = SweepSnapshot {
            bz_gsm_nt: None,
            bz_series: vec![],
            cadence_s: 300,
            kp_value: Some(2.0),
            hemispheric_power_gw: Some(95.3), // storm power
            delay_quality: "degraded_fixed".into(), // degraded
        };
        // With degraded quality, score = base_prob * lat_factor * 0.7
        // base_prob = 95.3/120 ≈ 0.794, lat_factor = 1.0 (Tromsø), quality = 0.7
        // score ≈ 0.556 -> still triggers
        let decisions = evaluate_sweep(&[sub], &degraded);
        assert_eq!(decisions.len(), 1);
        if let AlertReason::AuroraTonight { go_look_score } = &decisions[0].reason {
            assert!(*go_look_score < 0.794); // reduced from non-degraded
        }
    }

    // ── test: bz_turn with null current Bz ──────────────────────────

    #[test]
    fn bz_turn_null_current_uses_threshold() {
        let sub = make_sub("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", 69.6, 19.0, false, 0.30, true, -8.0, 3, None);
        let snap = SweepSnapshot {
            bz_gsm_nt: None, // null current
            bz_series: vec![Some(-9.0), Some(-10.0), Some(-11.0), Some(-12.0)],
            cadence_s: 60,
            kp_value: None,
            hemispheric_power_gw: None,
            delay_quality: "measured".into(),
        };
        let decisions = evaluate_sweep(&[sub], &snap);
        assert_eq!(decisions.len(), 1);
        if let AlertReason::BzTurn { bz_nt, .. } = &decisions[0].reason {
            // Falls back to threshold value (-8.0)
            assert!((*bz_nt - (-8.0)).abs() < 1e-9);
        }
    }
}
