// W1-P1b: SWPC indices feed adapter
// Owner: DeepSeek builder (deepseek/deepseek-v4-pro) / GPT validator
//
// Acceptance: Kp/Dst adapter with schema-valid normalized output and clock metadata.
//
// Parses SWPC planetary K-index, Kyoto Dst, F10.7 flux, and NOAA scales JSON
// into typed records. Includes deterministic fixture strings and unit tests.
// Kp → G-scale thresholds are explicit and match contracts/schemas (kp_to_g).
// No live network required — all tests use embedded fixtures.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Raw SWPC wire types — faithfully match the upstream JSON shapes
// ---------------------------------------------------------------------------

/// A single Kp row from noaa-planetary-k-index.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwpcKpRow {
    pub time_tag: String,
    pub kp: f64,
    pub a_running: Option<f64>,
    pub station_count: Option<u32>,
}

/// A single Kp forecast row from noaa-planetary-k-index-forecast.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwpcKpForecastRow {
    pub time_tag: String,
    pub kp: f64,
}

/// A single Dst row from kyoto-dst.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwpcDstRow {
    pub time_tag: String,
    pub dst: f64,
}

/// A single F10.7 row from 10cm-flux-30-day.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwpcF107Row {
    pub time_tag: String,
    pub flux: f64,
}

/// Raw NOAA scales from noaa-scales.json.  Each scale key maps to an object
/// whose `minor` field carries the current level string (e.g. "G3") or null.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwpcNoaaScales {
    #[serde(default, rename = "R")]
    pub r: Option<SwpcScaleSlot>,
    #[serde(default, rename = "S")]
    pub s: Option<SwpcScaleSlot>,
    #[serde(default, rename = "G")]
    pub g: Option<SwpcScaleSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwpcScaleSlot {
    pub minor: Option<String>,
}

// ---------------------------------------------------------------------------
// Source-quality metadata — maps into the schema's source_status object
// ---------------------------------------------------------------------------

/// Status of a single upstream feed poll.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SourceStatus {
    pub status: String,                  // "ok" | "stale" | "gap"
    pub last_success_at: Option<String>, // ISO-8601 UTC or null
    pub age_s: Option<f64>,              // seconds since last_success_at at the moment of poll
}

impl SourceStatus {
    pub fn ok(last_success_at: &str, age_s: f64) -> Self {
        Self {
            status: "ok".into(),
            last_success_at: Some(last_success_at.into()),
            age_s: Some(age_s),
        }
    }

    pub fn stale(last_success_at: &str, age_s: f64) -> Self {
        Self {
            status: "stale".into(),
            last_success_at: Some(last_success_at.into()),
            age_s: Some(age_s),
        }
    }

    pub fn gap() -> Self {
        Self {
            status: "gap".into(),
            last_success_at: None,
            age_s: None,
        }
    }
}

/// Result of a poll: the parsed payload and the resulting source status.
#[derive(Debug, Clone)]
pub struct PollResult<T> {
    pub data: T,
    pub source_status: SourceStatus,
}

// ---------------------------------------------------------------------------
// Normalised output types — these are what the snapshot writer consumes
// ---------------------------------------------------------------------------

/// The canonical snapshot-normalised Kp value.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KpValue {
    /// 3-hourly planetary Kp index (0.0–9.0, thirds resolution: 0, 0+, 1-, 1, 1+, …).
    pub value: f64,
    /// Timestamp the Kp observation is valid for (typically the end of the 3-h window).
    pub measured_at: String,
    /// Derived NOAA G-scale (contracts formula: kp_to_g).
    pub g_scale: u8,
}

/// A single Kp forecast point.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KpForecastPoint {
    pub valid_at: String,
    pub value: f64,
}

/// The canonical snapshot Dst value.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DstValue {
    /// Kyoto Dst in nT.
    pub value: f64,
    /// Timestamp of the Dst observation.
    pub measured_at: String,
}

/// The canonical snapshot F10.7 value.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct F107Value {
    /// Solar radio flux at 10.7 cm in sfu.
    pub value: f64,
    /// Timestamp of the measurement.
    pub measured_at: String,
}

