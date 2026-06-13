//! Fixture-first SWPC L1 solar-wind adapter.
//!
//! SWPC publishes DSCOVR/ACE solar-wind plasma and magnetic-field products as
//! small JSON tables whose first row is a header, for example:
//! `[["time_tag", "density", "speed", "temperature"], ...]` and
//! `[["time_tag", "bx_gsm", "by_gsm", "bz_gsm", "lon_gsm", "lat_gsm", "bt"], ...]`.
//!
//! This module deliberately keeps live I/O at the boundary: URL constants and a
//! fetch plan are exposed, while all parser tests use deterministic inline
//! fixtures.  Callers must provide `as_of` (the ingest/archive timestamp) so the
//! measurement time (`observed_at`) is never confused with append time.

use chrono::{DateTime, NaiveDateTime, TimeDelta, Utc};
use serde_json::{Map, Value};
use std::fmt;

/// SWPC no-auth base URL.
pub const SWPC_BASE_URL: &str = "https://services.swpc.noaa.gov";

/// Near-real-time plasma products.  The 2-hour product is the normal cron input;
/// longer products are useful for backfill or local diagnostics.
pub const SWPC_PLASMA_5_MINUTE_URL: &str =
    "https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json";
pub const SWPC_PLASMA_2_HOUR_URL: &str =
    "https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json";
pub const SWPC_PLASMA_1_DAY_URL: &str =
    "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json";
pub const SWPC_PLASMA_7_DAY_URL: &str =
    "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json";

/// Near-real-time magnetic-field products.  The 2-hour product is the normal
/// cron input; longer products are useful for backfill or local diagnostics.
pub const SWPC_MAG_5_MINUTE_URL: &str =
    "https://services.swpc.noaa.gov/products/solar-wind/mag-5-minute.json";
pub const SWPC_MAG_2_HOUR_URL: &str =
    "https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json";
pub const SWPC_MAG_1_DAY_URL: &str =
    "https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json";
pub const SWPC_MAG_7_DAY_URL: &str =
    "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json";

/// Inline deterministic DSCOVR-like plasma fixture used by unit tests.
pub const DSCOVR_PLASMA_FIXTURE: &str = r#"
[
  ["time_tag", "density", "speed", "temperature"],
  ["2026-06-12 12:00:00.000", "5.42", "431.7", "95732"],
  ["2026-06-12 12:01:00.000", "5.31", "433.2", "96110"],
  ["2026-06-12 12:02:00.000", null, "432.8", "null"]
]
"#;

/// Inline deterministic DSCOVR-like GSM magnetic-field fixture used by tests.
pub const DSCOVR_MAG_FIXTURE: &str = r#"
[
  ["time_tag", "bx_gsm", "by_gsm", "bz_gsm", "lon_gsm", "lat_gsm", "bt"],
  ["2026-06-12 12:00:00.000", "-1.1", "3.7", "-6.4", "106.1", "-58.8", "7.5"],
  ["2026-06-12 12:01:00.000", "-1.0", "3.8", "-7.2", "104.9", "-61.0", "8.1"],
  ["2026-06-12 12:02:00.000", "-0.8", "3.6", null, "102.0", "", "7.2"]
]
"#;

/// Inline deterministic ACE-like plasma fixture.  SWPC's solar-wind products
/// auto-switch spacecraft but keep the same row shape; source is supplied by the
/// caller from the feed context/status page rather than inferred from the row.
pub const ACE_PLASMA_FIXTURE: &str = r#"
[
  ["time_tag", "density", "speed", "temperature"],
  ["2026-06-12 13:00:00", "2.10", "512.4", "151000"],
  ["2026-06-12 13:01:00", "2.05", "513.9", "152300"]
]
"#;

/// Inline deterministic ACE-like magnetic-field fixture.
pub const ACE_MAG_FIXTURE: &str = r#"
[
  ["time_tag", "bx_gsm", "by_gsm", "bz_gsm", "bt"],
  ["2026-06-12 13:00:00", "0.5", "-4.1", "2.3", "4.8"],
  ["2026-06-12 13:01:00", "0.7", "-4.0", "1.8", "4.6"]
]
"#;

