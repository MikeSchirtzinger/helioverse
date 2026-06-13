//! Backfill types — the executable plan's data model.
//!
//! W1-P9: 30-day in-situ / event / imagery backfill.
//! All types are fixture-serializable so acceptance tests can round-trip.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

// ── archive status ────────────────────────────────────────────────────────

/// Per-day archive quality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveStatus {
    /// SWPC 1-min high-res data available (days 0–6).
    Rich,
    /// Only 1-hour or 1-day aggregates available; we fill what we can.
    Thin,
    /// No data found for this day at all.
    Missing,
}

impl ArchiveStatus {
    pub fn is_rich(&self) -> bool {
        matches!(self, ArchiveStatus::Rich)
    }
    pub fn is_degraded(&self) -> bool {
        matches!(self, ArchiveStatus::Thin | ArchiveStatus::Missing)
    }
}

/// Classification threshold: SWPC retains 7-day 1-min plasma/mag (spec §3.1).
pub const RICH_WINDOW_DAYS: i64 = 7;

/// Classify a `day_offset` from "now" (0 = today).
pub fn classify_day(day_offset: i64, in_situ_available: bool, event_available: bool) -> ArchiveStatus {
    if !in_situ_available && !event_available {
        ArchiveStatus::Missing
    } else if day_offset < RICH_WINDOW_DAYS && in_situ_available {
        ArchiveStatus::Rich
    } else if in_situ_available || event_available {
        ArchiveStatus::Thin
    } else {
        ArchiveStatus::Missing
    }
}

// ── in-situ daily consolidated record ─────────────────────────────────────

/// One minute-resolution in-situ point: speed, Bz, density.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InSituSample {
    /// Unix timestamp (UTC) of this 1-min bin.
    pub t_unix: i64,
    /// Bulk solar-wind speed (km/s), null if gapped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_kms: Option<f64>,
    /// GSM Bz (nT), null if gapped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bz_gsm_nt: Option<f64>,
    /// Proton density (p/cm^3), null if gapped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub density_pcc: Option<f64>,
}

/// A single consolidated day of 1-min in-situ data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InSituDay {
    /// Schema version marker.
    pub schema_version: String,
    /// The UTC date this file covers (YYYY-MM-DD).
    pub date: String,
    /// Archive quality for this day.
    pub status: ArchiveStatus,
    /// Number of 1-min samples in `series`.
    pub sample_count: u32,
    /// Number of samples with non-null speed.
    pub non_null_speed: u32,
    /// Number of samples with non-null Bz.
    pub non_null_bz: u32,
    /// Flags: "thin" = derived from hourly/daily aggregates; absent = native 1-min.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// The 1-min series (index-aligned; up to 1440 entries).
    pub series: Vec<InSituSample>,
}

// ── event backfill entry ──────────────────────────────────────────────────

/// Event file produced.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventBackfillEntry {
    /// R2 key: `v1/events/{event-key}.json`
    pub r2_key: String,
    /// The DONKI-style event ID.
    pub event_id: String,
    /// Event type.
    pub event_type: String,
    /// Whether we have a thumbnail for it.
    pub has_thumbnail: bool,
}

// ── imagery backfill entry ────────────────────────────────────────────────

/// Imagery frame produced.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageryEntry {
    /// R2 key: `v1/imagery/sdo/{wl}/archive/YYYY/MM/DD/HH00.jpg`
    pub r2_key: String,
    /// Wavelength (e.g. "0304", "0193", "hmi").
    pub wavelength: String,
    /// Whether the frame is expected to exist.
    pub available: bool,
}

// ── daily plan ────────────────────────────────────────────────────────────

/// One day's worth of backfill output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayPlan {
    /// The UTC date.
    pub date: NaiveDate,
    /// Days ago from "now" (0 = today, positive = past).
    pub day_offset: i64,
    /// Archive classification for this day.
    pub status: ArchiveStatus,
    /// R2 key for the consolidated daily in-situ file.
    pub in_situ_key: String,
    /// Expected sample count: 1440 for Rich, 24 for Thin (hourly aggregates).
    pub expected_samples: u32,
    /// Event entries for this day.
    pub events: Vec<EventBackfillEntry>,
    /// Imagery entries for this day (3 wavelengths × 24 hours).
    pub imagery: Vec<ImageryEntry>,
}

// ── coverage report ───────────────────────────────────────────────────────