/// The canonical NOAA scales — R, S, G strings like "R1", "G3", or null.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NoaaScales {
    pub r: Option<String>,
    pub s: Option<String>,
    pub g: Option<String>,
}

/// The full SWPC indices snapshot fragment, ready to drop into the combined snapshot.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct IndicesSnapshot {
    pub kp: KpValue,
    pub kp_forecast: Vec<KpForecastPoint>,
    pub dst_nt: DstValue,
    pub f107: F107Value,
    pub noaa_scales: NoaaScales,
}

// ---------------------------------------------------------------------------
// Kp → G-scale conversion (EXACT contract — contracts › formulas.py › kp_to_g)
// ---------------------------------------------------------------------------

/// Map a Kp value to the NOAA G-scale.
///
/// **Thresholds (pinned by contracts/vectors/coupling.json — kp_to_g cases):**
///
/// | Kp range          | G  |
/// |-------------------|----|
/// | 0.00 – 4.99       |  0 |
/// | 5.00 – 5.99       |  1 |
/// | 6.00 – 6.99       |  2 |
/// | 7.00 – 7.99       |  3 |
/// | 8.00 – 8.99       |  4 |
/// | 9.00              |  5 |
///
/// Any implementation MUST reproduce the golden vectors in
/// `contracts/fixtures/vectors/coupling.json` to exact equality.
/// That is the Wave-0 green light for this function.
pub fn kp_to_g(kp: f64) -> u8 {
    if kp < 5.0 {
        0
    } else if kp >= 9.0 {
        5
    } else {
        (kp as u8) - 4
    }
}

// ---------------------------------------------------------------------------
// Parsers — raw JSON bytes → PollResult<typed output>
// ---------------------------------------------------------------------------

/// Parse the noaa-planetary-k-index.json payload and return the latest Kp row
/// plus source-status metadata computed from the `observed_at` timestamp.
pub fn parse_kp(body: &[u8], observed_at: &DateTime<Utc>) -> Result<PollResult<KpValue>, String> {
    let rows: Vec<SwpcKpRow> =
        serde_json::from_slice(body).map_err(|e| format!("kp parse error: {e}"))?;

    // Use the chronologically last row as the current value.
    let last = rows.last().ok_or_else(|| "kp: empty payload".to_string())?;

    let measured_at = last.time_tag.clone();
    let kp = last.kp;
    let g_scale = kp_to_g(kp);

    let status = source_status_for(&measured_at, observed_at);

    Ok(PollResult {
        data: KpValue {
            value: kp,
            measured_at,
            g_scale,
        },
        source_status: status,
    })
}

/// Parse noaa-planetary-k-index-forecast.json.
pub fn parse_kp_forecast(
    body: &[u8],
    _observed_at: &DateTime<Utc>,
) -> Result<Vec<KpForecastPoint>, String> {
    let rows: Vec<SwpcKpForecastRow> =
        serde_json::from_slice(body).map_err(|e| format!("kp forecast parse error: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| KpForecastPoint {
            valid_at: r.time_tag,
            value: r.kp,
        })
        .collect())
}

/// Parse kyoto-dst.json and return the latest Dst row.
pub fn parse_dst(body: &[u8], observed_at: &DateTime<Utc>) -> Result<PollResult<DstValue>, String> {
    let rows: Vec<SwpcDstRow> =
        serde_json::from_slice(body).map_err(|e| format!("dst parse error: {e}"))?;

    let last = rows
        .last()
        .ok_or_else(|| "dst: empty payload".to_string())?;

    let measured_at = last.time_tag.clone();
    let status = source_status_for(&measured_at, observed_at);

    Ok(PollResult {
        data: DstValue {
            value: last.dst,
            measured_at,
        },
        source_status: status,
    })
}

/// Parse 10cm-flux-30-day.json and return the latest F10.7 value.
pub fn parse_f107(
    body: &[u8],
    observed_at: &DateTime<Utc>,
) -> Result<PollResult<F107Value>, String> {
    let rows: Vec<SwpcF107Row> =
        serde_json::from_slice(body).map_err(|e| format!("f107 parse error: {e}"))?;

    let last = rows
        .last()
        .ok_or_else(|| "f107: empty payload".to_string())?;

    let measured_at = last.time_tag.clone();
    let status = source_status_for(&measured_at, observed_at);

    Ok(PollResult {
        data: F107Value {
            value: last.flux,
            measured_at,
        },
        source_status: status,
    })
}

