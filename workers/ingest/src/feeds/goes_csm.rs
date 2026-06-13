//! W1-P1e: GOES ABI Clear Sky Mask Tier-0 point-answer boundary.
//!
//! This module intentionally stops at the spec §4.1 raster boundary:
//! it accepts only precomputed scalar point samples (or scalar forecast fallback
//! metadata) and returns a scalar answer for one lat/lon/time. It does **not**
//! expose any API for NetCDF/GRIB/raster/tile/pixel decoding in the Worker.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::fmt;

/// Human-readable invariant used by tests and future integrators.
pub const RASTER_BOUNDARY_INVARIANT: &str =
    "GOES CSM worker accepts precomputed scalar point samples only; no raster decoding, tile parsing, pixel buffers, or full-science reads.";

const EARTH_RADIUS_KM: f64 = 6_371.0088;
const DEFAULT_MAX_DISTANCE_KM: f64 = 75.0;
const DEFAULT_MAX_AGE_S: i64 = 30 * 60;

/// A scalar request for the observed-nowcast CSM leg.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoesCsmPointRequest {
    pub lat_deg: f64,
    pub lon_deg: f64,
    /// ISO-8601 UTC (`...Z`) time the user wants answered for.
    pub requested_at: String,
}

/// Scalar Tier-0 answer consumed by snapshot assembly / go-look scoring.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoesCsmPointAnswer {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub requested_at: String,
    /// Observed/fallback clear-sky probability in [0, 1]. `None` means no safe
    /// scalar answer is available.
    pub clear_sky_probability: Option<f64>,
    /// Confidence in the cloud/clear classification in [0, 1]. `None` when no
    /// scalar answer is available.
    pub cloud_confidence: Option<f64>,
    /// Upstream product/model generation time when known.
    pub model_run_at: Option<String>,
    /// As-of time for the scalar answer; this is the leakage boundary.
    pub as_of: Option<String>,
    pub source: GoesCsmSource,
    pub quality: GoesCsmQuality,
    pub availability: GoesCsmAvailability,
    pub metadata: GoesCsmAnswerMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoesCsmAvailability {
    /// Observed GOES CSM scalar was sampled from a precomputed point fixture.
    Observed,
    /// GOES observed leg is unavailable; a scalar cloud forecast may be used.
    ForecastOnly,
    /// Neither observed CSM nor forecast scalar fallback is available.
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoesCsmQuality {
    Good,
    Stale,
    ForecastOnly,
    OutsideCoverage,
    NoNearbySample,
    InvalidInput,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoesCsmAnswerMetadata {
    pub reason: Option<GoesCsmFallbackReason>,
    pub sample_distance_km: Option<f64>,
    pub sample_age_s: Option<i64>,
    pub max_distance_km: f64,
    pub max_age_s: i64,
    pub boundary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoesCsmFallbackReason {
    OutsideGoesCoverage,
    NoObservedSample,
    ObservedSampleTooFar,
    ObservedSampleTooStale,
    SourceGap,
    ForecastLegSelected,
    InvalidRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoesSatellite {
    GoesEast,
    GoesWest,
    GoesUnknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoesCsmProduct {
    /// ABI L2 Clear Sky Mask / cloud mask-derived scalar.
    AbiL2ClearSkyMask,
    /// Fixture/synthetic scalar for deterministic tests.
    FixtureScalar,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoesCsmSource {
    pub provider: String,
    pub satellite: GoesSatellite,
    pub product: GoesCsmProduct,
    pub product_id: String,
}

impl GoesCsmSource {
    pub fn unavailable() -> Self {
        Self {
            provider: "none".to_string(),
            satellite: GoesSatellite::GoesUnknown,
            product: GoesCsmProduct::FixtureScalar,
            product_id: "unavailable".to_string(),
        }
    }
}

/// A fixture made only of precomputed scalar point samples.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoesCsmScalarFixture {
    pub source: GoesCsmSource,
    pub as_of: String,
    pub model_run_at: Option<String>,
    pub coverage: GoesCsmCoverage,
    #[serde(default = "default_max_distance_km")]
    pub max_distance_km: f64,
    #[serde(default = "default_max_age_s")]
    pub max_age_s: i64,
    #[serde(default)]
    pub samples: Vec<GoesCsmScalarSample>,
    pub forecast_fallback: Option<GoesCsmForecastFallback>,
    #[serde(default)]
    pub source_gap: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoesCsmCoverage {
    pub min_lat_deg: f64,
    pub max_lat_deg: f64,
    pub min_lon_deg: f64,
    pub max_lon_deg: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoesCsmScalarSample {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub observed_at: String,
    pub clear_sky_probability: f64,
    pub cloud_confidence: f64,
    pub quality: GoesCsmQuality,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoesCsmForecastFallback {
    pub provider: String,
    pub model_run_at: String,
    pub valid_at: String,
    pub clear_sky_probability: f64,
    pub cloud_confidence: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GoesCsmError {
    InvalidRequest(String),
    InvalidFixture(String),
    RasterBoundaryViolation(String),
}

impl fmt::Display for GoesCsmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(msg) => write!(f, "invalid GOES CSM request: {msg}"),
            Self::InvalidFixture(msg) => write!(f, "invalid GOES CSM scalar fixture: {msg}"),
            Self::RasterBoundaryViolation(msg) => write!(f, "raster boundary violation: {msg}"),
        }
    }
}

impl std::error::Error for GoesCsmError {}

/// Parse a scalar fixture JSON document. Any raster/tile/pixel-shaped field is
/// rejected before deserialization so this adapter cannot silently grow a Tier-2
/// worker path.
pub fn fixture_from_json(input: &str) -> Result<GoesCsmScalarFixture, GoesCsmError> {
    let value: Value = serde_json::from_str(input)
        .map_err(|err| GoesCsmError::InvalidFixture(format!("malformed JSON: {err}")))?;
    reject_raster_like_keys(&value, "$")?;
    serde_json::from_value(value)
        .map_err(|err| GoesCsmError::InvalidFixture(format!("schema mismatch: {err}")))
        .and_then(validate_fixture)
}

/// Build a point answer directly from scalar fixture JSON.
pub fn answer_from_fixture_json(
    input: &str,
    request: GoesCsmPointRequest,
) -> Result<GoesCsmPointAnswer, GoesCsmError> {
    let fixture = fixture_from_json(input)?;
    answer_from_fixture(&fixture, request)
}

/// Build a point answer from a precomputed scalar fixture.
pub fn answer_from_fixture(
    fixture: &GoesCsmScalarFixture,
    request: GoesCsmPointRequest,
) -> Result<GoesCsmPointAnswer, GoesCsmError> {
    let requested_at = parse_time(&request.requested_at)
        .map_err(|err| GoesCsmError::InvalidRequest(format!("requested_at: {err}")))?;
    validate_lat_lon(request.lat_deg, request.lon_deg).map_err(GoesCsmError::InvalidRequest)?;

    if !fixture.coverage.contains(request.lat_deg, request.lon_deg) {
        return Ok(fallback_or_unavailable(
            fixture,
            request,
            GoesCsmFallbackReason::OutsideGoesCoverage,
            GoesCsmQuality::OutsideCoverage,
        ));
    }

    if fixture.source_gap {
        return Ok(fallback_or_unavailable(
            fixture,
            request,
            GoesCsmFallbackReason::SourceGap,
            GoesCsmQuality::Unavailable,
        ));
    }

    let nearest = fixture
        .samples
        .iter()
        .filter_map(|sample| {
            rank_sample(sample, requested_at, request.lat_deg, request.lon_deg).ok()
        })
        .min_by(compare_ranked_samples);

    let Some(candidate) = nearest else {
        return Ok(fallback_or_unavailable(
            fixture,
            request,
            GoesCsmFallbackReason::NoObservedSample,
            GoesCsmQuality::NoNearbySample,
        ));
    };

    if candidate.distance_km > fixture.max_distance_km {
        return Ok(fallback_or_unavailable(
            fixture,
            request,
            GoesCsmFallbackReason::ObservedSampleTooFar,
            GoesCsmQuality::NoNearbySample,
        ));
    }

    if candidate.age_s.abs() > fixture.max_age_s {
        return Ok(fallback_or_unavailable(
            fixture,
            request,
            GoesCsmFallbackReason::ObservedSampleTooStale,
            GoesCsmQuality::Stale,
        ));
    }

    Ok(GoesCsmPointAnswer {
        lat_deg: request.lat_deg,
        lon_deg: normalize_lon(request.lon_deg),
        requested_at: request.requested_at,
        clear_sky_probability: Some(candidate.sample.clear_sky_probability),
        cloud_confidence: Some(candidate.sample.cloud_confidence),
        model_run_at: fixture.model_run_at.clone(),
        as_of: Some(fixture.as_of.clone()),
        source: fixture.source.clone(),
        quality: candidate.sample.quality.clone(),
        availability: GoesCsmAvailability::Observed,
        metadata: GoesCsmAnswerMetadata {
            reason: None,
            sample_distance_km: Some(round3(candidate.distance_km)),
            sample_age_s: Some(candidate.age_s),
            max_distance_km: fixture.max_distance_km,
            max_age_s: fixture.max_age_s,
            boundary: RASTER_BOUNDARY_INVARIANT.to_string(),
        },
    })
}

fn fallback_or_unavailable(
    fixture: &GoesCsmScalarFixture,
    request: GoesCsmPointRequest,
    reason: GoesCsmFallbackReason,
    unavailable_quality: GoesCsmQuality,
) -> GoesCsmPointAnswer {
    if let Some(fallback) = &fixture.forecast_fallback {
        return GoesCsmPointAnswer {
            lat_deg: request.lat_deg,
            lon_deg: normalize_lon(request.lon_deg),
            requested_at: request.requested_at,
            clear_sky_probability: Some(fallback.clear_sky_probability),
            cloud_confidence: Some(fallback.cloud_confidence),
            model_run_at: Some(fallback.model_run_at.clone()),
            as_of: Some(fallback.valid_at.clone()),
            source: GoesCsmSource {
                provider: fallback.provider.clone(),
                satellite: GoesSatellite::GoesUnknown,
                product: GoesCsmProduct::FixtureScalar,
                product_id: "forecast-fallback".to_string(),
            },
            quality: GoesCsmQuality::ForecastOnly,
            availability: GoesCsmAvailability::ForecastOnly,
            metadata: GoesCsmAnswerMetadata {
                reason: Some(reason),
                sample_distance_km: None,
                sample_age_s: None,
                max_distance_km: fixture.max_distance_km,
                max_age_s: fixture.max_age_s,
                boundary: RASTER_BOUNDARY_INVARIANT.to_string(),
            },
        };
    }

    GoesCsmPointAnswer {
        lat_deg: request.lat_deg,
        lon_deg: normalize_lon(request.lon_deg),
        requested_at: request.requested_at,
        clear_sky_probability: None,
        cloud_confidence: None,
        model_run_at: fixture.model_run_at.clone(),
        as_of: Some(fixture.as_of.clone()),
        source: fixture.source.clone(),
        quality: unavailable_quality,
        availability: GoesCsmAvailability::Unavailable,
        metadata: GoesCsmAnswerMetadata {
            reason: Some(reason),
            sample_distance_km: None,
            sample_age_s: None,
            max_distance_km: fixture.max_distance_km,
            max_age_s: fixture.max_age_s,
            boundary: RASTER_BOUNDARY_INVARIANT.to_string(),
        },
    }
}

fn validate_fixture(fixture: GoesCsmScalarFixture) -> Result<GoesCsmScalarFixture, GoesCsmError> {
    parse_time(&fixture.as_of)
        .map_err(|err| GoesCsmError::InvalidFixture(format!("as_of: {err}")))?;
    if let Some(model_run_at) = &fixture.model_run_at {
        parse_time(model_run_at)
            .map_err(|err| GoesCsmError::InvalidFixture(format!("model_run_at: {err}")))?;
    }
    if fixture.max_distance_km <= 0.0 || !fixture.max_distance_km.is_finite() {
        return Err(GoesCsmError::InvalidFixture(
            "max_distance_km must be positive and finite".to_string(),
        ));
    }
    if fixture.max_age_s < 0 {
        return Err(GoesCsmError::InvalidFixture(
            "max_age_s must be non-negative".to_string(),
        ));
    }
    fixture.coverage.validate()?;
    for sample in &fixture.samples {
        validate_lat_lon(sample.lat_deg, sample.lon_deg).map_err(GoesCsmError::InvalidFixture)?;
        validate_probability(sample.clear_sky_probability, "clear_sky_probability")?;
        validate_probability(sample.cloud_confidence, "cloud_confidence")?;
        parse_time(&sample.observed_at)
            .map_err(|err| GoesCsmError::InvalidFixture(format!("sample.observed_at: {err}")))?;
    }
    if let Some(fallback) = &fixture.forecast_fallback {
        validate_probability(
            fallback.clear_sky_probability,
            "forecast.clear_sky_probability",
        )?;
        validate_probability(fallback.cloud_confidence, "forecast.cloud_confidence")?;
        parse_time(&fallback.model_run_at)
            .map_err(|err| GoesCsmError::InvalidFixture(format!("forecast.model_run_at: {err}")))?;
        parse_time(&fallback.valid_at)
            .map_err(|err| GoesCsmError::InvalidFixture(format!("forecast.valid_at: {err}")))?;
    }
    Ok(fixture)
}

fn validate_probability(value: f64, field: &str) -> Result<(), GoesCsmError> {
    if (0.0..=1.0).contains(&value) && value.is_finite() {
        Ok(())
    } else {
        Err(GoesCsmError::InvalidFixture(format!(
            "{field} must be finite in [0, 1]"
        )))
    }
}

impl GoesCsmCoverage {
    fn validate(&self) -> Result<(), GoesCsmError> {
        validate_lat_lon(self.min_lat_deg, self.min_lon_deg)
            .map_err(GoesCsmError::InvalidFixture)?;
        validate_lat_lon(self.max_lat_deg, self.max_lon_deg)
            .map_err(GoesCsmError::InvalidFixture)?;
        if self.min_lat_deg > self.max_lat_deg {
            return Err(GoesCsmError::InvalidFixture(
                "coverage min_lat_deg must be <= max_lat_deg".to_string(),
            ));
        }
        Ok(())
    }

    fn contains(&self, lat_deg: f64, lon_deg: f64) -> bool {
        if lat_deg < self.min_lat_deg || lat_deg > self.max_lat_deg {
            return false;
        }
        let lon = normalize_lon(lon_deg);
        let min_lon = normalize_lon(self.min_lon_deg);
        let max_lon = normalize_lon(self.max_lon_deg);
        if min_lon <= max_lon {
            lon >= min_lon && lon <= max_lon
        } else {
            // Coverage crosses the dateline.
            lon >= min_lon || lon <= max_lon
        }
    }
}

struct RankedSample<'a> {
    sample: &'a GoesCsmScalarSample,
    distance_km: f64,
    age_s: i64,
}

fn rank_sample<'a>(
    sample: &'a GoesCsmScalarSample,
    requested_at: DateTime<Utc>,
    lat_deg: f64,
    lon_deg: f64,
) -> Result<RankedSample<'a>, GoesCsmError> {
    let observed_at = parse_time(&sample.observed_at)
        .map_err(|err| GoesCsmError::InvalidFixture(format!("sample.observed_at: {err}")))?;
    let age_s = requested_at
        .signed_duration_since(observed_at)
        .num_seconds();
    let distance_km = haversine_km(lat_deg, lon_deg, sample.lat_deg, sample.lon_deg);
    Ok(RankedSample {
        sample,
        distance_km,
        age_s,
    })
}

fn compare_ranked_samples(left: &RankedSample<'_>, right: &RankedSample<'_>) -> Ordering {
    left.age_s.abs().cmp(&right.age_s.abs()).then_with(|| {
        left.distance_km
            .partial_cmp(&right.distance_km)
            .unwrap_or(Ordering::Equal)
    })
}

fn reject_raster_like_keys(value: &Value, path: &str) -> Result<(), GoesCsmError> {
    const FORBIDDEN_KEYS: &[&str] = &[
        "raster",
        "rasters",
        "tile",
        "tiles",
        "pixel",
        "pixels",
        "grid",
        "grids",
        "bitmap",
        "image",
        "images",
        "netcdf",
        "geotiff",
        "bytes",
        "byte_buffer",
    ];

    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let key_lc = key.to_ascii_lowercase();
                if FORBIDDEN_KEYS.iter().any(|forbidden| key_lc == *forbidden) {
                    return Err(GoesCsmError::RasterBoundaryViolation(format!(
                        "field `{path}.{key}` is forbidden by Tier-0 scalar boundary"
                    )));
                }
                reject_raster_like_keys(child, &format!("{path}.{key}"))?;
            }
        }
        Value::Array(items) => {
            for (idx, child) in items.iter().enumerate() {
                reject_raster_like_keys(child, &format!("{path}[{idx}]"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_lat_lon(lat_deg: f64, lon_deg: f64) -> Result<(), String> {
    if !lat_deg.is_finite() || !(-90.0..=90.0).contains(&lat_deg) {
        return Err("lat_deg must be finite in [-90, 90]".to_string());
    }
    if !lon_deg.is_finite() || !(-540.0..=540.0).contains(&lon_deg) {
        return Err("lon_deg must be finite in [-540, 540]".to_string());
    }
    Ok(())
}

fn parse_time(input: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    DateTime::parse_from_rfc3339(input).map(|dt| dt.with_timezone(&Utc))
}

fn normalize_lon(lon_deg: f64) -> f64 {
    let mut lon = ((lon_deg + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
    if lon == -180.0 && lon_deg > 0.0 {
        lon = 180.0;
    }
    lon
}

fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (normalize_lon(lon2) - normalize_lon(lon1)).to_radians();
    let lat1 = lat1.to_radians();
    let lat2 = lat2.to_radians();
    let a = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * a.sqrt().asin()
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn default_max_distance_km() -> f64 {
    DEFAULT_MAX_DISTANCE_KM
}

fn default_max_age_s() -> i64 {
    DEFAULT_MAX_AGE_S
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCALAR_FIXTURE: &str = r#"
    {
      "source": {
        "provider": "NOAA Open Data Dissemination",
        "satellite": "goes_east",
        "product": "fixture_scalar",
        "product_id": "ABI-L2-ACM-point-fixture"
      },
      "as_of": "2026-06-12T07:55:00Z",
      "model_run_at": "2026-06-12T07:50:00Z",
      "coverage": {
        "min_lat_deg": -60.0,
        "max_lat_deg": 60.0,
        "min_lon_deg": -165.0,
        "max_lon_deg": -20.0
      },
      "max_distance_km": 50.0,
      "max_age_s": 900,
      "samples": [
        {
          "lat_deg": 44.98,
          "lon_deg": -93.27,
          "observed_at": "2026-06-12T07:55:00Z",
          "clear_sky_probability": 0.82,
          "cloud_confidence": 0.91,
          "quality": "good"
        },
        {
          "lat_deg": 35.00,
          "lon_deg": -106.60,
          "observed_at": "2026-06-12T07:55:00Z",
          "clear_sky_probability": 0.25,
          "cloud_confidence": 0.88,
          "quality": "good"
        }
      ],
      "forecast_fallback": {
        "provider": "open_meteo_fixture",
        "model_run_at": "2026-06-12T06:00:00Z",
        "valid_at": "2026-06-12T08:00:00Z",
        "clear_sky_probability": 0.64,
        "cloud_confidence": 0.55
      }
    }
    "#;

    #[test]
    fn goes_csm_fixture_returns_observed_scalar_point_answer() {
        let request = GoesCsmPointRequest {
            lat_deg: 45.0,
            lon_deg: -93.25,
            requested_at: "2026-06-12T08:00:00Z".to_string(),
        };

        let answer = answer_from_fixture_json(SCALAR_FIXTURE, request).unwrap();

        assert_eq!(answer.availability, GoesCsmAvailability::Observed);
        assert_eq!(answer.quality, GoesCsmQuality::Good);
        assert_eq!(answer.clear_sky_probability, Some(0.82));
        assert_eq!(answer.cloud_confidence, Some(0.91));
        assert_eq!(
            answer.model_run_at,
            Some("2026-06-12T07:50:00Z".to_string())
        );
        assert_eq!(answer.as_of, Some("2026-06-12T07:55:00Z".to_string()));
        assert!(answer.metadata.sample_distance_km.unwrap() < 3.0);
        assert_eq!(answer.metadata.sample_age_s, Some(300));
        assert_eq!(answer.metadata.boundary, RASTER_BOUNDARY_INVARIANT);
    }

    #[test]
    fn goes_csm_outside_coverage_degrades_to_forecast_only() {
        let request = GoesCsmPointRequest {
            lat_deg: 64.1,
            lon_deg: -21.9,
            requested_at: "2026-06-12T08:00:00Z".to_string(),
        };

        let answer = answer_from_fixture_json(SCALAR_FIXTURE, request).unwrap();

        assert_eq!(answer.availability, GoesCsmAvailability::ForecastOnly);
        assert_eq!(answer.quality, GoesCsmQuality::ForecastOnly);
        assert_eq!(answer.clear_sky_probability, Some(0.64));
        assert_eq!(answer.cloud_confidence, Some(0.55));
        assert_eq!(answer.as_of, Some("2026-06-12T08:00:00Z".to_string()));
        assert_eq!(
            answer.metadata.reason,
            Some(GoesCsmFallbackReason::OutsideGoesCoverage)
        );
        assert_eq!(answer.source.provider, "open_meteo_fixture");
    }

    #[test]
    fn goes_csm_without_forecast_returns_unavailable_metadata() {
        let mut fixture = fixture_from_json(SCALAR_FIXTURE).unwrap();
        fixture.forecast_fallback = None;
        fixture.samples.clear();

        let request = GoesCsmPointRequest {
            lat_deg: 45.0,
            lon_deg: -93.25,
            requested_at: "2026-06-12T08:00:00Z".to_string(),
        };

        let answer = answer_from_fixture(&fixture, request).unwrap();

        assert_eq!(answer.availability, GoesCsmAvailability::Unavailable);
        assert_eq!(answer.quality, GoesCsmQuality::NoNearbySample);
        assert_eq!(answer.clear_sky_probability, None);
        assert_eq!(answer.cloud_confidence, None);
        assert_eq!(
            answer.metadata.reason,
            Some(GoesCsmFallbackReason::NoObservedSample)
        );
    }

    #[test]
    fn goes_csm_stale_observation_uses_forecast_fallback() {
        let request = GoesCsmPointRequest {
            lat_deg: 45.0,
            lon_deg: -93.25,
            requested_at: "2026-06-12T09:00:01Z".to_string(),
        };

        let answer = answer_from_fixture_json(SCALAR_FIXTURE, request).unwrap();

        assert_eq!(answer.availability, GoesCsmAvailability::ForecastOnly);
        assert_eq!(answer.quality, GoesCsmQuality::ForecastOnly);
        assert_eq!(
            answer.metadata.reason,
            Some(GoesCsmFallbackReason::ObservedSampleTooStale)
        );
    }

    #[test]
    fn goes_csm_rejects_raster_or_tile_shaped_fixture_inputs() {
        let bad = r#"
        {
          "source": {"provider":"NOAA", "satellite":"goes_east", "product":"fixture_scalar", "product_id":"bad"},
          "as_of": "2026-06-12T07:55:00Z",
          "model_run_at": null,
          "coverage": {"min_lat_deg": -60, "max_lat_deg": 60, "min_lon_deg": -165, "max_lon_deg": -20},
          "samples": [],
          "tiles": ["s3://noaa-goes16/..."],
          "forecast_fallback": null
        }
        "#;

        let err = fixture_from_json(bad).unwrap_err();
        assert!(matches!(err, GoesCsmError::RasterBoundaryViolation(_)));
    }

    #[test]
    fn goes_csm_rejects_invalid_probability_fixture() {
        let bad = SCALAR_FIXTURE.replace("0.82", "1.82");
        let err = fixture_from_json(&bad).unwrap_err();
        assert!(format!("{err}").contains("clear_sky_probability"));
    }
}