/// Summary statistics over a range of days.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageReport {
    /// The date span.
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub total_days: usize,
    /// Status breakdown.
    pub rich_days: usize,
    pub thin_days: usize,
    pub missing_days: usize,
    /// In-situ row totals.
    pub total_in_situ_samples: u64,
    pub total_non_null_speed: u64,
    pub total_non_null_bz: u64,
    /// Event totals.
    pub total_events: usize,
    pub events_with_thumbnail: usize,
    /// Imagery totals (expected frames; n wavelengths × n hours for available days).
    pub total_imagery_entries: usize,
    pub available_imagery: usize,
}

// ── full backfill plan ────────────────────────────────────────────────────

/// The executable backfill plan covering 30 days.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackfillPlan {
    /// Contract version.
    pub schema_version: String,
    /// When this plan was generated.
    pub generated_at: DateTime<Utc>,
    /// Reference date for "day offset" calculations.
    pub reference_date: NaiveDate,
    /// Days of backfill (ordered oldest → newest by convention).
    pub days: Vec<DayPlan>,
    /// Coverage roll-up.
    pub coverage: CoverageReport,
    /// Archive-thin days annotated with fallback notes.
    pub thin_days: Vec<NaiveDate>,
    /// Whether this plan requires live credentials.
    pub requires_live_auth: bool,
}

// ── builders ──────────────────────────────────────────────────────────────

/// Build a 30-day backfill plan from fixture data (no live pulls).
pub fn build_backfill_plan(
    reference_date: NaiveDate,
    day_events: &[(NaiveDate, Vec<(&str, &str, bool)>)],  // date, [(event_id, type, has_thumb)]
    day_has_insitu: impl Fn(NaiveDate) -> bool,
    imagery_available: impl Fn(NaiveDate, /* hour */ u8, /* wl */ &str) -> bool,
) -> BackfillPlan {
    let history_days: i64 = 30;
    let mut days: Vec<DayPlan> = Vec::with_capacity(history_days as usize);
    let mut thin_dates: Vec<NaiveDate> = Vec::new();

    for offset in 0..history_days {
        let date = reference_date - Duration::days(offset);
        let insitu_ok = day_has_insitu(date);
        let event_entries: Vec<&(NaiveDate, Vec<(&str, &str, bool)>)> =
            day_events.iter().filter(|(d, _)| *d == date).collect();
        let has_events = !event_entries.is_empty();
        let status = classify_day(offset, insitu_ok, has_events);

        if status == ArchiveStatus::Thin {
            thin_dates.push(date);
        }

        let expected_samples: u32 = match status {
            ArchiveStatus::Rich => 1440,
            ArchiveStatus::Thin => 24,  // hourly aggregates
            ArchiveStatus::Missing => 0,
        };

        let in_situ_key = format!("v1/history/insitu/{}.json", date.format("%Y-%m-%d"));

        let events: Vec<EventBackfillEntry> = event_entries
            .iter()
            .flat_map(|(_, evs)| evs.iter())
            .map(|(eid, etype, has_thumb)| {
                let key = event_r2_key(eid);
                EventBackfillEntry {
                    r2_key: key,
                    event_id: eid.to_string(),
                    event_type: etype.to_string(),
                    has_thumbnail: *has_thumb,
                }
            })
            .collect();

        let wavelengths = ["0304", "0193", "hmi"];
        let mut imagery: Vec<ImageryEntry> = Vec::with_capacity(24 * wavelengths.len());
        if status != ArchiveStatus::Missing {
            for hour in 0..24u8 {
                for wl in &wavelengths {
                    let r2_key = format!(
                        "v1/imagery/sdo/{}/archive/{}/{}.jpg",
                        wl,
                        date.format("%Y/%m/%d"),
                        format!("{:02}00", hour)
                    );
                    let avail = imagery_available(date, hour, wl);
                    imagery.push(ImageryEntry { r2_key, wavelength: wl.to_string(), available: avail });
                }
            }
        }

        days.push(DayPlan {
            date,
            day_offset: offset,
            status,
            in_situ_key,
            expected_samples,
            events,
            imagery,
        });
    }

    // Build coverage report.
    let rich_days = days.iter().filter(|d| d.status == ArchiveStatus::Rich).count();
    let thin_days_count = days.iter().filter(|d| d.status == ArchiveStatus::Thin).count();
    let missing_days = days.iter().filter(|d| d.status == ArchiveStatus::Missing).count();

    let total_in_situ_samples: u64 = days.iter().map(|d| d.expected_samples as u64).sum();
    let total_non_null_speed = (rich_days * 1440 + thin_days_count * 24) as u64; // rough estimate
    let total_non_null_bz = total_non_null_speed;

    let total_events: usize = days.iter().map(|d| d.events.len()).sum();
    let events_with_thumbnail: usize = days.iter().flat_map(|d| &d.events).filter(|e| e.has_thumbnail).count();
    let total_imagery: usize = days.iter().map(|d| d.imagery.len()).sum();
    let available_imagery: usize = days.iter().flat_map(|d| &d.imagery).filter(|i| i.available).count();

    let coverage = CoverageReport {
        start_date: days.last().map(|d| d.date).unwrap_or(reference_date),
        end_date: days.first().map(|d| d.date).unwrap_or(reference_date),
        total_days: days.len(),
        rich_days,
        thin_days: thin_days_count,
        missing_days,
        total_in_situ_samples,
        total_non_null_speed,
        total_non_null_bz,
        total_events,
        events_with_thumbnail,
        total_imagery_entries: total_imagery,
        available_imagery,
    };

    BackfillPlan {
        schema_version: "1.0.0".to_string(),
        generated_at: Utc::now(),
        reference_date,
        days,
        coverage,
        thin_days: thin_dates,
        requires_live_auth: false,
    }
}