/// Parse noaa-scales.json.
pub fn parse_noaa_scales(body: &[u8]) -> Result<NoaaScales, String> {
    let raw: SwpcNoaaScales =
        serde_json::from_slice(body).map_err(|e| format!("noaa scales parse error: {e}"))?;

    Ok(NoaaScales {
        r: raw.r.and_then(|s| s.minor),
        s: raw.s.and_then(|s| s.minor),
        g: raw.g.and_then(|s| s.minor),
    })
}

/// Build the combined indices snapshot from the four feed parses.
pub fn build_indices_snapshot(
    kp_result: PollResult<KpValue>,
    forecast: Vec<KpForecastPoint>,
    dst_result: PollResult<DstValue>,
    f107_result: PollResult<F107Value>,
    scales: NoaaScales,
) -> (IndicesSnapshot, SourceStatus) {
    // The composite source status is the worst of the three timed sub-feeds
    // (kp, dst, f107).  We take the one with the largest age_s (oldest).
    let composite_status = composite_status(&[
        &kp_result.source_status,
        &dst_result.source_status,
        &f107_result.source_status,
    ]);

    let snap = IndicesSnapshot {
        kp: kp_result.data,
        kp_forecast: forecast,
        dst_nt: dst_result.data,
        f107: f107_result.data,
        noaa_scales: scales,
    };

    (snap, composite_status)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute source_status by comparing the data's measured_at to the wall clock
/// at poll time (observed_at).  Staleness thresholds:
///   - ≤ 90 min → ok
///   - ≤ 6 h   → stale
///   - > 6 h   → gap
fn source_status_for(measured_at_iso: &str, observed_at: &DateTime<Utc>) -> SourceStatus {
    let ts = match DateTime::parse_from_rfc3339(measured_at_iso) {
        Ok(t) => t.with_timezone(&Utc),
        Err(_) => return SourceStatus::gap(),
    };

    let age = (*observed_at - ts).num_seconds();
    let age_s = if age < 0 { 0.0 } else { age as f64 };

    let status = if age_s <= 5400.0 {
        // 90 min
        "ok"
    } else if age_s <= 21600.0 {
        // 6 h
        "stale"
    } else {
        "gap"
    };

    SourceStatus {
        status: status.into(),
        last_success_at: Some(measured_at_iso.into()),
        age_s: Some(age_s),
    }
}

/// Pick the worst status from a set of sub-feed sources ("gap" > "stale" > "ok").
fn composite_status(sources: &[&SourceStatus]) -> SourceStatus {
    let mut worst: Option<&SourceStatus> = None;
    for s in sources {
        match worst {
            None => worst = Some(s),
            Some(w) => {
                if rank_status(&s.status) > rank_status(&w.status) {
                    worst = Some(s);
                }
            }
        }
    }
    worst.cloned().unwrap_or_else(SourceStatus::gap)
}

fn rank_status(s: &str) -> u8 {
    match s {
        "gap" => 2,
        "stale" => 1,
        _ => 0,
    }
}

// ===========================================================================
// Fixtures — deterministic JSON payloads for unit tests (no live network)
// ===========================================================================

#[cfg(test)]
pub mod fixtures {
    /// Representatively-shaped noaa-planetary-k-index.json.
    /// Storm-level: Kp=7+, matching snapshot-storm.json expectations.
    pub const KP_JSON: &str = r#"[
        {"time_tag": "2026-06-12T03:00:00Z", "kp": 7.0,  "a_running": 40, "station_count": 13},
        {"time_tag": "2026-06-12T06:00:00Z", "kp": 7.33, "a_running": 42, "station_count": 13},
        {"time_tag": "2026-06-12T09:00:00Z", "kp": 7.33, "a_running": 44, "station_count": 13}
    ]"#;

    /// Quiet Kp fixture (matching snapshot-quiet.json).
    pub const KP_QUIET_JSON: &str = r#"[
        {"time_tag": "2026-06-12T00:00:00Z", "kp": 2.0,  "a_running": 5, "station_count": 11},
        {"time_tag": "2026-06-12T03:00:00Z", "kp": 2.33, "a_running": 6, "station_count": 12},
        {"time_tag": "2026-06-12T06:00:00Z", "kp": 2.33, "a_running": 6, "station_count": 12}
    ]"#;

    /// Kp forecast matching snapshot-storm.json expectations.
    pub const KP_FORECAST_JSON: &str = r#"[
        {"time_tag": "2026-06-12T12:00:00Z", "kp": 7.67},
        {"time_tag": "2026-06-12T15:00:00Z", "kp": 6.33}
    ]"#;

    /// Kyoto Dst — moderately disturbed (matching snapshot-storm.json: -142 nT).
    pub const DST_JSON: &str = r#"[
        {"time_tag": "2026-06-12T04:00:00Z", "dst": -128},
        {"time_tag": "2026-06-12T05:00:00Z", "dst": -135},
        {"time_tag": "2026-06-12T06:00:00Z", "dst": -140},
        {"time_tag": "2026-06-12T07:00:00Z", "dst": -142}
    ]"#;

    /// Quiet Dst.
    pub const DST_QUIET_JSON: &str = r#"[
        {"time_tag": "2026-06-12T04:00:00Z", "dst": -6},
        {"time_tag": "2026-06-12T05:00:00Z", "dst": -7},
        {"time_tag": "2026-06-12T06:00:00Z", "dst": -8},
        {"time_tag": "2026-06-12T07:00:00Z", "dst": -8}
    ]"#;

    /// F10.7 flux fixture.
    pub const F107_JSON: &str = r#"[
        {"time_tag": "2026-06-10T20:00:00Z", "flux": 178.5},
        {"time_tag": "2026-06-11T20:00:00Z", "flux": 182.5}
    ]"#;

    /// NOAA scales — G3 storm active, R1 minor radio blackout.
    pub const NOAA_SCALES_STORM_JSON: &str = r#"{
        "R": {"minor": "R1"},
        "S": {"minor": null},
        "G": {"minor": "G3"}
    }"#;

    /// NOAA scales — all quiet.
    pub const NOAA_SCALES_QUIET_JSON: &str = r#"{
        "R": {"minor": null},
        "S": {"minor": null},
        "G": {"minor": null}
    }"#;
}