/// SWPC L1 product flavor for fetch planning.  No function in this module
/// performs network I/O; the Worker boundary can fetch these URLs and pass body
/// strings into the parsers below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwpcL1Product {
    Plasma5Minute,
    Plasma2Hour,
    Plasma1Day,
    Plasma7Day,
    Mag5Minute,
    Mag2Hour,
    Mag1Day,
    Mag7Day,
}

impl SwpcL1Product {
    pub const fn url(self) -> &'static str {
        match self {
            Self::Plasma5Minute => SWPC_PLASMA_5_MINUTE_URL,
            Self::Plasma2Hour => SWPC_PLASMA_2_HOUR_URL,
            Self::Plasma1Day => SWPC_PLASMA_1_DAY_URL,
            Self::Plasma7Day => SWPC_PLASMA_7_DAY_URL,
            Self::Mag5Minute => SWPC_MAG_5_MINUTE_URL,
            Self::Mag2Hour => SWPC_MAG_2_HOUR_URL,
            Self::Mag1Day => SWPC_MAG_1_DAY_URL,
            Self::Mag7Day => SWPC_MAG_7_DAY_URL,
        }
    }
}

/// A network-free fetch boundary descriptor for the normal L1 cron poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwpcFetchRequest {
    pub product: SwpcL1Product,
    pub url: &'static str,
}

/// Normal cron plan: fetch plasma and mag 2-hour products, then parse fixtures or
/// live response bodies with `parse_l1_samples`.
pub const fn two_hour_fetch_plan() -> [SwpcFetchRequest; 2] {
    [
        SwpcFetchRequest {
            product: SwpcL1Product::Plasma2Hour,
            url: SWPC_PLASMA_2_HOUR_URL,
        },
        SwpcFetchRequest {
            product: SwpcL1Product::Mag2Hour,
            url: SWPC_MAG_2_HOUR_URL,
        },
    ]
}

/// Source spacecraft/feed for a parsed record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum L1Source {
    Dscovr,
    Ace,
    Solar1,
    Imap,
    SwpcAuto,
}

impl L1Source {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Dscovr => "DSCOVR",
            Self::Ace => "ACE",
            Self::Solar1 => "SOLAR-1",
            Self::Imap => "IMAP",
            Self::SwpcAuto => "SWPC_AUTO",
        }
    }
}

/// Parser/measurement quality flags retained with each typed sample.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum L1QualityFlag {
    MissingSpeed,
    MissingDensity,
    MissingTemperature,
    MissingBt,
    MissingBx,
    MissingBy,
    MissingBz,
    MismatchedObservationTimes,
    FutureObservedAt,
}

/// Typed plasma row from SWPC.
#[derive(Debug, Clone, PartialEq)]
pub struct PlasmaRecord {
    /// Measurement timestamp from SWPC's `time_tag` column.
    pub observed_at: DateTime<Utc>,
    /// Append/archive timestamp supplied by the caller.  This is the only clock
    /// that should be used for append-only storage keys or hindcast as-of cuts.
    pub as_of: DateTime<Utc>,
    pub source: L1Source,
    pub speed_kms: Option<f64>,
    pub density_pcc: Option<f64>,
    pub temperature_k: Option<f64>,
    pub quality_flags: Vec<L1QualityFlag>,
}

/// Typed GSM magnetic-field row from SWPC.
#[derive(Debug, Clone, PartialEq)]
pub struct MagRecord {
    /// Measurement timestamp from SWPC's `time_tag` column.
    pub observed_at: DateTime<Utc>,
    /// Append/archive timestamp supplied by the caller.
    pub as_of: DateTime<Utc>,
    pub source: L1Source,
    pub bt_nt: Option<f64>,
    pub bx_gsm_nt: Option<f64>,
    pub by_gsm_nt: Option<f64>,
    pub bz_gsm_nt: Option<f64>,
    pub quality_flags: Vec<L1QualityFlag>,
}