// ── R2 key helpers (per contracts/r2-layout.md) ───────────────────────────

/// Convert a DONKI-style event ID to an R2 event key.
/// Strip the colon from the time portion.
/// `2026-06-04T07:31Z-CME-001` → `v1/events/2026-06-04T0731Z-CME-001.json`
pub fn event_r2_key(event_id: &str) -> String {
    // Replace "T07:31Z" → "T0731Z" (strip colon between HH and MM in the time portion).
    let stripped = strip_time_colon(event_id);
    format!("v1/events/{}.json", stripped)
}

fn strip_time_colon(id: &str) -> String {
    // Find the T...Z portion and remove the colon.
    if let Some(t_pos) = id.find('T') {
        let prefix = &id[..t_pos + 1]; // up to and including "T"
        let remainder = &id[t_pos + 1..];
        if let Some(colon_pos) = remainder.find(':') {
            let hh = &remainder[..colon_pos];
            let mm = &remainder[colon_pos + 1..];
            return format!("{}{}{}", prefix, hh, mm);
        }
    }
    id.to_string()
}

/// Generate the R2 key for a daily consolidated in-situ file.
pub fn insitu_r2_key(date: NaiveDate) -> String {
    format!("v1/history/insitu/{}.json", date.format("%Y-%m-%d"))
}