// ===========================================================================
// Unit tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn obs() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 12, 8, 5, 0).unwrap()
    }

    // --- Kp parsing -------------------------------------------------------

    #[test]
    fn parse_kp_storm() {
        let result =
            parse_kp(fixtures::KP_JSON.as_bytes(), &obs()).expect("parse kp storm fixture");
        assert_eq!(result.data.value, 7.33);
        assert_eq!(result.data.measured_at, "2026-06-12T09:00:00Z");
        assert_eq!(result.data.g_scale, 3); // Kp 7.x → G3 (contracts kp_to_g)
                                            // Future timestamp → age_s clamped to 0, still "ok" (≤ 5400)
        assert_eq!(result.source_status.status, "ok");
        assert_eq!(result.source_status.age_s.unwrap(), 0.0);
    }

    #[test]
    fn parse_kp_quiet() {
        let result =
            parse_kp(fixtures::KP_QUIET_JSON.as_bytes(), &obs()).expect("parse kp quiet fixture");
        assert_eq!(result.data.value, 2.33);
        assert_eq!(result.data.measured_at, "2026-06-12T06:00:00Z");
        assert_eq!(result.data.g_scale, 0); // Kp < 5 → G0
                                            // 2026-06-12T08:05:00 - 2026-06-12T06:00:00 = 7500 s → stale ( > 5400 )
        assert_eq!(result.source_status.status, "stale");
        let age = result.source_status.age_s.unwrap();
        assert!(age > 5400.0);
    }

    #[test]
    fn parse_kp_empty() {
        let result = parse_kp(b"[]", &obs());
        assert!(result.is_err());
    }

    #[test]
    fn parse_kp_invalid_json() {
        let result = parse_kp(b"not json", &obs());
        assert!(result.is_err());
    }

    // --- Kp forecast ------------------------------------------------------

    #[test]
    fn parse_kp_forecast_ok() {
        let forecast = parse_kp_forecast(fixtures::KP_FORECAST_JSON.as_bytes(), &obs())
            .expect("parse kp forecast");
        assert_eq!(forecast.len(), 2);
        assert_eq!(forecast[0].valid_at, "2026-06-12T12:00:00Z");
        assert_eq!(forecast[0].value, 7.67);
        assert_eq!(forecast[1].valid_at, "2026-06-12T15:00:00Z");
        assert_eq!(forecast[1].value, 6.33);
    }

    // --- Dst parsing ------------------------------------------------------

    #[test]
    fn parse_dst_storm() {
        let result =
            parse_dst(fixtures::DST_JSON.as_bytes(), &obs()).expect("parse dst storm fixture");
        assert_eq!(result.data.value, -142.0);
        assert_eq!(result.data.measured_at, "2026-06-12T07:00:00Z");
        assert_eq!(result.source_status.status, "ok");
    }

    #[test]
    fn parse_dst_quiet() {
        let result = parse_dst(fixtures::DST_QUIET_JSON.as_bytes(), &obs())
            .expect("parse dst quiet fixture");
        assert_eq!(result.data.value, -8.0);
        assert_eq!(result.data.measured_at, "2026-06-12T07:00:00Z");
        // age = 3900 s → still ok (≤5400)
        assert_eq!(result.source_status.status, "ok");
    }

    #[test]
    fn parse_dst_empty() {
        let result = parse_dst(b"[]", &obs());
        assert!(result.is_err());
    }

    // --- F10.7 parsing ----------------------------------------------------

    #[test]
    fn parse_f107_ok() {
        let result =
            parse_f107(fixtures::F107_JSON.as_bytes(), &obs()).expect("parse f107 fixture");
        assert_eq!(result.data.value, 182.5);
        assert_eq!(result.data.measured_at, "2026-06-11T20:00:00Z");
        // age = 12h 45m = 45900 s → gap (>21600)
        assert_eq!(result.source_status.status, "gap");
    }

    // --- NOAA scales ------------------------------------------------------

    #[test]
    fn parse_noaa_scales_storm() {
        let scales = parse_noaa_scales(fixtures::NOAA_SCALES_STORM_JSON.as_bytes())
            .expect("parse noaa scales storm");
        assert_eq!(scales.r, Some("R1".into()));
        assert_eq!(scales.s, None);
        assert_eq!(scales.g, Some("G3".into()));
    }

    #[test]
    fn parse_noaa_scales_quiet() {
        let scales = parse_noaa_scales(fixtures::NOAA_SCALES_QUIET_JSON.as_bytes())
            .expect("parse noaa scales quiet");
        assert_eq!(scales.r, None);
        assert_eq!(scales.s, None);
        assert_eq!(scales.g, None);
    }

    // --- kp_to_g: contract golden vectors (exact) ------------------------

    #[test]
    fn kp_to_g_golden_vectors_match_contracts() {
        // These MUST match the exact values in contracts/fixtures/vectors/coupling.json
        // Test vector pairs from contracts/tests/formulas.py › kp_to_g
        let cases: &[(f64, u8)] = &[
            (0.0, 0),
            (4.33, 0),
            (4.99, 0),
            (5.0, 1),
            (5.67, 1),
            (6.33, 2),
            (7.0, 3),
            (8.67, 4),
            (8.99, 4),
            (9.0, 5),
        ];

        for &(kp, expected_g) in cases {
            let g = kp_to_g(kp);
            assert_eq!(
                g, expected_g,
                "kp_to_g({kp}) = {g}, expected {expected_g} (contract vector mismatch)"
            );
        }
    }

    #[test]
    fn kp_to_g_boundaries() {
        // Just-above / just-below each integer boundary
        assert_eq!(kp_to_g(4.999), 0);
        assert_eq!(kp_to_g(5.001), 1);
        assert_eq!(kp_to_g(5.999), 1);
        assert_eq!(kp_to_g(6.001), 2);
        assert_eq!(kp_to_g(6.999), 2);
        assert_eq!(kp_to_g(7.001), 3);
        assert_eq!(kp_to_g(7.999), 3);
        assert_eq!(kp_to_g(8.001), 4);
        assert_eq!(kp_to_g(8.999), 4);
        assert_eq!(kp_to_g(9.001), 5);
        assert_eq!(kp_to_g(15.0), 5);
    }

    // --- build_indices_snapshot -------------------------------------------

    #[test]
    fn build_snapshot_storm() {
        let kp = parse_kp(fixtures::KP_JSON.as_bytes(), &obs()).expect("kp");
        let fc = parse_kp_forecast(fixtures::KP_FORECAST_JSON.as_bytes(), &obs()).expect("fc");
        let dst = parse_dst(fixtures::DST_JSON.as_bytes(), &obs()).expect("dst");
        let f107 = parse_f107(fixtures::F107_JSON.as_bytes(), &obs()).expect("f107");
        let scales =
            parse_noaa_scales(fixtures::NOAA_SCALES_STORM_JSON.as_bytes()).expect("scales");

        let (snap, status) = build_indices_snapshot(kp, fc, dst, f107, scales);

        // Kp
        assert_eq!(snap.kp.value, 7.33);
        assert_eq!(snap.kp.g_scale, 3);
        // Forecast
        assert_eq!(snap.kp_forecast.len(), 2);
        assert_eq!(snap.kp_forecast[0].value, 7.67);
        // Dst
        assert_eq!(snap.dst_nt.value, -142.0);
        // F10.7
        assert_eq!(snap.f107.value, 182.5);
        // NOAA scales
        assert_eq!(snap.noaa_scales.g, Some("G3".into()));

        // Composite status: gap (from f107) > ok
        assert_eq!(status.status, "gap");
    }

    // --- source_status edge cases -----------------------------------------

    #[test]
    fn source_status_bad_timestamp_is_gap() {
        let s = source_status_for("garbage", &obs());
        assert_eq!(s.status, "gap");
        assert!(s.last_success_at.is_none());
        assert!(s.age_s.is_none());
    }

    #[test]
    fn composite_status_ranks_correctly() {
        let ok = SourceStatus::ok("2026-06-12T08:00:00Z", 60.0);
        let stale = SourceStatus::stale("2026-06-12T07:00:00Z", 3000.0);
        let gap = SourceStatus::gap();

        assert_eq!(composite_status(&[&ok, &ok, &ok]).status, "ok");
        assert_eq!(composite_status(&[&ok, &stale, &ok]).status, "stale");
        assert_eq!(composite_status(&[&ok, &stale, &gap]).status, "gap");
        assert_eq!(composite_status(&[&gap, &gap, &gap]).status, "gap");
    }

    // --- Schema compatibility: timed_value shape --------------------------

    #[test]
    fn kp_value_matches_timed_value_schema() {
        // The contracts schema expects {"value": number|null, "measured_at": iso|null}
        let v = KpValue {
            value: 7.33,
            measured_at: "2026-06-12T08:00:00Z".into(),
            g_scale: 3,
        };
        let json = serde_json::to_string(&v).expect("serialize");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("deserialize");
        assert!(parsed["value"].is_number());
        assert_eq!(parsed["value"].as_f64().unwrap(), 7.33);
        assert_eq!(
            parsed["measured_at"].as_str().unwrap(),
            "2026-06-12T08:00:00Z"
        );
    }

    #[test]
    fn dst_value_matches_timed_value_schema() {
        let v = DstValue {
            value: -142.0,
            measured_at: "2026-06-12T07:00:00Z".into(),
        };
        let json = serde_json::to_string(&v).expect("serialize");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("deserialize");
        assert!(parsed["value"].is_number());
        assert!(parsed["measured_at"].is_string());
    }

    #[test]
    fn noaa_scales_match_schema_pattern() {
        // G scale must be "G1".."G5" or null
        let scales = NoaaScales {
            r: Some("R1".into()),
            s: None,
            g: Some("G3".into()),
        };
        let json = serde_json::to_string(&scales).expect("serialize");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed["r"], "R1");
        assert_eq!(parsed["s"], serde_json::Value::Null);
        assert_eq!(parsed["g"], "G3");
    }
}
