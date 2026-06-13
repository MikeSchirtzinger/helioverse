//! W1-P1c: OVATION feed adapter
//! Owner: GPT builder (openai-codex/gpt-5.5) / DeepSeek validator
//!
//! Fixture-first adapter for NOAA SWPC's OVATION Prime JSON feed.
//!
//! The feed's `coordinates` array is a 360×181 grid of `[lon, lat, probability_pct]`
//! triples. This module intentionally reduces that grid to small metadata suitable for
//! the combined snapshot; the full grid is written separately to R2 at
//! `v1/ovation/latest.json` / `v1/ovation/archive/YYYY/MM/DD/HH00.json` per
//! `contracts/r2-layout.md`.

use chrono::{DateTime, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fmt;

pub const SWPC_OVATION_LATEST_URL: &str =
    "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
pub const OVATION_LATEST_R2_KEY: &str = "v1/ovation/latest.json";
pub const EXPECTED_FULL_GRID_POINTS: usize = 360 * 181;

/// Snapshot-compatible OVATION metadata pointer.
///
/// This mirrors `snapshot.schema.json#/properties/ovation`: it contains only
/// timestamps and the R2 key for the full grid, never the grid itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapshotOvationPointer {
    pub observation_time: String,
    pub forecast_time: String,
    pub grid_r2_key: String,
    pub hemispheric_power_gw: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OvationSummary {
    /// SWPC `Observation Time` normalized to ISO-8601 UTC.
    pub observed_at: String,
    /// Ingest/snapshot as-of time normalized to ISO-8601 UTC.
    pub as_of: String,
    /// OVATION model clock. Prefer an explicit model-run stamp when present;
    /// otherwise fall back to SWPC `Forecast Time` (the stock valid time).
    pub model_run_at: String,
    /// SWPC `Forecast Time` normalized to ISO-8601 UTC.
    pub forecast_time: String,
    /// Small north/south summaries derived from the grid.
    pub hemispheres: Vec<HemisphereSummary>,
    pub max_probability_pct: f64,
    /// Pointer to the R2 object containing the full grid.
    pub grid_r2_key: String,
    /// Hourly archive key that the writer should use for immutable grid snapshots.
    pub archive_grid_r2_key: String,
    pub source: SourceSummary,
    pub quality: GridQuality,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HemisphereSummary {
    pub hemisphere: Hemisphere,
    pub point_count: usize,
    pub nonzero_point_count: usize,
    pub min_lat_deg: f64,
    pub max_lat_deg: f64,
    pub max_probability_pct: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Hemisphere {
    North,
    South,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceSummary {
    pub name: String,
    pub url: String,
    pub status: SourceStatus,
    pub last_success_at: String,
    pub age_s: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceStatus {
    Ok,
    Stale,
    Gap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridQuality {
    pub status: SourceStatus,
    pub grid_point_count: usize,
    pub expected_full_grid_points: usize,
    pub unique_longitudes: usize,
    pub unique_latitudes: usize,
    pub is_full_360x181_grid: bool,
    pub data_format: Option<String>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OvationError {
    InvalidJson(String),
    MissingField(&'static str),
    InvalidTimestamp { field: &'static str, value: String },
    InvalidGridKey(String),
    MissingCoordinates,
    InvalidCoordinate { index: usize, reason: String },
}

impl fmt::Display for OvationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson(err) => write!(f, "invalid OVATION JSON: {err}"),
            Self::MissingField(field) => write!(f, "missing OVATION field `{field}`"),
            Self::InvalidTimestamp { field, value } => {
                write!(f, "invalid timestamp in `{field}`: {value}")
            }
            Self::InvalidGridKey(key) => write!(f, "invalid OVATION R2 grid key: {key}"),
            Self::MissingCoordinates => write!(f, "missing OVATION coordinates grid"),
            Self::InvalidCoordinate { index, reason } => {
                write!(f, "invalid OVATION coordinate at index {index}: {reason}")
            }
        }
    }
}

impl std::error::Error for OvationError {}

/// Parse SWPC OVATION JSON into a small typed summary and R2 pointer metadata.
///
/// `as_of` must be provided by the caller so fixture tests and append-only snapshot
/// writes are deterministic. `grid_r2_key` is normally `v1/ovation/latest.json`.
pub fn parse_ovation_json(
    json: &str,
    as_of: &str,
    grid_r2_key: &str,
) -> Result<OvationSummary, OvationError> {
    if !is_valid_ovation_grid_key(grid_r2_key) {
        return Err(OvationError::InvalidGridKey(grid_r2_key.to_string()));
    }

    let value: Value =
        serde_json::from_str(json).map_err(|err| OvationError::InvalidJson(err.to_string()))?;

    let observed_raw = find_string_field(
        &value,
        &[
            "Observation Time",
            "observation_time",
            "observed_at",
            "ObservationTime",
        ],
    )
    .ok_or(OvationError::MissingField("Observation Time"))?;
    let forecast_raw = find_string_field(
        &value,
        &[
            "Forecast Time",
            "forecast_time",
            "forecast_at",
            "ForecastTime",
        ],
    )
    .ok_or(OvationError::MissingField("Forecast Time"))?;
    let model_run_raw = find_string_field(
        &value,
        &[
            "Model Run Time",
            "model_run_time",
            "model_run_at",
            "Run Time",
            "run_time",
        ],
    );

    let observed_at = normalize_utc(&observed_raw, "Observation Time")?;
    let forecast_time = normalize_utc(&forecast_raw, "Forecast Time")?;
    let model_run_at = match model_run_raw {
        Some(raw) => normalize_utc(&raw, "Model Run Time")?,
        None => forecast_time.clone(),
    };
    let as_of = normalize_utc(as_of, "as_of")?;

    let coordinates = find_coordinates_array(&value).ok_or(OvationError::MissingCoordinates)?;
    if coordinates.is_empty() {
        return Err(OvationError::MissingCoordinates);
    }

    let data_format = find_string_field(&value, &["Data Format", "data_format", "format"]);

    let mut north = HemisphereAccumulator::new(Hemisphere::North);
    let mut south = HemisphereAccumulator::new(Hemisphere::South);
    let mut max_probability_pct = 0.0_f64;
    let mut longitudes = BTreeSet::new();
    let mut latitudes = BTreeSet::new();

    for (index, coordinate) in coordinates.iter().enumerate() {
        let (lon, lat, probability_pct) = parse_coordinate(coordinate, index)?;
        if !(-180.0..=360.0).contains(&lon) {
            return Err(OvationError::InvalidCoordinate {
                index,
                reason: format!("longitude {lon} outside [-180, 360]"),
            });
        }
        if !(-90.0..=90.0).contains(&lat) {
            return Err(OvationError::InvalidCoordinate {
                index,
                reason: format!("latitude {lat} outside [-90, 90]"),
            });
        }
        if !(0.0..=100.0).contains(&probability_pct) {
            return Err(OvationError::InvalidCoordinate {
                index,
                reason: format!("probability {probability_pct} outside [0, 100]"),
            });
        }

        max_probability_pct = max_probability_pct.max(probability_pct);
        longitudes.insert(lon.round() as i32);
        latitudes.insert(lat.round() as i32);

        if lat >= 0.0 {
            north.add(lat, probability_pct);
        } else {
            south.add(lat, probability_pct);
        }
    }

    let mut hemispheres = Vec::new();
    if north.point_count > 0 {
        hemispheres.push(north.finish());
    }
    if south.point_count > 0 {
        hemispheres.push(south.finish());
    }

    let observed_dt = parse_normalized_utc(&observed_at, "Observation Time")?;
    let as_of_dt = parse_normalized_utc(&as_of, "as_of")?;
    let age_s = nonnegative_age_s(as_of_dt, observed_dt);
    let status = status_from_age_s(age_s);
    let is_full_grid = coordinates.len() == EXPECTED_FULL_GRID_POINTS
        && longitudes.len() == 360
        && latitudes.len() == 181;

    let mut issues = Vec::new();
    if hemispheres.len() != 2 {
        issues.push("grid does not contain both hemispheres".to_string());
    }
    if coordinates.len() != longitudes.len() * latitudes.len() {
        issues.push("grid point count does not match longitude×latitude cardinality".to_string());
    }
    if !is_full_grid {
        issues.push(format!(
            "not a full 360x181 grid ({} points, {} longitudes, {} latitudes)",
            coordinates.len(),
            longitudes.len(),
            latitudes.len()
        ));
    }

    Ok(OvationSummary {
        observed_at: observed_at.clone(),
        as_of,
        model_run_at: model_run_at.clone(),
        forecast_time: forecast_time.clone(),
        hemispheres,
        max_probability_pct,
        grid_r2_key: grid_r2_key.to_string(),
        archive_grid_r2_key: ovation_archive_key(&model_run_at)?,
        source: SourceSummary {
            name: "NOAA SWPC OVATION Prime".to_string(),
            url: SWPC_OVATION_LATEST_URL.to_string(),
            status,
            last_success_at: observed_at,
            age_s,
        },
        quality: GridQuality {
            status,
            grid_point_count: coordinates.len(),
            expected_full_grid_points: EXPECTED_FULL_GRID_POINTS,
            unique_longitudes: longitudes.len(),
            unique_latitudes: latitudes.len(),
            is_full_360x181_grid: is_full_grid,
            data_format,
            issues,
        },
    })
}

/// Parse using the standard latest-grid R2 key.
pub fn parse_latest_ovation_json(json: &str, as_of: &str) -> Result<OvationSummary, OvationError> {
    parse_ovation_json(json, as_of, OVATION_LATEST_R2_KEY)
}

impl OvationSummary {
    /// Return the exact fragment expected inside the combined snapshot.
    pub fn snapshot_pointer(&self) -> SnapshotOvationPointer {
        SnapshotOvationPointer {
            observation_time: self.observed_at.clone(),
            forecast_time: self.forecast_time.clone(),
            grid_r2_key: self.grid_r2_key.clone(),
            hemispheric_power_gw: None,
        }
    }
}

/// R2 key for the hourly immutable OVATION archive object.
pub fn ovation_archive_key(model_run_at: &str) -> Result<String, OvationError> {
    let normalized = normalize_utc(model_run_at, "model_run_at")?;
    let dt = parse_normalized_utc(&normalized, "model_run_at")?;
    Ok(format!(
        "v1/ovation/archive/{}.json",
        dt.format("%Y/%m/%d/%H00")
    ))
}

pub fn is_valid_ovation_grid_key(key: &str) -> bool {
    if key == OVATION_LATEST_R2_KEY {
        return true;
    }

    let Some(rest) = key.strip_prefix("v1/ovation/archive/") else {
        return false;
    };
    let Some(stamp) = rest.strip_suffix(".json") else {
        return false;
    };
    let parts: Vec<&str> = stamp.split('/').collect();
    if parts.len() != 4 {
        return false;
    }
    if parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 || parts[3].len() != 4 {
        return false;
    }
    if !parts
        .iter()
        .all(|part| part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return false;
    }
    if !parts[3].ends_with("00") {
        return false;
    }

    let candidate = format!(
        "{}-{}-{}T{}:00:00Z",
        parts[0],
        parts[1],
        parts[2],
        &parts[3][0..2]
    );
    DateTime::parse_from_rfc3339(&candidate).is_ok()
}

fn normalize_utc(value: &str, field: &'static str) -> Result<String, OvationError> {
    let trimmed = value.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(dt
            .with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Secs, true));
    }

    let without_utc = trimmed
        .strip_suffix(" UTC")
        .or_else(|| trimmed.strip_suffix(" utc"))
        .unwrap_or(trimmed)
        .trim();

    for pattern in [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(without_utc, pattern) {
            let dt = Utc.from_utc_datetime(&naive);
            return Ok(dt.to_rfc3339_opts(SecondsFormat::Secs, true));
        }
    }

    Err(OvationError::InvalidTimestamp {
        field,
        value: value.to_string(),
    })
}

fn parse_normalized_utc(value: &str, field: &'static str) -> Result<DateTime<Utc>, OvationError> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| OvationError::InvalidTimestamp {
            field,
            value: value.to_string(),
        })
}

fn nonnegative_age_s(as_of: DateTime<Utc>, observed_at: DateTime<Utc>) -> u64 {
    as_of
        .signed_duration_since(observed_at)
        .num_seconds()
        .max(0) as u64
}

fn status_from_age_s(age_s: u64) -> SourceStatus {
    match age_s {
        0..=900 => SourceStatus::Ok,
        901..=3600 => SourceStatus::Stale,
        _ => SourceStatus::Gap,
    }
}

fn find_string_field(value: &Value, names: &[&str]) -> Option<String> {
    find_field(value, names).and_then(|field| match field {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    })
}

fn find_field<'a>(value: &'a Value, names: &[&str]) -> Option<&'a Value> {
    let Value::Object(map) = value else {
        return None;
    };

    for name in names {
        if let Some(field) = map.get(*name) {
            return Some(field);
        }
    }

    let normalized_names: Vec<String> = names.iter().map(|name| normalize_key(name)).collect();
    map.iter().find_map(|(key, field)| {
        let normalized_key = normalize_key(key);
        if normalized_names.iter().any(|name| name == &normalized_key) {
            Some(field)
        } else {
            None
        }
    })
}

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '_' && *ch != '-')
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn find_coordinates_array(value: &Value) -> Option<&Vec<Value>> {
    if let Value::Array(array) = value {
        return Some(array);
    }

    let field = find_field(
        value,
        &[
            "coordinates",
            "Coordinates",
            "coordinate_grid",
            "grid",
            "Grid",
            "aurora",
        ],
    )?;

    match field {
        Value::Array(array) => Some(array),
        Value::Object(_) => find_coordinates_array(field),
        _ => None,
    }
}