/// Combined L1 plasma + magnetic-field sample suitable for snapshot assembly.
#[derive(Debug, Clone, PartialEq)]
pub struct L1Sample {
    /// Primary measurement timestamp.  If plasma and mag rows differ slightly,
    /// this is the newer of the two while component timestamps below preserve the
    /// exact source times.
    pub observed_at: DateTime<Utc>,
    /// Append/archive timestamp supplied by the caller.
    pub as_of: DateTime<Utc>,
    pub source: L1Source,
    pub plasma_observed_at: DateTime<Utc>,
    pub mag_observed_at: Option<DateTime<Utc>>,
    pub speed_kms: Option<f64>,
    pub density_pcc: Option<f64>,
    pub temperature_k: Option<f64>,
    pub bt_nt: Option<f64>,
    pub bx_gsm_nt: Option<f64>,
    pub by_gsm_nt: Option<f64>,
    pub bz_gsm_nt: Option<f64>,
    pub quality_flags: Vec<L1QualityFlag>,
}

/// Errors that make a feed body unusable.  Missing individual scalar values are
/// represented as `None` plus quality flags instead of parse failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwpcL1Error {
    Json(String),
    EmptyFeed,
    BadShape(&'static str),
    MissingTimeColumn,
    BadTimestamp(String),
}

impl fmt::Display for SwpcL1Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(err) => write!(f, "invalid SWPC L1 JSON: {err}"),
            Self::EmptyFeed => write!(f, "empty SWPC L1 feed"),
            Self::BadShape(msg) => write!(f, "unexpected SWPC L1 JSON shape: {msg}"),
            Self::MissingTimeColumn => write!(f, "SWPC L1 feed is missing a time_tag column"),
            Self::BadTimestamp(ts) => write!(f, "invalid SWPC L1 timestamp: {ts}"),
        }
    }
}

impl std::error::Error for SwpcL1Error {}

/// Parse a SWPC plasma JSON body into typed rows.
pub fn parse_plasma_records(
    body: &str,
    source: L1Source,
    as_of: DateTime<Utc>,
) -> Result<Vec<PlasmaRecord>, SwpcL1Error> {
    let rows = parse_rows(body)?;
    rows.into_iter()
        .map(|row| {
            let observed_at = parse_swpc_timestamp(row.required_string(TIME_ALIASES)?)?;
            let speed_kms = row.optional_number(SPEED_ALIASES);
            let density_pcc = row.optional_number(DENSITY_ALIASES);
            let temperature_k = row.optional_number(TEMPERATURE_ALIASES);
            let mut quality_flags = Vec::new();
            push_missing(&mut quality_flags, speed_kms, L1QualityFlag::MissingSpeed);
            push_missing(
                &mut quality_flags,
                density_pcc,
                L1QualityFlag::MissingDensity,
            );
            push_missing(
                &mut quality_flags,
                temperature_k,
                L1QualityFlag::MissingTemperature,
            );
            push_future(&mut quality_flags, observed_at, as_of);
            Ok(PlasmaRecord {
                observed_at,
                as_of,
                source,
                speed_kms,
                density_pcc,
                temperature_k,
                quality_flags,
            })
        })
        .collect()
}