/// Generate the R2 key for an hourly imagery archive frame.
pub fn imagery_r2_key(date: NaiveDate, hour: u8, wavelength: &str) -> String {
    format!(
        "v1/imagery/sdo/{}/archive/{}/{}.jpg",
        wavelength,
        date.format("%Y/%m/%d"),
        format!("{:02}00", hour)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_day_rich() {
        assert_eq!(classify_day(0, true, true), ArchiveStatus::Rich);
        assert_eq!(classify_day(6, true, true), ArchiveStatus::Rich);
    }

    #[test]
    fn test_classify_day_thin() {
        // Day 7 with in-situ available = thin
        assert_eq!(classify_day(7, true, false), ArchiveStatus::Thin);
        // Day 7 with events but no in-situ = thin
        assert_eq!(classify_day(7, false, true), ArchiveStatus::Thin);
        // Day 20 with both = thin
        assert_eq!(classify_day(20, true, true), ArchiveStatus::Thin);
    }

    #[test]
    fn test_classify_day_missing() {
        assert_eq!(classify_day(10, false, false), ArchiveStatus::Missing);
        assert_eq!(classify_day(29, false, false), ArchiveStatus::Missing);
    }

    #[test]
    fn test_event_r2_key_strips_colon() {
        let id = "2026-06-04T07:31Z-CME-001";
        assert_eq!(event_r2_key(id), "v1/events/2026-06-04T0731Z-CME-001.json");
    }

    #[test]
    fn test_event_r2_key_no_colon() {
        let id = "2026-06-04T0731Z-CME-001";
        assert_eq!(event_r2_key(id), "v1/events/2026-06-04T0731Z-CME-001.json");
    }

    #[test]
    fn test_insitu_r2_key() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 4).unwrap();
        assert_eq!(insitu_r2_key(date), "v1/history/insitu/2026-06-04.json");
    }

    #[test]
    fn test_imagery_r2_key() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 4).unwrap();
        assert_eq!(
            imagery_r2_key(date, 14, "0193"),
            "v1/imagery/sdo/0193/archive/2026/06/04/1400.jpg"
        );
    }

    #[test]
    fn test_build_backfill_plan_30_days_no_data() {
        // No in-situ, no events → all 30 days Missing
        let ref_date = NaiveDate::from_ymd_opt(2026, 6, 12).unwrap();
        let has_insitu = |_d: NaiveDate| -> bool { false };
        let imagery_ok = |_d: NaiveDate, _h: u8, _wl: &str| -> bool { false };
        let events: Vec<(NaiveDate, Vec<(&str, &str, bool)>)> = vec![];

        let plan = build_backfill_plan(ref_date, &events, has_insitu, imagery_ok);

        assert_eq!(plan.days.len(), 30);
        assert_eq!(plan.coverage.rich_days, 0);
        assert_eq!(plan.coverage.thin_days, 0);
        assert_eq!(plan.coverage.missing_days, 30);
        assert_eq!(plan.coverage.total_in_situ_samples, 0);
        assert_eq!(plan.coverage.total_imagery_entries, 0);
        assert!(plan.thin_days.is_empty());
    }

    #[test]
    fn test_build_backfill_plan_realistic_30_day() {
        // Realistic: 7 rich in-situ days, then 23 days with DONKI events (thin)
        let ref_date = NaiveDate::from_ymd_opt(2026, 6, 12).unwrap();

        let has_insitu = |d: NaiveDate| -> bool {
            (ref_date - d).num_days() < 7
        };
        let imagery_ok = |_d: NaiveDate, _h: u8, _wl: &str| -> bool { true };

        // Build owned event IDs, then convert to &str refs in the vec
        let mut event_ids: Vec<String> = Vec::new();
        let mut event_refs: Vec<(NaiveDate, Vec<(&str, &str, bool)>)> = Vec::new();

        for offset in 7..30 {
            let date = ref_date - Duration::days(offset);
            let eid = format!("{}T12:00Z-CME-{:03}", date.format("%Y-%m-%d"), offset as u32);
            event_ids.push(eid);
        }

        for (i, offset) in (7..30).enumerate() {
            let date = ref_date - Duration::days(offset);
            let eid: &str = &event_ids[i];
            let has_thumb = offset % 2 == 0;
            event_refs.push((date, vec![(eid, "CME", has_thumb)]));
        }

        let plan = build_backfill_plan(ref_date, &event_refs, has_insitu, imagery_ok);

        assert_eq!(plan.days.len(), 30);
        assert_eq!(plan.coverage.rich_days, 7);
        assert_eq!(plan.coverage.thin_days, 23);
        assert_eq!(plan.coverage.missing_days, 0);

        // Sample counts: 7×1440 + 23×24 = 10080+552 = 10632
        assert_eq!(plan.coverage.total_in_situ_samples, 10632);

        // Events: one per thin day = 23 total
        assert_eq!(plan.coverage.total_events, 23);

        // Imagery: 30 days × 24h × 3wl = 2160
        assert_eq!(plan.coverage.total_imagery_entries, 2160);
        assert_eq!(plan.coverage.available_imagery, 2160);

        // Thin day list has 23 entries
        assert_eq!(plan.thin_days.len(), 23);

        // Verify thin day keys use hourly (24 samples)
        let thin_day = plan.days.iter().find(|d| d.status == ArchiveStatus::Thin).unwrap();
        assert_eq!(thin_day.expected_samples, 24);

        // Rich day has 1440 samples
        let rich_day = plan.days.iter().find(|d| d.status == ArchiveStatus::Rich).unwrap();
        assert_eq!(rich_day.expected_samples, 1440);

        assert!(!plan.requires_live_auth);
    }

    #[test]
    fn test_build_backfill_plan_with_events() {
        let ref_date = NaiveDate::from_ymd_opt(2026, 6, 12).unwrap();
        let has_insitu = |_d: NaiveDate| -> bool { false }; // all thin
        let imagery_ok = |_d: NaiveDate, _h: u8, _wl: &str| -> bool { false };

        let d1 = NaiveDate::from_ymd_opt(2026, 6, 10).unwrap();
        let d2 = NaiveDate::from_ymd_opt(2026, 5, 20).unwrap();

        let events: Vec<(NaiveDate, Vec<(&str, &str, bool)>)> = vec![
            (d1, vec![("2026-06-10T14:00Z-CME-001", "CME", true)]),
            (d2, vec![("2026-05-20T11:12Z-CME-002", "CME", false)]),
        ];

        let plan = build_backfill_plan(ref_date, &events, has_insitu, imagery_ok);

        // Event totals
        assert_eq!(plan.coverage.total_events, 2);
        assert_eq!(plan.coverage.events_with_thumbnail, 1);

        // Check day with events
        let day10 = plan.days.iter().find(|d| d.date == d1).unwrap();
        assert_eq!(day10.events.len(), 1);
        assert_eq!(day10.events[0].event_id, "2026-06-10T14:00Z-CME-001");
        assert!(day10.events[0].has_thumbnail);

        // Check R2 key for event
        assert_eq!(
            day10.events[0].r2_key,
            "v1/events/2026-06-10T1400Z-CME-001.json"
        );
    }

    #[test]
    fn test_build_backfill_plan_missing_days() {
        let ref_date = NaiveDate::from_ymd_opt(2026, 6, 12).unwrap();
        // No in-situ and no events = missing
        let has_insitu = |_d: NaiveDate| -> bool { false };
        let imagery_ok = |_d: NaiveDate, _h: u8, _wl: &str| -> bool { false };
        let events: Vec<(NaiveDate, Vec<(&str, &str, bool)>)> = vec![];

        let plan = build_backfill_plan(ref_date, &events, has_insitu, imagery_ok);

        assert_eq!(plan.coverage.missing_days, 30);
        assert_eq!(plan.coverage.rich_days, 0);
        assert_eq!(plan.coverage.thin_days, 0);
        assert_eq!(plan.coverage.total_in_situ_samples, 0);
        assert_eq!(plan.coverage.total_imagery_entries, 0);
    }

    #[test]
    fn test_insitu_day_serialization() {
        let day = InSituDay {
            schema_version: "1.0.0".to_string(),
            date: "2026-06-12".to_string(),
            status: ArchiveStatus::Rich,
            sample_count: 2,
            non_null_speed: 2,
            non_null_bz: 2,
            notes: None,
            series: vec![
                InSituSample { t_unix: 1781250240, speed_kms: Some(381.0), bz_gsm_nt: Some(2.3), density_pcc: Some(4.1) },
                InSituSample { t_unix: 1781250300, speed_kms: Some(380.0), bz_gsm_nt: Some(2.1), density_pcc: Some(4.2) },
            ],
        };

        let json = serde_json::to_string_pretty(&day).unwrap();
        assert!(json.contains("2026-06-12"));
        assert!(json.contains("1781250240"));

        let round_tripped: InSituDay = serde_json::from_str(&json).unwrap();
        assert_eq!(round_tripped.sample_count, 2);
        assert_eq!(round_tripped.series[0].speed_kms, Some(381.0));
    }

    #[test]
    fn test_insitu_day_thin_notes() {
        let day = InSituDay {
            schema_version: "1.0.0".to_string(),
            date: "2026-05-20".to_string(),
            status: ArchiveStatus::Thin,
            sample_count: 24,
            non_null_speed: 24,
            non_null_bz: 24,
            notes: Some("thin: derived from SWPC 1-hour aggregates; SWPC high-res only covers last 7 days".to_string()),
            series: vec![],
        };

        let json = serde_json::to_string(&day).unwrap();
        assert!(json.contains("thin"));
        assert!(json.contains("1-hour aggregates"));
    }

    #[test]
    fn test_backfill_plan_round_trip_json() {
        let ref_date = NaiveDate::from_ymd_opt(2026, 6, 12).unwrap();
        let has_insitu = |d: NaiveDate| -> bool { (ref_date - d).num_days() < 7 };
        let imagery_ok = |_d: NaiveDate, _h: u8, _wl: &str| -> bool { true };

        use std::fs;
        // Load real event fixture from contracts/
        let event_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../contracts/fixtures/events/event-cme-halo.json"
        );
        let event_json = fs::read_to_string(event_path).unwrap();
        let event_val: serde_json::Value = serde_json::from_str(&event_json).unwrap();
        let event_id = event_val["id"].as_str().unwrap();
        let event_type = event_val["type"].as_str().unwrap();
        let has_thumb = event_val["thumbnail"].is_object();

        let event_date = NaiveDate::from_ymd_opt(2026, 6, 4).unwrap();
        let events: Vec<(NaiveDate, Vec<(&str, &str, bool)>)> = vec![
            (event_date, vec![(event_id, event_type, has_thumb)]),
        ];

        let plan = build_backfill_plan(ref_date, &events, has_insitu, imagery_ok);

        // Round-trip through JSON
        let json = serde_json::to_string_pretty(&plan).unwrap();
        let plan2: BackfillPlan = serde_json::from_str(&json).unwrap();

        assert_eq!(plan.days.len(), plan2.days.len());
        assert_eq!(plan.coverage.rich_days, plan2.coverage.rich_days);
        assert_eq!(plan.coverage.total_events, plan2.coverage.total_events);

        // Verify the real event's R2 key is correct
        let day_plan = plan.days.iter().find(|d| d.date == event_date).unwrap();
        assert_eq!(day_plan.events.len(), 1);
        assert_eq!(day_plan.events[0].event_id, "2026-06-04T07:31Z-CME-001");
        assert_eq!(
            day_plan.events[0].r2_key,
            "v1/events/2026-06-04T0731Z-CME-001.json"
        );
        assert!(day_plan.events[0].has_thumbnail);
    }

    #[test]
    fn test_all_contract_event_fixtures_keyed() {
        // Every event fixture maps to a valid R2 key
        use std::fs;
        let fixtures_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../contracts/fixtures/events");
        let mut count = 0;
        if let Ok(entries) = fs::read_dir(fixtures_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    let json = fs::read_to_string(&path).unwrap();
                    let val: serde_json::Value = serde_json::from_str(&json).unwrap();
                    let event_id = val["id"].as_str().unwrap();
                    let key = event_r2_key(event_id);
                    assert!(
                        key.starts_with("v1/events/"),
                        "bad key for {}: {}",
                        event_id,
                        key
                    );
                    assert!(
                        key.ends_with(".json"),
                        "key missing .json: {}",
                        key
                    );
                    // Verify colon stripped in time portion
                    // The raw ID has "T07:31Z" → key must have "T0731Z" (no colon)
                    if event_id.contains(':') {
                        // Check that the key has no colon in the time fragment
                        let after_t: Vec<&str> = key.split('T').collect();
                        if after_t.len() >= 2 {
                            let time_part = after_t[1];
                            assert!(!time_part.contains(':'), "colon not stripped in {}", key);
                        }
                    }
                    count += 1;
                }
            }
        }
        assert!(count >= 3, "expected at least 3 event fixtures, found {}", count);
    }

    #[test]
    fn test_r2_key_layout_matches_contract() {
        // Verify key patterns match contracts/r2-layout.md

        // In-situ daily key
        let date = NaiveDate::from_ymd_opt(2026, 6, 4).unwrap();
        let key = insitu_r2_key(date);
        assert_eq!(key, "v1/history/insitu/2026-06-04.json");

        // Event key (colon stripped)
        let ek = event_r2_key("2026-06-04T07:31Z-CME-001");
        assert_eq!(ek, "v1/events/2026-06-04T0731Z-CME-001.json");

        // Imagery key
        let ik = imagery_r2_key(date, 0, "0304");
        assert_eq!(ik, "v1/imagery/sdo/0304/archive/2026/06/04/0000.jpg");

        let ik2 = imagery_r2_key(date, 23, "hmi");
        assert_eq!(ik2, "v1/imagery/sdo/hmi/archive/2026/06/04/2300.jpg");
    }

    #[test]
    fn test_coverage_report_rich_thin_ratio() {
        let ref_date = NaiveDate::from_ymd_opt(2026, 6, 12).unwrap();
        let has_insitu = |d: NaiveDate| -> bool {
            (ref_date - d).num_days() < 7
        };
        let imagery_ok = |_d: NaiveDate, _h: u8, _wl: &str| -> bool { true };
        let events: Vec<(NaiveDate, Vec<(&str, &str, bool)>)> = vec![];

        let plan = build_backfill_plan(ref_date, &events, has_insitu, imagery_ok);

        // 7/30 = 23% rich, 23/30 = 77% thin at best
        let rich_pct = plan.coverage.rich_days as f64 / plan.coverage.total_days as f64 * 100.0;
        assert!(rich_pct > 20.0, "expected at least 20% rich, got {:.1}%", rich_pct);

        // Verify thin_days list length
        assert_eq!(plan.thin_days.len(), plan.coverage.thin_days);
    }
}