fn parse_coordinate(value: &Value, index: usize) -> Result<(f64, f64, f64), OvationError> {
    match value {
        Value::Array(items) if items.len() >= 3 => {
            let lon = value_as_f64(&items[0]).ok_or_else(|| OvationError::InvalidCoordinate {
                index,
                reason: "longitude is not numeric".to_string(),
            })?;
            let lat = value_as_f64(&items[1]).ok_or_else(|| OvationError::InvalidCoordinate {
                index,
                reason: "latitude is not numeric".to_string(),
            })?;
            let probability =
                value_as_f64(&items[2]).ok_or_else(|| OvationError::InvalidCoordinate {
                    index,
                    reason: "probability is not numeric".to_string(),
                })?;
            Ok((lon, lat, probability))
        }
        Value::Object(_) => {
            let lon =
                find_numeric_field(value, &["longitude", "lon", "Longitude"]).ok_or_else(|| {
                    OvationError::InvalidCoordinate {
                        index,
                        reason: "missing longitude".to_string(),
                    }
                })?;
            let lat =
                find_numeric_field(value, &["latitude", "lat", "Latitude"]).ok_or_else(|| {
                    OvationError::InvalidCoordinate {
                        index,
                        reason: "missing latitude".to_string(),
                    }
                })?;
            let probability = find_numeric_field(
                value,
                &["probability", "probability_pct", "aurora", "Aurora", "prob"],
            )
            .ok_or_else(|| OvationError::InvalidCoordinate {
                index,
                reason: "missing probability".to_string(),
            })?;
            Ok((lon, lat, probability))
        }
        _ => Err(OvationError::InvalidCoordinate {
            index,
            reason: "coordinate must be an array triple or object".to_string(),
        }),
    }
}