/// Parse a SWPC GSM magnetic-field JSON body into typed rows.
pub fn parse_mag_records(
    body: &str,
    source: L1Source,
    as_of: DateTime<Utc>,
) -> Result<Vec<MagRecord>, SwpcL1Error> {
    let rows = parse_rows(body)?;
    rows.into_iter()
        .map(|row| {
            let observed_at = parse_swpc_timestamp(row.required_string(TIME_ALIASES)?)?;
            let bt_nt = row.optional_number(BT_ALIASES);
            let bx_gsm_nt = row.optional_number(BX_GSM_ALIASES);
            let by_gsm_nt = row.optional_number(BY_GSM_ALIASES);
            let bz_gsm_nt = row.optional_number(BZ_GSM_ALIASES);
            let mut quality_flags = Vec::new();
            push_missing(&mut quality_flags, bt_nt, L1QualityFlag::MissingBt);
            push_missing(&mut quality_flags, bx_gsm_nt, L1QualityFlag::MissingBx);
            push_missing(&mut quality_flags, by_gsm_nt, L1QualityFlag::MissingBy);
            push_missing(&mut quality_flags, bz_gsm_nt, L1QualityFlag::MissingBz);
            push_future(&mut quality_flags, observed_at, as_of);
            Ok(MagRecord {
                observed_at,
                as_of,
                source,
                bt_nt,
                bx_gsm_nt,
                by_gsm_nt,
                bz_gsm_nt,
                quality_flags,
            })
        })
        .collect()
}

/// Parse and merge SWPC plasma + magnetic-field bodies.  Rows are matched by
/// exact timestamp when possible, otherwise by nearest mag timestamp within
/// `max_skew`.  Plasma rows define the output cadence because speed is required
/// for the L1→Earth delay correction.
pub fn parse_l1_samples(
    plasma_body: &str,
    mag_body: &str,
    source: L1Source,
    as_of: DateTime<Utc>,
    max_skew: TimeDelta,
) -> Result<Vec<L1Sample>, SwpcL1Error> {
    let plasma = parse_plasma_records(plasma_body, source, as_of)?;
    let mag = parse_mag_records(mag_body, source, as_of)?;
    Ok(merge_l1_records(&plasma, &mag, max_skew))
}

/// Merge already-parsed plasma/mag rows into combined L1 samples.
pub fn merge_l1_records(
    plasma: &[PlasmaRecord],
    mag: &[MagRecord],
    max_skew: TimeDelta,
) -> Vec<L1Sample> {
    plasma
        .iter()
        .map(|p| {
            let matched_mag = nearest_mag(p.observed_at, mag, max_skew);
            let mut quality_flags = p.quality_flags.clone();
            let (mag_observed_at, bt_nt, bx_gsm_nt, by_gsm_nt, bz_gsm_nt, observed_at) =
                if let Some(m) = matched_mag {
                    quality_flags.extend(m.quality_flags.iter().cloned());
                    if m.observed_at != p.observed_at {
                        quality_flags.push(L1QualityFlag::MismatchedObservationTimes);
                    }
                    (
                        Some(m.observed_at),
                        m.bt_nt,
                        m.bx_gsm_nt,
                        m.by_gsm_nt,
                        m.bz_gsm_nt,
                        if m.observed_at > p.observed_at {
                            m.observed_at
                        } else {
                            p.observed_at
                        },
                    )
                } else {
                    quality_flags.push(L1QualityFlag::MissingBt);
                    quality_flags.push(L1QualityFlag::MissingBx);
                    quality_flags.push(L1QualityFlag::MissingBy);
                    quality_flags.push(L1QualityFlag::MissingBz);
                    (None, None, None, None, None, p.observed_at)
                };

            dedup_flags(&mut quality_flags);

            L1Sample {
                observed_at,
                as_of: p.as_of,
                source: p.source,
                plasma_observed_at: p.observed_at,
                mag_observed_at,
                speed_kms: p.speed_kms,
                density_pcc: p.density_pcc,
                temperature_k: p.temperature_k,
                bt_nt,
                bx_gsm_nt,
                by_gsm_nt,
                bz_gsm_nt,
                quality_flags,
            }
        })
        .collect()
}

/// Return the newest combined sample by measurement time.
pub fn latest_l1_sample(samples: &[L1Sample]) -> Option<&L1Sample> {
    samples.iter().max_by_key(|sample| sample.observed_at)
}

