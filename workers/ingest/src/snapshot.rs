//! W1-P1f: Combined snapshot writer — fixture-first, schema-valid.
//! Owner: DeepSeek builder (deepseek/deepseek-v4-pro) / GPT validator
//!
//! Combines normalized feed outputs into a JSON object compatible with
//! `contracts/schemas/snapshot.schema.json`. The SnapshotBuilder accepts
//! typed feed types from sibling modules; fixture tests construct snapshots
//! without any live network or secrets.
//!
//! ## Invariants enforced
//! - L1→Earth delay = spacecraft_distance_km / speed_kms, or fixed 1800 s
//!   fallback when plasma is stale/gapped (spec §2.1).
//! - `arriving_now_measured_at` = `l1_measured_at` + delay_s.
//! - Every snapshot carries `generated_at` (append-only as-of wall clock),
//!   `clocks.*` (three-clock badges from spec §2), and `sources.*` status
//!   per upstream feed health.
//! - Schema version pinned to "1.0.0".

use chrono::{DateTime, TimeDelta, Utc};
use serde::Serialize;

use super::feeds::{
    donki::NormalizedEvent,
    ovation::SnapshotOvationPointer,
    swpc_indices::{IndicesSnapshot, SourceStatus},
    swpc_l1::L1Sample,
};

// ═══════════════════════════════════════════════════════════════════════════
// Canonical snapshot types — serialize exactly to snapshot.schema.json
// ═══════════════════════════════════════════════════════════════════════════

pub const SNAPSHOT_SCHEMA_VERSION: &str = "1.0.0";
pub const FIXED_FALLBACK_DELAY_S: f64 = 1800.0;
pub const L1_DISTANCE_KM: f64 = 1_500_000.0;

/// The top-level combined snapshot object.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Snapshot {
    pub schema_version: String,
    pub generated_at: String,
    pub cadence_s: u32,
    pub clocks: SnapshotClocks,
    pub sources: SnapshotSources,
    pub solar_wind: SolarWindSnapshot,
    pub l1_to_earth: L1ToEarthSnapshot,
    pub indices: IndicesSection,
    pub ovation: SnapshotOvationSection,
    pub alerts: Vec<AlertItem>,
    pub events_active: Vec<String>,
}

/// Three-clock badges per spec §2 / §7.3.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SnapshotClocks {
    pub sun_imagery_at: Option<String>,
    pub l1_measured_at: Option<String>,
    pub model_run_at: Option<String>,
}

/// Per-upstream source health — drives staleness badges and the
/// degraded-forecast fallback rule (spec §2.1).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SnapshotSources {
    pub swpc_plasma: SourceStatusEntry,
    pub swpc_mag: SourceStatusEntry,
    pub swpc_indices: SourceStatusEntry,
    pub ovation: SourceStatusEntry,
    pub donki: SourceStatusEntry,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goes_csm: Option<SourceStatusEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdo_imagery: Option<SourceStatusEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helioviewer: Option<SourceStatusEntry>,
}

/// A single source_status object (matches `$defs/source_status` in schema).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SourceStatusEntry {
    pub status: String, // "ok" | "stale" | "gap"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_success_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_s: Option<f64>,
}

/// Solar wind section with scalar + trailing series.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SolarWindSnapshot {
    pub measured_at: String,
    pub spacecraft: String,
    pub speed_kms: Option<f64>,
    pub density_pcc: Option<f64>,
    pub temperature_k: Option<f64>,
    pub bt_nt: Option<f64>,
    pub bx_gsm_nt: Option<f64>,
    pub by_gsm_nt: Option<f64>,
    pub bz_gsm_nt: Option<f64>,
    pub series: TrailingSeries,
}

/// L1→Earth delay correction section (spec §2.1).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct L1ToEarthSnapshot {
    pub spacecraft_distance_km: f64,
    pub delay_s: f64,
    pub delay_quality: String, // "measured" | "degraded_fixed"
    pub arriving_now_measured_at: String,
}

/// Indices section — re-serialized from swpc_indices types.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct IndicesSection {
    pub kp: TimedValue,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub kp_forecast: Vec<KpForecastEntry>,
    pub dst_nt: TimedValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f107: Option<TimedValue>,
    pub noaa_scales: NoaaScalesEntry,
}

/// Schema-compatible timed_value: {value, measured_at}.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TimedValue {
    pub value: Option<f64>,
    pub measured_at: Option<String>,
}

/// Kp forecast entry.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KpForecastEntry {
    pub valid_at: String,
    pub value: f64,
}

/// NOAA scales.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NoaaScalesEntry {
    #[serde(rename = "R")]
    pub r: Option<String>,
    #[serde(rename = "S")]
    pub s: Option<String>,
    #[serde(rename = "G")]
    pub g: Option<String>,
}

/// OVATION section (pointer metadata; grid is in R2).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SnapshotOvationSection {
    pub observation_time: String,
    pub forecast_time: String,
    pub grid_r2_key: String,
    pub hemispheric_power_gw: Option<f64>,
}

/// Alert item.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AlertItem {
    pub issued_at: String,
    pub code: String,
    pub title: String,
}

/// Trailing series window (up to 256 points) for sparklines + WASM engine.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TrailingSeries {
    pub t_unix: Vec<i64>,
    pub speed_kms: Vec<Option<f64>>,
    pub bz_gsm_nt: Vec<Option<f64>>,
    pub density_pcc: Vec<Option<f64>>,
}

// ═══════════════════════════════════════════════════════════════════════════
// Builder
// ═══════════════════════════════════════════════════════════════════════════

/// Fixture-first snapshot builder — no live network, no secrets.
///
/// Feed adapters produce their typed outputs; the builder assembles them
/// into a schema-valid `Snapshot`.  Tests can inject fixture data at any
/// level of granularity, from individual fields to complete feed outputs.
#[derive(Debug, Clone)]
pub struct SnapshotBuilder {
    generated_at: DateTime<Utc>,
    cadence_s: u32,
    clocks: SnapshotClocks,
    sources: SnapshotSources,
    solar_wind: Option<SolarWindSnapshot>,
    indices: Option<IndicesSection>,
    ovation: Option<SnapshotOvationSection>,
    alerts: Vec<AlertItem>,
    events_active: Vec<String>,
    // L1 delay computation inputs (pre-computed before snapshot is sealed)
    spacecraft_distance_km: f64,
    last_known_speed_kms: Option<f64>,
    plasma_source_status: String,
    l1_measured_at: Option<DateTime<Utc>>,
}