fn find_numeric_field(value: &Value, names: &[&str]) -> Option<f64> {
    find_field(value, names).and_then(value_as_f64)
}

fn value_as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|number| number.is_finite())
}

#[derive(Debug, Clone)]
struct HemisphereAccumulator {
    hemisphere: Hemisphere,
    point_count: usize,
    nonzero_point_count: usize,
    min_lat_deg: f64,
    max_lat_deg: f64,
    max_probability_pct: f64,
}

impl HemisphereAccumulator {
    fn new(hemisphere: Hemisphere) -> Self {
        Self {
            hemisphere,
            point_count: 0,
            nonzero_point_count: 0,
            min_lat_deg: f64::INFINITY,
            max_lat_deg: f64::NEG_INFINITY,
            max_probability_pct: 0.0,
        }
    }

    fn add(&mut self, lat: f64, probability_pct: f64) {
        self.point_count += 1;
        if probability_pct > 0.0 {
            self.nonzero_point_count += 1;
        }
        self.min_lat_deg = self.min_lat_deg.min(lat);
        self.max_lat_deg = self.max_lat_deg.max(lat);
        self.max_probability_pct = self.max_probability_pct.max(probability_pct);
    }

    fn finish(self) -> HemisphereSummary {
        HemisphereSummary {
            hemisphere: self.hemisphere,
            point_count: self.point_count,
            nonzero_point_count: self.nonzero_point_count,
            min_lat_deg: self.min_lat_deg,
            max_lat_deg: self.max_lat_deg,
            max_probability_pct: self.max_probability_pct,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPRESENTATIVE_OVATION_FIXTURE: &str = r#"
    {
      "Product": "OVATION Aurora Forecast",
      "Observation Time": "2026-06-12T08:00:00Z",
      "Forecast Time": "2026-06-12T08:30:00Z",
      "Model Run Time": "2026-06-12T08:05:00Z",
      "Data Format": "[Longitude, Latitude, Aurora]",
      "coordinates": [
        [0, 55, 12.5],
        [1, 55, 87.5],
        [0, 56, 22.0],
        [1, 56, 0.0],
        [0, -55, 3.0],
        [1, -55, 44.0],
        [0, -56, 0.0],
        [1, -56, 31.0]
      ]
    }
    "#;

    #[test]
    fn ovation_parse_fixture_summary_and_snapshot_pointer() {
        let summary =
            parse_latest_ovation_json(REPRESENTATIVE_OVATION_FIXTURE, "2026-06-12T08:06:00Z")
                .expect("fixture parses");

        assert_eq!(summary.observed_at, "2026-06-12T08:00:00Z");
        assert_eq!(summary.as_of, "2026-06-12T08:06:00Z");
        assert_eq!(summary.model_run_at, "2026-06-12T08:05:00Z");
        assert_eq!(summary.forecast_time, "2026-06-12T08:30:00Z");
        assert_eq!(summary.max_probability_pct, 87.5);
        assert_eq!(summary.grid_r2_key, OVATION_LATEST_R2_KEY);
        assert_eq!(
            summary.archive_grid_r2_key,
            "v1/ovation/archive/2026/06/12/0800.json"
        );
        assert_eq!(summary.source.status, SourceStatus::Ok);
        assert_eq!(summary.source.age_s, 360);
        assert_eq!(summary.quality.grid_point_count, 8);
        assert_eq!(summary.quality.unique_longitudes, 2);
        assert_eq!(summary.quality.unique_latitudes, 4);
        assert!(!summary.quality.is_full_360x181_grid);

        let north = summary
            .hemispheres
            .iter()
            .find(|hemisphere| hemisphere.hemisphere == Hemisphere::North)
            .expect("north hemisphere summary");
        assert_eq!(north.point_count, 4);
        assert_eq!(north.nonzero_point_count, 3);
        assert_eq!(north.max_probability_pct, 87.5);

        let south = summary
            .hemispheres
            .iter()
            .find(|hemisphere| hemisphere.hemisphere == Hemisphere::South)
            .expect("south hemisphere summary");
        assert_eq!(south.point_count, 4);
        assert_eq!(south.nonzero_point_count, 3);
        assert_eq!(south.max_probability_pct, 44.0);

        let pointer = summary.snapshot_pointer();
        assert_eq!(pointer.observation_time, "2026-06-12T08:00:00Z");
        assert_eq!(pointer.forecast_time, "2026-06-12T08:30:00Z");
        assert_eq!(pointer.grid_r2_key, OVATION_LATEST_R2_KEY);
        assert_eq!(pointer.hemispheric_power_gw, None);

        let serialized = serde_json::to_string(&summary).expect("summary serializes");
        assert!(!serialized.contains("coordinates"));
        assert!(!serialized.contains("[0,55,12.5]"));
    }

    #[test]
    fn ovation_accepts_object_coordinates_and_timestamp_variants() {
        let fixture = r#"
        {
          "observation_time": "2026-06-12 08:00:00 UTC",
          "forecast_time": "2026-06-12 08:30:00 UTC",
          "grid": {
            "coordinates": [
              {"lon": "10", "lat": "64", "probability_pct": "8.5"},
              {"lon": "10", "lat": "-64", "probability_pct": "18.5"}
            ]
          }
        }
        "#;

        let summary = parse_ovation_json(
            fixture,
            "2026-06-12T09:00:01Z",
            "v1/ovation/archive/2026/06/12/0800.json",
        )
        .expect("object-coordinate fixture parses");

        assert_eq!(summary.observed_at, "2026-06-12T08:00:00Z");
        assert_eq!(summary.model_run_at, "2026-06-12T08:30:00Z");
        assert_eq!(summary.max_probability_pct, 18.5);
        assert_eq!(summary.source.status, SourceStatus::Gap);
        assert_eq!(summary.quality.status, SourceStatus::Gap);
        assert_eq!(summary.hemispheres.len(), 2);
    }

    #[test]
    fn ovation_rejects_non_r2_layout_grid_keys() {
        let err = parse_ovation_json(
            REPRESENTATIVE_OVATION_FIXTURE,
            "2026-06-12T08:06:00Z",
            "ovation/latest.json",
        )
        .expect_err("bad key is rejected");

        assert!(matches!(err, OvationError::InvalidGridKey(_)));
        assert!(is_valid_ovation_grid_key("v1/ovation/latest.json"));
        assert!(is_valid_ovation_grid_key(
            "v1/ovation/archive/2026/06/12/0800.json"
        ));
        assert!(!is_valid_ovation_grid_key(
            "v1/ovation/archive/2026/06/12/0830.json"
        ));
    }

    #[test]
    fn ovation_rejects_invalid_probability() {
        let fixture = r#"
        {
          "Observation Time": "2026-06-12T08:00:00Z",
          "Forecast Time": "2026-06-12T08:30:00Z",
          "coordinates": [[0, 60, 101]]
        }
        "#;

        let err = parse_latest_ovation_json(fixture, "2026-06-12T08:01:00Z")
            .expect_err("probability >100 is rejected");
        assert!(matches!(err, OvationError::InvalidCoordinate { .. }));
    }
}