const TIME_ALIASES: &[&str] = &["time_tag", "time", "timestamp", "observed_at"];
const SPEED_ALIASES: &[&str] = &["speed", "speed_kms", "bulk_speed", "proton_speed"];
const DENSITY_ALIASES: &[&str] = &["density", "density_pcc", "proton_density"];
const TEMPERATURE_ALIASES: &[&str] = &["temperature", "temperature_k", "temp"];
const BT_ALIASES: &[&str] = &["bt", "bt_nt", "b_total", "btotal"];
const BX_GSM_ALIASES: &[&str] = &["bx_gsm", "bx_gsm_nt"];
const BY_GSM_ALIASES: &[&str] = &["by_gsm", "by_gsm_nt"];
const BZ_GSM_ALIASES: &[&str] = &["bz_gsm", "bz_gsm_nt", "bz"];

#[derive(Debug, Clone)]
struct ParsedRow {
    fields: Vec<(String, Value)>,
}

impl ParsedRow {
    fn required_string(&self, aliases: &[&str]) -> Result<&str, SwpcL1Error> {
        self.get(aliases)
            .and_then(value_as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or(SwpcL1Error::MissingTimeColumn)
    }

    fn optional_number(&self, aliases: &[&str]) -> Option<f64> {
        self.get(aliases).and_then(value_as_f64)
    }

    fn get(&self, aliases: &[&str]) -> Option<&Value> {
        self.fields
            .iter()
            .find(|(name, _)| aliases.iter().any(|alias| name == &normalize_key(alias)))
            .map(|(_, value)| value)
    }
}

fn parse_rows(body: &str) -> Result<Vec<ParsedRow>, SwpcL1Error> {
    let value: Value =
        serde_json::from_str(body).map_err(|err| SwpcL1Error::Json(err.to_string()))?;
    let rows = value
        .as_array()
        .ok_or(SwpcL1Error::BadShape("expected top-level array"))?;
    if rows.is_empty() {
        return Err(SwpcL1Error::EmptyFeed);
    }

    if rows[0].is_object() {
        return rows
            .iter()
            .map(|row| {
                row.as_object()
                    .map(row_from_object)
                    .ok_or(SwpcL1Error::BadShape("mixed object/non-object rows"))
            })
            .collect();
    }

    let header_values = rows[0]
        .as_array()
        .ok_or(SwpcL1Error::BadShape("expected header row array"))?;
    let header = header_values
        .iter()
        .map(|value| value_as_str(value).map(normalize_key))
        .collect::<Option<Vec<_>>>()
        .ok_or(SwpcL1Error::BadShape("header row must contain strings"))?;

    let has_time = header.iter().any(|name| {
        TIME_ALIASES
            .iter()
            .any(|alias| name == &normalize_key(alias))
    });
    if !has_time {
        return Err(SwpcL1Error::MissingTimeColumn);
    }

    rows.iter()
        .skip(1)
        .map(|row| {
            let values = row
                .as_array()
                .ok_or(SwpcL1Error::BadShape("data row must be an array"))?;
            let fields = header
                .iter()
                .enumerate()
                .map(|(idx, name)| {
                    (
                        name.clone(),
                        values.get(idx).cloned().unwrap_or(Value::Null),
                    )
                })
                .collect();
            Ok(ParsedRow { fields })
        })
        .collect()
}

fn row_from_object(object: &Map<String, Value>) -> ParsedRow {
    ParsedRow {
        fields: object
            .iter()
            .map(|(key, value)| (normalize_key(key), value.clone()))
            .collect(),
    }
}

fn parse_swpc_timestamp(raw: &str) -> Result<DateTime<Utc>, SwpcL1Error> {
    let trimmed = raw.trim();
    if let Ok(parsed) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(parsed.with_timezone(&Utc));
    }

    const FORMATS: &[&str] = &[
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
    ];
    for format in FORMATS {
        if let Ok(parsed) = NaiveDateTime::parse_from_str(trimmed, format) {
            return Ok(DateTime::from_naive_utc_and_offset(parsed, Utc));
        }
    }

    Err(SwpcL1Error::BadTimestamp(raw.to_string()))
}