impl SnapshotBuilder {
    /// Create a new builder pinned to an as-of wall-clock time.
    pub fn new(generated_at: DateTime<Utc>, cadence_s: u32) -> Self {
        Self {
            generated_at,
            cadence_s,
            clocks: SnapshotClocks {
                sun_imagery_at: None,
                l1_measured_at: None,
                model_run_at: None,
            },
            sources: SnapshotSources::all_gap(),
            solar_wind: None,
            indices: None,
            ovation: None,
            alerts: Vec::new(),
            events_active: Vec::new(),
            spacecraft_distance_km: L1_DISTANCE_KM,
            last_known_speed_kms: None,
            plasma_source_status: "ok".to_string(),
            l1_measured_at: None,
        }
    }

    /// Set the three clocks (spec §2) from feed metadata.
    pub fn with_clocks(mut self, sun_imagery_at: Option<String>, l1_measured_at: Option<String>, model_run_at: Option<String>) -> Self {
        self.clocks = SnapshotClocks { sun_imagery_at, l1_measured_at: l1_measured_at.clone(), model_run_at };
        if let Some(ref ts) = l1_measured_at {
            self.l1_measured_at = parse_iso(ts);
        }
        self
    }

    /// Set source status for a named upstream feed.
    pub fn with_source(mut self, name: &str, status: SourceStatusEntry) -> Self {
        match name {
            "swpc_plasma" => {
                self.plasma_source_status = status.status.clone();
                self.sources.swpc_plasma = status;
            }
            "swpc_mag" => self.sources.swpc_mag = status,
            "swpc_indices" => self.sources.swpc_indices = status,
            "ovation" => self.sources.ovation = status,
            "donki" => self.sources.donki = status,
            "goes_csm" => self.sources.goes_csm = Some(status),
            "sdo_imagery" => self.sources.sdo_imagery = Some(status),
            "helioviewer" => self.sources.helioviewer = Some(status),
            _ => {}
        }
        self
    }

    /// Feed solar wind from a typed `L1Sample`.
    pub fn with_l1_sample(mut self, sample: &L1Sample, spacecraft_distance_km: f64) -> Self {
        self.spacecraft_distance_km = spacecraft_distance_km;
        self.last_known_speed_kms = sample.speed_kms;
        let measured_at = sample.observed_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

        self.clocks.l1_measured_at = Some(measured_at.clone());

        self.solar_wind = Some(SolarWindSnapshot {
            measured_at: measured_at.clone(),
            spacecraft: sample.source.as_str().to_string(),
            speed_kms: sample.speed_kms,
            density_pcc: sample.density_pcc,
            temperature_k: sample.temperature_k,
            bt_nt: sample.bt_nt,
            bx_gsm_nt: sample.bx_gsm_nt,
            by_gsm_nt: sample.by_gsm_nt,
            bz_gsm_nt: sample.bz_gsm_nt,
            series: TrailingSeries {
                t_unix: vec![sample.observed_at.timestamp()],
                speed_kms: vec![sample.speed_kms],
                bz_gsm_nt: vec![sample.bz_gsm_nt],
                density_pcc: vec![sample.density_pcc],
            },
        });
        self
    }

    /// Set explicit spacecraft distance for L1→Earth delay calculation.
    pub fn with_spacecraft_distance_km(mut self, distance_km: f64) -> Self {
        self.spacecraft_distance_km = distance_km;
        self
    }

    /// Feed solar wind from raw values + trailing series (for fixture tests).
    pub fn with_solar_wind_raw(
        mut self,
        measured_at: &str,
        spacecraft: &str,
        speed_kms: Option<f64>,
        density_pcc: Option<f64>,
        temperature_k: Option<f64>,
        bt_nt: Option<f64>,
        bx_gsm_nt: Option<f64>,
        by_gsm_nt: Option<f64>,
        bz_gsm_nt: Option<f64>,
        series: TrailingSeries,
    ) -> Self {
        self.last_known_speed_kms = speed_kms;
        self.clocks.l1_measured_at = Some(measured_at.to_string());
        self.l1_measured_at = parse_iso(measured_at);
        self.solar_wind = Some(SolarWindSnapshot {
            measured_at: measured_at.to_string(),
            spacecraft: spacecraft.to_string(),
            speed_kms,
            density_pcc,
            temperature_k,
            bt_nt,
            bx_gsm_nt,
            by_gsm_nt,
            bz_gsm_nt,
            series,
        });
        self
    }

    /// Feed indices from the typed indices snapshot.
    pub fn with_indices(mut self, indices: &IndicesSnapshot) -> Self {
        self.indices = Some(IndicesSection {
            kp: TimedValue {
                value: Some(indices.kp.value),
                measured_at: Some(indices.kp.measured_at.clone()),
            },
            kp_forecast: indices
                .kp_forecast
                .iter()
                .map(|f| KpForecastEntry {
                    valid_at: f.valid_at.clone(),
                    value: f.value,
                })
                .collect(),
            dst_nt: TimedValue {
                value: Some(indices.dst_nt.value),
                measured_at: Some(indices.dst_nt.measured_at.clone()),
            },
            f107: Some(TimedValue {
                value: Some(indices.f107.value),
                measured_at: Some(indices.f107.measured_at.clone()),
            }),
            noaa_scales: NoaaScalesEntry {
                r: indices.noaa_scales.r.clone(),
                s: indices.noaa_scales.s.clone(),
                g: indices.noaa_scales.g.clone(),
            },
        });
        self
    }

    /// Feed OVATION pointer metadata.
    pub fn with_ovation(mut self, pointer: &SnapshotOvationPointer) -> Self {
        self.ovation = Some(SnapshotOvationSection {
            observation_time: pointer.observation_time.clone(),
            forecast_time: pointer.forecast_time.clone(),
            grid_r2_key: pointer.grid_r2_key.clone(),
            hemispheric_power_gw: pointer.hemispheric_power_gw,
        });
        self
    }

    /// Attach alerts.
    pub fn with_alerts(mut self, alerts: Vec<AlertItem>) -> Self {
        self.alerts = alerts;
        self
    }

    /// Set active event IDs.
    pub fn with_events_active(mut self, events: &[NormalizedEvent]) -> Self {
        self.events_active = events.iter().map(|e| e.id.clone()).collect();
        self
    }

    /// Set active event IDs from strings.
    pub fn with_event_ids(mut self, ids: Vec<String>) -> Self {
        self.events_active = ids;
        self
    }

    /// Compute L1→Earth delay and set `l1_to_earth`.
    ///
    /// If plasma is stale/gapped or speed is missing, uses the fixed
    /// 1800 s fallback with `delay_quality = "degraded_fixed"`.
    fn compute_l1_to_earth(&self) -> L1ToEarthSnapshot {
        let (delay_s, delay_quality) = if self.plasma_source_status == "ok" {
            if let Some(speed) = self.last_known_speed_kms {
                if speed > 0.0 {
                    (self.spacecraft_distance_km / speed, "measured".to_string())
                } else {
                    (FIXED_FALLBACK_DELAY_S, "degraded_fixed".to_string())
                }
            } else {
                (FIXED_FALLBACK_DELAY_S, "degraded_fixed".to_string())
            }
        } else {
            (FIXED_FALLBACK_DELAY_S, "degraded_fixed".to_string())
        };

        let delay = TimeDelta::seconds(delay_s.round() as i64);
        let l1_measured_dt = self
            .l1_measured_at
            .or_else(|| self.solar_wind.as_ref().and_then(|sw| parse_iso(&sw.measured_at)))
            .unwrap_or(self.generated_at);
        let arriving_now = l1_measured_dt + delay;

        L1ToEarthSnapshot {
            spacecraft_distance_km: self.spacecraft_distance_km,
            delay_s: round1(delay_s),
            delay_quality,
            arriving_now_measured_at: arriving_now
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        }
    }