fn value_as_str(value: &Value) -> Option<&str> {
    match value {
        Value::String(s) => Some(s.as_str()),
        _ => None,
    }
}

fn value_as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64().filter(|number| number.is_finite()),
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty()
                || trimmed.eq_ignore_ascii_case("null")
                || trimmed.eq_ignore_ascii_case("nan")
            {
                None
            } else {
                trimmed
                    .parse::<f64>()
                    .ok()
                    .filter(|number| number.is_finite())
            }
        }
        _ => None,
    }
}

fn normalize_key(key: &str) -> String {
    key.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

fn push_missing(flags: &mut Vec<L1QualityFlag>, value: Option<f64>, flag: L1QualityFlag) {
    if value.is_none() {
        flags.push(flag);
    }
}

fn push_future(flags: &mut Vec<L1QualityFlag>, observed_at: DateTime<Utc>, as_of: DateTime<Utc>) {
    if observed_at > as_of + TimeDelta::minutes(5) {
        flags.push(L1QualityFlag::FutureObservedAt);
    }
}

fn nearest_mag(
    observed_at: DateTime<Utc>,
    mag: &[MagRecord],
    max_skew: TimeDelta,
) -> Option<&MagRecord> {
    mag.iter()
        .filter_map(|record| {
            let skew = (record.observed_at - observed_at).abs();
            if skew <= max_skew {
                Some((skew, record))
            } else {
                None
            }
        })
        .min_by_key(|(skew, _)| *skew)
        .map(|(_, record)| record)
}

fn dedup_flags(flags: &mut Vec<L1QualityFlag>) {
    let mut deduped = Vec::with_capacity(flags.len());
    for flag in flags.drain(..) {
        if !deduped.contains(&flag) {
            deduped.push(flag);
        }
    }
    *flags = deduped;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn as_of() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-06-12T12:05:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn swpc_l1_parses_dscovr_plasma_rows_with_quality_flags() {
        let rows = parse_plasma_records(DSCOVR_PLASMA_FIXTURE, L1Source::Dscovr, as_of()).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].source.as_str(), "DSCOVR");
        assert_eq!(rows[0].speed_kms, Some(431.7));
        assert_eq!(rows[0].density_pcc, Some(5.42));
        assert_eq!(rows[0].temperature_k, Some(95_732.0));
        assert_eq!(
            rows[0].observed_at.to_rfc3339(),
            "2026-06-12T12:00:00+00:00"
        );
        assert_eq!(rows[0].as_of, as_of());
        assert!(rows[0].quality_flags.is_empty());

        assert_eq!(rows[2].speed_kms, Some(432.8));
        assert!(rows[2]
            .quality_flags
            .contains(&L1QualityFlag::MissingDensity));
        assert!(rows[2]
            .quality_flags
            .contains(&L1QualityFlag::MissingTemperature));
    }

    #[test]
    fn swpc_l1_parses_dscovr_mag_rows_and_bz_gsm() {
        let rows = parse_mag_records(DSCOVR_MAG_FIXTURE, L1Source::Dscovr, as_of()).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].bt_nt, Some(7.5));
        assert_eq!(rows[0].bx_gsm_nt, Some(-1.1));
        assert_eq!(rows[0].by_gsm_nt, Some(3.7));
        assert_eq!(rows[0].bz_gsm_nt, Some(-6.4));
        assert!(rows[0].quality_flags.is_empty());

        assert!(rows[2].quality_flags.contains(&L1QualityFlag::MissingBz));
    }

    #[test]
    fn swpc_l1_merges_plasma_and_mag_samples_append_only_as_of() {
        let samples = parse_l1_samples(
            DSCOVR_PLASMA_FIXTURE,
            DSCOVR_MAG_FIXTURE,
            L1Source::Dscovr,
            as_of(),
            TimeDelta::seconds(90),
        )
        .unwrap();

        assert_eq!(samples.len(), 3);
        let first = &samples[0];
        assert_eq!(first.source, L1Source::Dscovr);
        assert_eq!(first.speed_kms, Some(431.7));
        assert_eq!(first.density_pcc, Some(5.42));
        assert_eq!(first.temperature_k, Some(95_732.0));
        assert_eq!(first.bz_gsm_nt, Some(-6.4));
        assert_eq!(first.observed_at, first.plasma_observed_at);
        assert_eq!(first.mag_observed_at, Some(first.plasma_observed_at));
        assert_eq!(first.as_of, as_of());
        assert!(first.quality_flags.is_empty());

        let latest = latest_l1_sample(&samples).unwrap();
        assert_eq!(latest.speed_kms, Some(432.8));
        assert!(latest
            .quality_flags
            .contains(&L1QualityFlag::MissingDensity));
        assert!(latest.quality_flags.contains(&L1QualityFlag::MissingBz));
    }

    #[test]
    fn swpc_l1_parses_ace_rows_with_same_swpc_shape() {
        let as_of = DateTime::parse_from_rfc3339("2026-06-12T13:05:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let samples = parse_l1_samples(
            ACE_PLASMA_FIXTURE,
            ACE_MAG_FIXTURE,
            L1Source::Ace,
            as_of,
            TimeDelta::seconds(30),
        )
        .unwrap();

        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].source.as_str(), "ACE");
        assert_eq!(samples[0].speed_kms, Some(512.4));
        assert_eq!(samples[0].density_pcc, Some(2.10));
        assert_eq!(samples[0].temperature_k, Some(151_000.0));
        assert_eq!(samples[0].bz_gsm_nt, Some(2.3));
        assert_eq!(samples[0].as_of, as_of);
    }

    #[test]
    fn swpc_l1_supports_object_rows_at_fetch_boundary() {
        let object_fixture = r#"
        [
          {"time_tag":"2026-06-12T14:00:00Z","density":"4.0","speed":"410.5","temperature":"88000"},
          {"time_tag":"2026-06-12T14:01:00Z","density":4.2,"speed":411.0,"temperature":88100}
        ]
        "#;
        let as_of = DateTime::parse_from_rfc3339("2026-06-12T14:05:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let rows = parse_plasma_records(object_fixture, L1Source::SwpcAuto, as_of).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].speed_kms, Some(410.5));
        assert_eq!(rows[1].density_pcc, Some(4.2));
    }

    #[test]
    fn swpc_l1_marks_mismatched_nearest_mag_timestamp() {
        let plasma = parse_plasma_records(ACE_PLASMA_FIXTURE, L1Source::Ace, as_of()).unwrap();
        let shifted_mag_fixture = r#"
        [
          ["time_tag", "bx_gsm", "by_gsm", "bz_gsm", "bt"],
          ["2026-06-12 13:00:20", "0.5", "-4.1", "2.3", "4.8"]
        ]
        "#;
        let mag = parse_mag_records(shifted_mag_fixture, L1Source::Ace, as_of()).unwrap();
        let samples = merge_l1_records(&plasma, &mag, TimeDelta::seconds(25));
        assert_eq!(samples[0].bz_gsm_nt, Some(2.3));
        assert!(samples[0]
            .quality_flags
            .contains(&L1QualityFlag::MismatchedObservationTimes));
        assert!(samples[1].bz_gsm_nt.is_none());
        assert!(samples[1].quality_flags.contains(&L1QualityFlag::MissingBz));
    }

    #[test]
    fn swpc_l1_fetch_plan_is_url_only_and_network_free() {
        let plan = two_hour_fetch_plan();
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].product, SwpcL1Product::Plasma2Hour);
        assert_eq!(plan[0].url, SwpcL1Product::Plasma2Hour.url());
        assert_eq!(plan[1].product, SwpcL1Product::Mag2Hour);
        assert_eq!(plan[1].url, SWPC_MAG_2_HOUR_URL);
        assert!(plan
            .iter()
            .all(|request| request.url.starts_with(SWPC_BASE_URL)));
    }
}