    /// Seal the builder into a complete `Snapshot`.
    ///
    /// This MUST be called exactly once.  Missing required sections are
    /// filled with zero/empty defaults matching the schema shape.
    pub fn build(mut self) -> Snapshot {
        if self.solar_wind.is_none() {
            self.solar_wind = Some(SolarWindSnapshot {
                measured_at: format_iso(self.generated_at),
                spacecraft: "DSCOVR".to_string(),
                speed_kms: None,
                density_pcc: None,
                temperature_k: None,
                bt_nt: None,
                bx_gsm_nt: None,
                by_gsm_nt: None,
                bz_gsm_nt: None,
                series: TrailingSeries::empty(),
            });
            self.clocks.l1_measured_at = Some(format_iso(self.generated_at));
            self.l1_measured_at = Some(self.generated_at);
        }

        let l1_to_earth = self.compute_l1_to_earth();
        let generated_at = format_iso(self.generated_at);
        let sw = self.solar_wind.take().unwrap();

        let indices = self.indices.unwrap_or_else(|| IndicesSection {
            kp: TimedValue { value: None, measured_at: None },
            kp_forecast: Vec::new(),
            dst_nt: TimedValue { value: None, measured_at: None },
            f107: None,
            noaa_scales: NoaaScalesEntry { r: None, s: None, g: None },
        });

        let ovation = self.ovation.unwrap_or_else(|| SnapshotOvationSection {
            observation_time: generated_at.clone(),
            forecast_time: generated_at.clone(),
            grid_r2_key: "v1/ovation/latest.json".to_string(),
            hemispheric_power_gw: None,
        });

        Snapshot {
            schema_version: SNAPSHOT_SCHEMA_VERSION.to_string(),
            generated_at,
            cadence_s: self.cadence_s,
            clocks: self.clocks,
            sources: self.sources,
            solar_wind: sw,
            l1_to_earth,
            indices,
            ovation,
            alerts: self.alerts,
            events_active: self.events_active,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Source status helpers
// ═══════════════════════════════════════════════════════════════════════════

impl SourceStatusEntry {
    pub fn ok(last_success_at: &str, age_s: f64) -> Self {
        Self {
            status: "ok".to_string(),
            last_success_at: Some(last_success_at.to_string()),
            age_s: Some(age_s),
        }
    }

    pub fn stale(last_success_at: &str, age_s: f64) -> Self {
        Self {
            status: "stale".to_string(),
            last_success_at: Some(last_success_at.to_string()),
            age_s: Some(age_s),
        }
    }

    pub fn gap() -> Self {
        Self {
            status: "gap".to_string(),
            last_success_at: None,
            age_s: None,
        }
    }

    /// Convert from the swpc_indices SourceStatus (which uses different
    /// field names in some cases but same logical shape).
    pub fn from_indices_status(s: &SourceStatus) -> Self {
        Self {
            status: s.status.clone(),
            last_success_at: s.last_success_at.clone(),
            age_s: s.age_s,
        }
    }
}

impl SnapshotSources {
    /// All sources start as "gap" — must be set explicitly.
    pub fn all_gap() -> Self {
        Self {
            swpc_plasma: SourceStatusEntry::gap(),
            swpc_mag: SourceStatusEntry::gap(),
            swpc_indices: SourceStatusEntry::gap(),
            ovation: SourceStatusEntry::gap(),
            donki: SourceStatusEntry::gap(),
            goes_csm: None,
            sdo_imagery: None,
            helioviewer: None,
        }
    }
}

impl TrailingSeries {
    pub fn empty() -> Self {
        Self {
            t_unix: Vec::new(),
            speed_kms: Vec::new(),
            bz_gsm_nt: Vec::new(),
            density_pcc: Vec::new(),
        }
    }

    /// Build from a slice of L1Samples, keeping at most `max_points`.
    pub fn from_l1_samples(samples: &[L1Sample], max_points: usize) -> Self {
        let n = samples.len().min(max_points);
        let mut t_unix = Vec::with_capacity(n);
        let mut speed_kms = Vec::with_capacity(n);
        let mut bz_gsm_nt = Vec::with_capacity(n);
        let mut density_pcc = Vec::with_capacity(n);

        for s in &samples[..n] {
            t_unix.push(s.observed_at.timestamp());
            speed_kms.push(s.speed_kms);
            bz_gsm_nt.push(s.bz_gsm_nt);
            density_pcc.push(s.density_pcc);
        }

        Self { t_unix, speed_kms, bz_gsm_nt, density_pcc }
    }

    /// Build from standalone arrays (for fixture tests).
    pub fn from_arrays(
        t_unix: Vec<i64>,
        speed_kms: Vec<Option<f64>>,
        bz_gsm_nt: Vec<Option<f64>>,
        density_pcc: Vec<Option<f64>>,
    ) -> Self {
        Self { t_unix, speed_kms, bz_gsm_nt, density_pcc }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

fn format_iso(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn parse_iso(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

// ═══════════════════════════════════════════════════════════════════════════
// Fixture builders for deterministic tests
// ═══════════════════════════════════════════════════════════════════════════

/// Pre-built fixture: G3 storm snapshot matching snapshot-storm.json contract.
pub fn fixture_storm_snapshot() -> Snapshot {
    let gen_at = parse_iso("2026-06-12T08:05:00Z").unwrap();
    SnapshotBuilder::new(gen_at, 60)
        .with_spacecraft_distance_km(1_520_000.0)
        .with_clocks(
            Some("2026-06-12T07:49:00Z".into()),
            Some("2026-06-12T08:04:00Z".into()),
            Some("2026-06-12T06:00:00Z".into()),
        )
        .with_source("swpc_plasma", SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0))
        .with_source("swpc_mag", SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0))
        .with_source("swpc_indices", SourceStatusEntry::ok("2026-06-12T08:00:10Z", 290.0))
        .with_source("ovation", SourceStatusEntry::ok("2026-06-12T08:01:00Z", 240.0))
        .with_source("donki", SourceStatusEntry::ok("2026-06-12T07:50:00Z", 900.0))
        .with_source("goes_csm", SourceStatusEntry::ok("2026-06-12T07:55:00Z", 600.0))
        .with_source("sdo_imagery", SourceStatusEntry::ok("2026-06-12T07:49:00Z", 960.0))
        .with_solar_wind_raw(
            "2026-06-12T08:04:00Z",
            "DSCOVR",
            Some(720.0),
            Some(18.5),
            Some(410_000.0),
            Some(21.0),
            Some(-3.0),
            Some(6.2),
            Some(-17.4),
            TrailingSeries::from_arrays(
                vec![1781250240, 1781250300, 1781250360, 1781250420, 1781250480, 1781250540],
                vec![Some(705.0), Some(712.0), Some(718.5), Some(716.0), Some(722.0), Some(720.0)],
                vec![Some(-14.2), Some(-15.8), Some(-16.5), Some(-17.0), Some(-17.8), Some(-17.4)],
                vec![Some(16.0), Some(17.2), Some(18.0), Some(18.8), Some(18.2), Some(18.5)],
            ),
        )
        .with_indices(&crate::feeds::swpc_indices::IndicesSnapshot {
            kp: crate::feeds::swpc_indices::KpValue {
                value: 7.33,
                measured_at: "2026-06-12T08:00:00Z".into(),
                g_scale: 3,
            },
            kp_forecast: vec![
                crate::feeds::swpc_indices::KpForecastPoint {
                    valid_at: "2026-06-12T09:00:00Z".into(), value: 7.67,
                },
                crate::feeds::swpc_indices::KpForecastPoint {
                    valid_at: "2026-06-12T12:00:00Z".into(), value: 6.33,
                },
            ],
            dst_nt: crate::feeds::swpc_indices::DstValue {
                value: -142.0,
                measured_at: "2026-06-12T07:00:00Z".into(),
            },
            f107: crate::feeds::swpc_indices::F107Value {
                value: 182.5,
                measured_at: "2026-06-11T20:00:00Z".into(),
            },
            noaa_scales: crate::feeds::swpc_indices::NoaaScales {
                r: Some("R1".into()),
                s: None,
                g: Some("G3".into()),
            },
        })
        .with_ovation(&SnapshotOvationPointer {
            observation_time: "2026-06-12T08:00:00Z".into(),
            forecast_time: "2026-06-12T08:30:00Z".into(),
            grid_r2_key: "v1/ovation/latest.json".into(),
            hemispheric_power_gw: Some(95.3),
        })
        .with_alerts(vec![AlertItem {
            issued_at: "2026-06-12T07:42:00Z".into(),
            code: "ALTK07".into(),
            title: "Geomagnetic K-index of 7 reached".into(),
        }])
        .with_event_ids(vec!["2026-06-04T07:31Z-CME-001".into()])
        .build()
}

/// Pre-built fixture: quiet snapshot matching snapshot-quiet.json contract.
pub fn fixture_quiet_snapshot() -> Snapshot {
    let gen_at = parse_iso("2026-06-12T08:05:00Z").unwrap();
    SnapshotBuilder::new(gen_at, 300)
        .with_spacecraft_distance_km(1_480_000.0)
        .with_clocks(
            Some("2026-06-12T07:49:00Z".into()),
            Some("2026-06-12T08:04:00Z".into()),
            Some("2026-06-12T06:00:00Z".into()),
        )
        .with_source("swpc_plasma", SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0))
        .with_source("swpc_mag", SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0))
        .with_source("swpc_indices", SourceStatusEntry::ok("2026-06-12T08:00:10Z", 290.0))
        .with_source("ovation", SourceStatusEntry::ok("2026-06-12T08:01:00Z", 240.0))
        .with_source("donki", SourceStatusEntry::ok("2026-06-12T07:50:00Z", 900.0))
        .with_source("goes_csm", SourceStatusEntry::ok("2026-06-12T07:55:00Z", 600.0))
        .with_source("sdo_imagery", SourceStatusEntry::ok("2026-06-12T07:49:00Z", 960.0))
        .with_solar_wind_raw(
            "2026-06-12T08:04:00Z",
            "DSCOVR",
            Some(380.0),
            Some(4.2),
            Some(85_000.0),
            Some(5.1),
            Some(1.2),
            Some(-2.0),
            Some(2.1),
            TrailingSeries::from_arrays(
                vec![1781249040, 1781249340, 1781249640, 1781249940, 1781250240, 1781250540],
                vec![Some(376.0), Some(377.5), Some(379.0), Some(378.2), Some(381.0), Some(380.0)],
                vec![Some(1.8), Some(2.4), Some(2.0), Some(1.5), Some(2.3), Some(2.1)],
                vec![Some(4.0), Some(4.1), Some(4.3), Some(4.2), Some(4.1), Some(4.2)],
            ),
        )
        .with_indices(&crate::feeds::swpc_indices::IndicesSnapshot {
            kp: crate::feeds::swpc_indices::KpValue {
                value: 2.33, measured_at: "2026-06-12T08:00:00Z".into(), g_scale: 0,
            },
            kp_forecast: vec![
                crate::feeds::swpc_indices::KpForecastPoint {
                    valid_at: "2026-06-12T09:00:00Z".into(), value: 2.33,
                },
                crate::feeds::swpc_indices::KpForecastPoint {
                    valid_at: "2026-06-12T12:00:00Z".into(), value: 2.0,
                },
            ],
            dst_nt: crate::feeds::swpc_indices::DstValue {
                value: -8.0, measured_at: "2026-06-12T07:00:00Z".into(),
            },
            f107: crate::feeds::swpc_indices::F107Value {
                value: 148.2, measured_at: "2026-06-11T20:00:00Z".into(),
            },
            noaa_scales: crate::feeds::swpc_indices::NoaaScales {
                r: None, s: None, g: None,
            },
        })
        .with_ovation(&SnapshotOvationPointer {
            observation_time: "2026-06-12T08:00:00Z".into(),
            forecast_time: "2026-06-12T08:30:00Z".into(),
            grid_r2_key: "v1/ovation/latest.json".into(),
            hemispheric_power_gw: Some(12.4),
        })
        .with_event_ids(vec![])
        .build()
}

/// Pre-built fixture: degraded snapshot matching snapshot-degraded.json contract.
pub fn fixture_degraded_snapshot() -> Snapshot {
    let gen_at = parse_iso("2026-06-12T08:05:00Z").unwrap();
    SnapshotBuilder::new(gen_at, 300)
        .with_clocks(
            Some("2026-06-12T07:49:00Z".into()),
            Some("2026-06-12T06:49:00Z".into()),
            Some("2026-06-12T06:00:00Z".into()),
        )
        .with_source("swpc_plasma", SourceStatusEntry::stale("2026-06-12T06:49:00Z", 4560.0))
        .with_source("swpc_mag", SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0))
        .with_source("swpc_indices", SourceStatusEntry::ok("2026-06-12T08:00:10Z", 290.0))
        .with_source("ovation", SourceStatusEntry::ok("2026-06-12T08:01:00Z", 240.0))
        .with_source("donki", SourceStatusEntry::gap())
        .with_source("goes_csm", SourceStatusEntry::ok("2026-06-12T07:55:00Z", 600.0))
        .with_source("sdo_imagery", SourceStatusEntry::ok("2026-06-12T07:49:00Z", 960.0))
        .with_solar_wind_raw(
            "2026-06-12T06:49:00Z",
            "ACE",
            Some(385.0),
            Some(3.8),
            Some(79_000.0),
            Some(4.8),
            Some(0.9),
            Some(-1.6),
            Some(1.4),
            TrailingSeries::from_arrays(
                vec![1781243340, 1781243640, 1781243940, 1781244240, 1781244540, 1781244840],
                vec![Some(388.0), Some(386.5), None, None, Some(384.0), Some(385.0)],
                vec![Some(1.2), Some(1.6), None, None, Some(1.5), Some(1.4)],
                vec![Some(3.9), Some(3.8), None, None, Some(3.7), Some(3.8)],
            ),
        )
        .with_indices(&crate::feeds::swpc_indices::IndicesSnapshot {
            kp: crate::feeds::swpc_indices::KpValue {
                value: 2.0, measured_at: "2026-06-12T08:00:00Z".into(), g_scale: 0,
            },
            kp_forecast: vec![],
            dst_nt: crate::feeds::swpc_indices::DstValue {
                value: -5.0, measured_at: "2026-06-12T07:00:00Z".into(),
            },
            f107: crate::feeds::swpc_indices::F107Value {
                value: 148.2, measured_at: "2026-06-11T20:00:00Z".into(),
            },
            noaa_scales: crate::feeds::swpc_indices::NoaaScales {
                r: None, s: None, g: None,
            },
        })
        .with_ovation(&SnapshotOvationPointer {
            observation_time: "2026-06-12T08:00:00Z".into(),
            forecast_time: "2026-06-12T08:30:00Z".into(),
            grid_r2_key: "v1/ovation/latest.json".into(),
            hemispheric_power_gw: Some(10.1),
        })
        .with_event_ids(vec![])
        .build()
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn gen_at() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 12, 8, 5, 0).unwrap()
    }

    // ── SnapshotBuilder core construction ─────────────────────────────────

    #[test]
    fn builder_defaults_minimal_schema_valid_shape() {
        let snap = SnapshotBuilder::new(gen_at(), 300).build();
        assert_eq!(snap.schema_version, "1.0.0");
        assert_eq!(snap.generated_at, "2026-06-12T08:05:00Z");
        assert_eq!(snap.cadence_s, 300);
        assert!(snap.sources.swpc_plasma.status == "gap");
        assert!(snap.alerts.is_empty());
        assert!(snap.events_active.is_empty());

        // Default solar wind must have measured_at set to generated_at
        assert_eq!(snap.solar_wind.measured_at, "2026-06-12T08:05:00Z");
        // L1 delay with default values (no speed => degraded)
        assert_eq!(snap.l1_to_earth.delay_quality, "degraded_fixed");
        assert_eq!(snap.l1_to_earth.delay_s, 1800.0);
    }

    #[test]
    fn builder_computes_l1_delay_from_speed() {
        let snap = SnapshotBuilder::new(gen_at(), 60)
            .with_source("swpc_plasma", SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0))
            .with_solar_wind_raw(
                "2026-06-12T08:04:00Z", "DSCOVR",
                Some(720.0),
                Some(18.5), Some(410_000.0),
                Some(21.0), Some(-3.0), Some(6.2), Some(-17.4),
                TrailingSeries::empty(),
            )
            .build();

        assert_eq!(snap.l1_to_earth.delay_quality, "measured");
        let expected_delay = L1_DISTANCE_KM / 720.0;
        assert!((snap.l1_to_earth.delay_s - expected_delay).abs() < 0.2,
            "delay_s {} != distance/speed {}", snap.l1_to_earth.delay_s, expected_delay);

        // arriving_now = l1_measured_at + delay_s
        let arriving = parse_iso(&snap.l1_to_earth.arriving_now_measured_at).unwrap();
        let l1_at = parse_iso(&snap.clocks.l1_measured_at.unwrap()).unwrap();
        let drift = (arriving - l1_at).num_seconds() as f64;
        assert!((drift - snap.l1_to_earth.delay_s).abs() < 1.0,
            "arriving_now not l1_measured_at + delay_s");
    }

    #[test]
    fn builder_degrades_to_fixed_delay_when_plasma_stale() {
        let snap = SnapshotBuilder::new(gen_at(), 300)
            .with_source("swpc_plasma", SourceStatusEntry::stale("2026-06-12T06:49:00Z", 4560.0))
            .with_solar_wind_raw(
                "2026-06-12T06:49:00Z", "ACE",
                Some(385.0),
                Some(3.8), Some(79_000.0),
                Some(4.8), Some(0.9), Some(-1.6), Some(1.4),
                TrailingSeries::empty(),
            )
            .build();

        assert_eq!(snap.l1_to_earth.delay_quality, "degraded_fixed");
        assert_eq!(snap.l1_to_earth.delay_s, FIXED_FALLBACK_DELAY_S);
    }

    #[test]
    fn builder_degrades_when_speed_is_null() {
        let snap = SnapshotBuilder::new(gen_at(), 60)
            .with_source("swpc_plasma", SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0))
            .with_solar_wind_raw(
                "2026-06-12T08:04:00Z", "DSCOVR",
                None, // no speed
                Some(18.5), Some(410_000.0),
                Some(21.0), Some(-3.0), Some(6.2), Some(-17.4),
                TrailingSeries::empty(),
            )
            .build();

        assert_eq!(snap.l1_to_earth.delay_quality, "degraded_fixed");
        assert_eq!(snap.l1_to_earth.delay_s, FIXED_FALLBACK_DELAY_S);
    }

    #[test]
    fn builder_degrades_when_speed_is_zero() {
        let snap = SnapshotBuilder::new(gen_at(), 60)
            .with_source("swpc_plasma", SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0))
            .with_solar_wind_raw(
                "2026-06-12T08:04:00Z", "DSCOVR",
                Some(0.0),
                Some(18.5), Some(410_000.0),
                Some(21.0), Some(-3.0), Some(6.2), Some(-17.4),
                TrailingSeries::empty(),
            )
            .build();

        assert_eq!(snap.l1_to_earth.delay_quality, "degraded_fixed");
    }

    // ── Source status wiring ──────────────────────────────────────────────

    #[test]
    fn source_status_entries_serialize_correctly() {
        let ok = SourceStatusEntry::ok("2026-06-12T08:04:30Z", 30.0);
        let json = serde_json::to_value(&ok).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["last_success_at"], "2026-06-12T08:04:30Z");
        assert_eq!(json["age_s"], 30.0);

        let gap = SourceStatusEntry::gap();
        let json = serde_json::to_value(&gap).unwrap();
        assert_eq!(json["status"], "gap");
        // nulls are skipped via skip_serializing_if
        assert!(json.get("last_success_at").is_none() || json["last_success_at"].is_null());
    }

    // ── Trailing series ───────────────────────────────────────────────────

    #[test]
    fn trailing_series_from_l1_samples_respects_max_points() {
        use crate::feeds::swpc_l1::{L1Source, parse_l1_samples};

        let plasma = crate::feeds::swpc_l1::DSCOVR_PLASMA_FIXTURE;
        let mag = crate::feeds::swpc_l1::DSCOVR_MAG_FIXTURE;
        let samples = parse_l1_samples(plasma, mag, L1Source::Dscovr, gen_at(), TimeDelta::seconds(90))
            .unwrap();

        let series = TrailingSeries::from_l1_samples(&samples, 256);
        assert_eq!(series.t_unix.len(), 3);
        assert_eq!(series.speed_kms.len(), 3);
        assert_eq!(series.bz_gsm_nt.len(), 3);

        let series = TrailingSeries::from_l1_samples(&samples, 1);
        assert_eq!(series.t_unix.len(), 1);
    }

    #[test]
    fn trailing_series_empty_is_valid() {
        let s = TrailingSeries::empty();
        assert!(s.t_unix.is_empty());
        assert!(s.speed_kms.is_empty());
    }

    // ── Fixture snapshots match contract shape ────────────────────────────

    #[test]
    fn storm_fixture_schema_required_fields() {
        let snap = fixture_storm_snapshot();
        let json = serde_json::to_value(&snap).unwrap();

        assert_eq!(json["schema_version"], "1.0.0");
        assert_eq!(json["cadence_s"], 60);
        assert!(json["clocks"]["l1_measured_at"].as_str().is_some());
        assert!(json["sources"]["swpc_plasma"]["status"] == "ok");
        assert!(json["solar_wind"]["speed_kms"].as_f64() == Some(720.0));
        assert_eq!(json["l1_to_earth"]["delay_quality"], "measured");
        assert!(json["indices"]["kp"]["value"].as_f64() == Some(7.33));
        assert!(!json["alerts"].as_array().unwrap().is_empty());
        assert!(!json["events_active"].as_array().unwrap().is_empty());
    }

    #[test]
    fn quiet_fixture_schema_required_fields() {
        let snap = fixture_quiet_snapshot();
        let json = serde_json::to_value(&snap).unwrap();

        assert_eq!(json["schema_version"], "1.0.0");
        assert_eq!(json["cadence_s"], 300);
        assert_eq!(json["l1_to_earth"]["delay_quality"], "measured");
        assert_eq!(json["solar_wind"]["bz_gsm_nt"].as_f64(), Some(2.1));
        assert!(json["alerts"].as_array().unwrap().is_empty());
        assert!(json["events_active"].as_array().unwrap().is_empty());
    }

    #[test]
    fn degraded_fixture_has_fixed_delay_and_stale_plasma() {
        let snap = fixture_degraded_snapshot();
        let json = serde_json::to_value(&snap).unwrap();

        assert_eq!(json["l1_to_earth"]["delay_quality"], "degraded_fixed");
        assert_eq!(json["l1_to_earth"]["delay_s"], 1800.0);
        assert_eq!(json["sources"]["swpc_plasma"]["status"], "stale");
        assert_eq!(json["sources"]["donki"]["status"], "gap");

        // Nulls in series should serialize as null
        let bz_series = json["solar_wind"]["series"]["bz_gsm_nt"].as_array().unwrap();
        assert!(bz_series[2].is_null());
        assert!(bz_series[3].is_null());
    }

    #[test]
    fn storm_fixture_serializes_roundtrips_to_valid_snapshot() {
        let snap = fixture_storm_snapshot();
        let json_str = serde_json::to_string(&snap).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();

        // Spot-check numeric precision on delay
        let delay = parsed["l1_to_earth"]["delay_s"].as_f64().unwrap();
        assert!(delay > 2000.0 && delay < 2200.0, "storm delay should be ~2083s for 720 km/s");

        // arriving_now is valid ISO-8601
        let arriving = parsed["l1_to_earth"]["arriving_now_measured_at"].as_str().unwrap();
        assert!(arriving.ends_with('Z'));
    }

    #[test]
    fn snapshot_l1_delay_invariant_distance_divided_by_speed() {
        let snap = fixture_storm_snapshot();
        // Storm fixture uses spacecraft_distance_km = 1_520_000
        let expected_delay = 1_520_000.0 / 720.0; // ~2111.1
        assert!((snap.l1_to_earth.delay_s - expected_delay).abs() < 0.2,
            "delay_s {} != {} (~{})", snap.l1_to_earth.delay_s, expected_delay,
            f64::trunc(expected_delay * 10.0) / 10.0);
    }

    #[test]
    fn snapshot_arriving_now_invariant() {
        let snap = fixture_quiet_snapshot();
        let l1_at = parse_iso("2026-06-12T08:04:00Z").unwrap();
        let arriving = parse_iso(&snap.l1_to_earth.arriving_now_measured_at).unwrap();
        let drift = (arriving - l1_at).num_seconds() as f64;
        assert!((drift - snap.l1_to_earth.delay_s).abs() < 1.0,
            "arriving_now ({}) not l1_measured_at ({}) + delay_s ({})",
            arriving, l1_at, snap.l1_to_earth.delay_s);
    }

    #[test]
    fn snapshot_series_arrays_are_index_aligned() {
        let snap = fixture_storm_snapshot();
        let n = snap.solar_wind.series.t_unix.len();
        assert_eq!(snap.solar_wind.series.speed_kms.len(), n);
        assert_eq!(snap.solar_wind.series.bz_gsm_nt.len(), n);
        assert_eq!(snap.solar_wind.series.density_pcc.len(), n);
        assert!(n > 0 && n <= 256);
    }

    #[test]
    fn snapshot_json_matches_contract_fixture_storm() {
        let snap = fixture_storm_snapshot();
        let got: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&snap).unwrap()).unwrap();

        // Load the contract fixture for comparison
        let fixture_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../contracts/fixtures/snapshot/snapshot-storm.json"
        );
        let want: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(fixture_path).unwrap()).unwrap();

        // Structural field-equality on shared keys
        assert_eq!(got["schema_version"], want["schema_version"]);
        assert_eq!(got["generated_at"], want["generated_at"]);
        assert_eq!(got["cadence_s"], want["cadence_s"]);

        // Clocks
        assert_eq!(got["clocks"]["l1_measured_at"], want["clocks"]["l1_measured_at"]);
        assert_eq!(got["clocks"]["sun_imagery_at"], want["clocks"]["sun_imagery_at"]);
        assert_eq!(got["clocks"]["model_run_at"], want["clocks"]["model_run_at"]);

        // Sources spot-check
        assert_eq!(got["sources"]["swpc_plasma"]["status"], want["sources"]["swpc_plasma"]["status"]);
        assert_eq!(got["sources"]["ovation"]["status"], want["sources"]["ovation"]["status"]);

        // Solar wind
        assert_eq!(got["solar_wind"]["measured_at"], want["solar_wind"]["measured_at"]);
        assert_eq!(got["solar_wind"]["spacecraft"], want["solar_wind"]["spacecraft"]);
        assert_eq!(got["solar_wind"]["speed_kms"], want["solar_wind"]["speed_kms"]);
        assert_eq!(got["solar_wind"]["bz_gsm_nt"], want["solar_wind"]["bz_gsm_nt"]);

        // L1 delay
        assert_eq!(got["l1_to_earth"]["delay_quality"], want["l1_to_earth"]["delay_quality"]);
        let got_delay = got["l1_to_earth"]["delay_s"].as_f64().unwrap();
        let want_delay = want["l1_to_earth"]["delay_s"].as_f64().unwrap();
        assert!((got_delay - want_delay).abs() < 0.15,
            "delay_s mismatch: got {}, want {}", got_delay, want_delay);

        // Indices
        assert_eq!(got["indices"]["kp"]["value"], want["indices"]["kp"]["value"]);
        // dst_nt may be integer (-142) in contract but float (-142.0) from serde
        let got_dst = got["indices"]["dst_nt"]["value"].as_f64().unwrap();
        let want_dst = want["indices"]["dst_nt"]["value"].as_f64().unwrap();
        assert!((got_dst - want_dst).abs() < 0.01,
            "dst_nt mismatch: got {}, want {}", got_dst, want_dst);
        assert_eq!(got["indices"]["noaa_scales"], want["indices"]["noaa_scales"]);

        // OVATION
        assert_eq!(got["ovation"]["observation_time"], want["ovation"]["observation_time"]);
        assert_eq!(got["ovation"]["forecast_time"], want["ovation"]["forecast_time"]);
        assert_eq!(got["ovation"]["grid_r2_key"], want["ovation"]["grid_r2_key"]);

        // Alerts
        assert_eq!(got["alerts"], want["alerts"]);
        // Events
        assert_eq!(got["events_active"], want["events_active"]);
    }

    #[test]
    fn snapshot_json_matches_contract_fixture_quiet() {
        let snap = fixture_quiet_snapshot();
        let got: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&snap).unwrap()).unwrap();

        let fixture_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../contracts/fixtures/snapshot/snapshot-quiet.json"
        );
        let want: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(fixture_path).unwrap()).unwrap();

        assert_eq!(got["cadence_s"], want["cadence_s"]);
        assert_eq!(got["solar_wind"]["speed_kms"], want["solar_wind"]["speed_kms"]);
        assert_eq!(got["solar_wind"]["bz_gsm_nt"], want["solar_wind"]["bz_gsm_nt"]);
        assert_eq!(got["l1_to_earth"]["delay_quality"], want["l1_to_earth"]["delay_quality"]);
        let got_delay = got["l1_to_earth"]["delay_s"].as_f64().unwrap();
        let want_delay = want["l1_to_earth"]["delay_s"].as_f64().unwrap();
        assert!((got_delay - want_delay).abs() < 0.15,
            "delay_s mismatch: got {}, want {}", got_delay, want_delay);
        assert_eq!(got["indices"]["kp"]["value"], want["indices"]["kp"]["value"]);
        assert_eq!(got["indices"]["noaa_scales"], want["indices"]["noaa_scales"]);
        assert!(got["alerts"].as_array().unwrap().is_empty());
        assert!(got["events_active"].as_array().unwrap().is_empty());
    }

    #[test]
    fn snapshot_json_matches_contract_fixture_degraded() {
        let snap = fixture_degraded_snapshot();
        let got: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&snap).unwrap()).unwrap();

        let fixture_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../contracts/fixtures/snapshot/snapshot-degraded.json"
        );
        let want: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(fixture_path).unwrap()).unwrap();

        assert_eq!(got["l1_to_earth"]["delay_quality"], want["l1_to_earth"]["delay_quality"]);
        // delay_s: contract uses integer 1800, our serde produces 1800.0 — compare as f64
        let got_delay = got["l1_to_earth"]["delay_s"].as_f64().unwrap();
        let want_delay = want["l1_to_earth"]["delay_s"].as_f64().unwrap();
        assert!((got_delay - want_delay).abs() < 0.01,
            "delay_s mismatch: got {}, want {}", got_delay, want_delay);
        assert_eq!(got["sources"]["swpc_plasma"]["status"], want["sources"]["swpc_plasma"]["status"]);
        assert_eq!(got["sources"]["donki"]["status"], want["sources"]["donki"]["status"]);
        assert_eq!(got["solar_wind"]["spacecraft"], want["solar_wind"]["spacecraft"]);

        // Nulls in series
        let got_bz = &got["solar_wind"]["series"]["bz_gsm_nt"];
        let want_bz = &want["solar_wind"]["series"]["bz_gsm_nt"];
        assert_eq!(got_bz[2], want_bz[2]);
        assert_eq!(got_bz[3], want_bz[3]);
    }

    // ── Edge cases ────────────────────────────────────────────────────────

    #[test]
    fn snapshot_respects_cadence_constraint() {
        // cadence must be 60 or 300 per schema
        let snap60 = SnapshotBuilder::new(gen_at(), 60).build();
        assert_eq!(snap60.cadence_s, 60);

        let snap300 = SnapshotBuilder::new(gen_at(), 300).build();
        assert_eq!(snap300.cadence_s, 300);
    }

    #[test]
    fn snapshot_max_alert_items() {
        let mut alerts = Vec::new();
        for i in 0..32 {
            alerts.push(AlertItem {
                issued_at: "2026-06-12T00:00:00Z".into(),
                code: format!("ALT{:03}", i),
                title: format!("Alert {}", i),
            });
        }
        let snap = SnapshotBuilder::new(gen_at(), 60)
            .with_alerts(alerts)
            .build();
        assert_eq!(snap.alerts.len(), 32); // max 32 per schema
    }

    #[test]
    fn snapshot_max_active_events() {
        let ids: Vec<String> = (0..64).map(|i| format!("2026-06-12T00:0{:02}Z-CME-{:03}", i % 10, i)).collect();
        let snap = SnapshotBuilder::new(gen_at(), 60)
            .with_event_ids(ids)
            .build();
        assert_eq!(snap.events_active.len(), 64); // max 64 per schema
    }

    #[test]
    fn snapshot_serializes_without_extra_fields() {
        let snap = fixture_storm_snapshot();
        let json = serde_json::to_value(&snap).unwrap();
        let obj = json.as_object().unwrap();

        let valid_keys: std::collections::HashSet<&str> = [
            "schema_version", "generated_at", "cadence_s", "clocks", "sources",
            "solar_wind", "l1_to_earth", "indices", "ovation", "alerts", "events_active"
        ].iter().copied().collect();

        for key in obj.keys() {
            assert!(valid_keys.contains(key.as_str()),
                "unexpected snapshot key: {}", key);
        }
    }
}
