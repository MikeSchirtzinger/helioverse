//! helio-imagery — Cloudflare Worker: Imagery Pipeline
//!
//! W1-P4: Imagery cache/failover + Helioviewer ROI thumbnail writer
//! Owner: GPT builder (openai-codex/gpt-5.5) / DeepSeek validator
//!
//! This crate is intentionally fixture-first: all routing, key planning, and
//! failover behavior is pure Rust and covered by unit tests. The Worker runtime
//! is only responsible for fetching opaque image bytes and putting them in R2;
//! it must never decode, crop, or transform rasters.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use worker::*;

pub const CONTRACT_MAJOR: &str = "v1";
pub const THUMB_PREFIX: &str = "v1/thumbs";
pub const DEFAULT_SDO_RESOLUTION: u16 = 2048;
pub const DEFAULT_TEXTURE_STALE_AFTER_S: i64 = 45 * 60;
pub const DEFAULT_THUMBNAIL_SIZE_PX: u16 = 96;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageryLayer {
    Sdo304,
    Sdo193,
    SdoHmi,
    Suvi195,
    Suvi304,
}

impl ImageryLayer {
    pub fn public_slug(self) -> &'static str {
        match self {
            Self::Sdo304 => "0304",
            Self::Sdo193 => "0193",
            Self::SdoHmi => "hmi",
            Self::Suvi195 => "suvi-195",
            Self::Suvi304 => "suvi-304",
        }
    }

    pub fn helioviewer_layer(self) -> &'static str {
        match self {
            Self::Sdo304 => "SDO,AIA,304",
            Self::Sdo193 => "SDO,AIA,193",
            Self::SdoHmi => "SDO,HMI,magnetogram",
            Self::Suvi195 => "GOES-R,SUVI,195",
            Self::Suvi304 => "GOES-R,SUVI,304",
        }
    }

    pub fn cache_key_latest(self) -> String {
        match self {
            Self::Sdo304 | Self::Sdo193 | Self::SdoHmi => {
                format!("v1/imagery/sdo/{}/latest.jpg", self.public_slug())
            }
            // SUVI is an operational direct fallback leg. It is not part of the
            // frozen SDO texture layout, so keep it in an imagery namespace that
            // does not collide with the contract-owned SDO keys.
            Self::Suvi195 | Self::Suvi304 => {
                format!("v1/imagery/suvi/{}/latest.png", self.public_slug())
            }
        }
    }

    pub fn archive_key(self, at: DateTime<Utc>) -> String {
        match self {
            Self::Sdo304 | Self::Sdo193 | Self::SdoHmi => format!(
                "v1/imagery/sdo/{}/archive/{}.jpg",
                self.public_slug(),
                at.format("%Y/%m/%d/%H00")
            ),
            Self::Suvi195 | Self::Suvi304 => format!(
                "v1/imagery/suvi/{}/archive/{}.png",
                self.public_slug(),
                at.format("%Y/%m/%d/%H00")
            ),
        }
    }

    fn direct_source(self) -> RouteSource {
        match self {
            Self::Sdo304 | Self::Sdo193 | Self::SdoHmi => RouteSource::DirectSdo,
            Self::Suvi195 | Self::Suvi304 => RouteSource::DirectSuvi,
        }
    }

    fn direct_url(self) -> String {
        match self {
            Self::Sdo304 => latest_sdo_url("0304"),
            Self::Sdo193 => latest_sdo_url("0193"),
            Self::SdoHmi => latest_sdo_url("HMIB"),
            Self::Suvi195 => latest_suvi_url("195"),
            Self::Suvi304 => latest_suvi_url("304"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteSource {
    Helioviewer,
    DirectSdo,
    DirectSuvi,
    LastGoodCache,
}

impl RouteSource {
    pub fn is_upstream(self) -> bool {
        matches!(self, Self::Helioviewer | Self::DirectSdo | Self::DirectSuvi)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus {
    Ok,
    Stale,
    Gap,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteCandidate {
    pub source: RouteSource,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayerRoute {
    pub layer: ImageryLayer,
    pub cache_key_latest: String,
    pub candidates: Vec<RouteCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceAvailability {
    pub helioviewer: bool,
    pub direct_sdo: bool,
    pub direct_suvi: bool,
}

impl SourceAvailability {
    pub const fn all_up() -> Self {
        Self {
            helioviewer: true,
            direct_sdo: true,
            direct_suvi: true,
        }
    }

    pub const fn primary_down() -> Self {
        Self {
            helioviewer: false,
            direct_sdo: true,
            direct_suvi: true,
        }
    }

    pub fn is_available(&self, source: RouteSource) -> bool {
        match source {
            RouteSource::Helioviewer => self.helioviewer,
            RouteSource::DirectSdo => self.direct_sdo,
            RouteSource::DirectSuvi => self.direct_suvi,
            RouteSource::LastGoodCache => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LastGoodFrame {
    pub r2_key: String,
    pub captured_at: DateTime<Utc>,
    pub content_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StalenessBadge {
    pub status: SourceStatus,
    pub label: String,
    pub selected_source: Option<RouteSource>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub age_s: Option<i64>,
    pub is_fallback: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteDecision {
    pub layer: ImageryLayer,
    pub cache_key_latest: String,
    pub selected_source: Option<RouteSource>,
    pub selected_url: Option<String>,
    pub last_good_key: Option<String>,
    pub write_latest: bool,
    pub candidates: Vec<RouteCandidate>,
    pub badge: StalenessBadge,
    /// Guardrail exposed for tests and integration code: the Worker copies
    /// opaque bytes from selected_url or last_good_key. It never decodes pixels.
    pub raster_handling: RasterHandling,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RasterHandling {
    OpaqueBytesOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RoiCrop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThumbnailPlan {
    pub event_id: String,
    pub event_key: String,
    pub r2_key: String,
    pub captured_at: DateTime<Utc>,
    pub wavelength: String,
    pub crop: RoiCrop,
    pub source: RouteSource,
    pub screenshot_url: String,
    pub output_content_type: String,
    pub output_size_px: u16,
    pub raster_handling: RasterHandling,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlannerError {
    InvalidEventId(String),
    InvalidCrop(String),
}

impl std::fmt::Display for PlannerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidEventId(id) => write!(f, "invalid event id: {id}"),
            Self::InvalidCrop(msg) => write!(f, "invalid ROI crop: {msg}"),
        }
    }
}

impl std::error::Error for PlannerError {}

pub type PlannerResult<T> = std::result::Result<T, PlannerError>;

pub fn route_table() -> Vec<LayerRoute> {
    [
        ImageryLayer::Sdo304,
        ImageryLayer::Sdo193,
        ImageryLayer::SdoHmi,
        ImageryLayer::Suvi195,
        ImageryLayer::Suvi304,
    ]
    .into_iter()
    .map(route_for_layer)
    .collect()
}

pub fn route_for_layer(layer: ImageryLayer) -> LayerRoute {
    LayerRoute {
        layer,
        cache_key_latest: layer.cache_key_latest(),
        candidates: vec![
            RouteCandidate {
                source: RouteSource::Helioviewer,
                url: Some(helioviewer_latest_url(layer)),
            },
            RouteCandidate {
                source: layer.direct_source(),
                url: Some(layer.direct_url()),
            },
            RouteCandidate {
                source: RouteSource::LastGoodCache,
                url: None,
            },
        ],
    }
}

pub fn plan_layer_fetch(
    layer: ImageryLayer,
    now: DateTime<Utc>,
    availability: &SourceAvailability,
    last_good: Option<&LastGoodFrame>,
) -> RouteDecision {
    let route = route_for_layer(layer);
    for candidate in route
        .candidates
        .clone()
        .into_iter()
        .filter(|c| c.source.is_upstream())
    {
        if availability.is_available(candidate.source) {
            let is_fallback = candidate.source != RouteSource::Helioviewer;
            return RouteDecision {
                layer,
                cache_key_latest: route.cache_key_latest,
                selected_source: Some(candidate.source),
                selected_url: candidate.url,
                last_good_key: None,
                write_latest: true,
                candidates: route.candidates,
                badge: StalenessBadge {
                    status: SourceStatus::Ok,
                    label: if is_fallback {
                        format!("using {} fallback", source_label(candidate.source))
                    } else {
                        "fresh via Helioviewer".to_string()
                    },
                    selected_source: Some(candidate.source),
                    last_success_at: Some(now),
                    age_s: Some(0),
                    is_fallback,
                    reason: if is_fallback {
                        Some("Helioviewer primary unavailable".to_string())
                    } else {
                        None
                    },
                },
                raster_handling: RasterHandling::OpaqueBytesOnly,
            };
        }
    }

    if let Some(frame) = last_good {
        let age_s = (now - frame.captured_at).num_seconds().max(0);
        return RouteDecision {
            layer,
            cache_key_latest: route.cache_key_latest,
            selected_source: Some(RouteSource::LastGoodCache),
            selected_url: None,
            last_good_key: Some(frame.r2_key.clone()),
            write_latest: false,
            candidates: route.candidates,
            badge: StalenessBadge {
                status: SourceStatus::Stale,
                label: format!("cached {} old", human_age(age_s)),
                selected_source: Some(RouteSource::LastGoodCache),
                last_success_at: Some(frame.captured_at),
                age_s: Some(age_s),
                is_fallback: true,
                reason: Some("Helioviewer and direct imagery sources unavailable".to_string()),
            },
            raster_handling: RasterHandling::OpaqueBytesOnly,
        };
    }

    RouteDecision {
        layer,
        cache_key_latest: route.cache_key_latest,
        selected_source: None,
        selected_url: None,
        last_good_key: None,
        write_latest: false,
        candidates: route.candidates,
        badge: StalenessBadge {
            status: SourceStatus::Gap,
            label: "imagery unavailable".to_string(),
            selected_source: None,
            last_success_at: None,
            age_s: None,
            is_fallback: true,
            reason: Some("no upstream source and no last-good cache object".to_string()),
        },
        raster_handling: RasterHandling::OpaqueBytesOnly,
    }
}

/// Contract transform from `contracts/r2-layout.md`: strip the colon from the
/// time portion only. Example: `2026-06-04T07:31Z-CME-001` becomes
/// `2026-06-04T0731Z-CME-001`.
pub fn event_key_from_id(event_id: &str) -> PlannerResult<String> {
    validate_event_id_shape(event_id)?;
    let t = event_id
        .find('T')
        .ok_or_else(|| PlannerError::InvalidEventId(event_id.to_string()))?;
    let z_rel = event_id[t..]
        .find('Z')
        .ok_or_else(|| PlannerError::InvalidEventId(event_id.to_string()))?;
    let z = t + z_rel;
    let mut out = String::with_capacity(event_id.len() - 1);
    out.push_str(&event_id[..t]);
    out.push('T');
    out.push_str(&event_id[t + 1..z].replace(':', ""));
    out.push_str(&event_id[z..]);
    Ok(out)
}

pub fn thumbnail_key_for_event_id(event_id: &str) -> PlannerResult<String> {
    Ok(format!(
        "{}/{}.jpg",
        THUMB_PREFIX,
        event_key_from_id(event_id)?
    ))
}

pub fn plan_roi_thumbnail(
    event_id: &str,
    captured_at: DateTime<Utc>,
    wavelength: impl Into<String>,
    crop: RoiCrop,
) -> PlannerResult<ThumbnailPlan> {
    validate_crop(crop)?;
    let wavelength = wavelength.into();
    let event_key = event_key_from_id(event_id)?;
    let r2_key = format!("{THUMB_PREFIX}/{event_key}.jpg");
    let screenshot_url = helioviewer_roi_screenshot_url(captured_at, &wavelength, crop);
    Ok(ThumbnailPlan {
        event_id: event_id.to_string(),
        event_key,
        r2_key,
        captured_at,
        wavelength,
        crop,
        source: RouteSource::Helioviewer,
        screenshot_url,
        output_content_type: "image/jpeg".to_string(),
        output_size_px: DEFAULT_THUMBNAIL_SIZE_PX,
        raster_handling: RasterHandling::OpaqueBytesOnly,
    })
}

fn latest_sdo_url(wavelength: &str) -> String {
    format!(
        "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_{}_{}.jpg",
        DEFAULT_SDO_RESOLUTION, wavelength
    )
}

fn latest_suvi_url(channel: &str) -> String {
    format!("https://services.swpc.noaa.gov/images/animations/suvi/primary/{channel}/latest.png")
}

fn helioviewer_latest_url(layer: ImageryLayer) -> String {
    format!(
        "https://api.helioviewer.org/v2/takeScreenshot/?date=latest&imageScale=2.4204409&layers={}&x0=0&y0=0&width=2048&height=2048",
        encode_query_component(layer.helioviewer_layer())
    )
}

fn helioviewer_roi_screenshot_url(
    captured_at: DateTime<Utc>,
    wavelength: &str,
    crop: RoiCrop,
) -> String {
    format!(
        "https://api.helioviewer.org/v2/takeScreenshot/?date={}&imageScale=2.4204409&layers={}&x0={}&y0={}&width={}&height={}",
        encode_query_component(&captured_at.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        encode_query_component(wavelength),
        trim_float(crop.x),
        trim_float(crop.y),
        trim_float(crop.w),
        trim_float(crop.h)
    )
}

fn encode_query_component(input: &str) -> String {
    input
        .bytes()
        .flat_map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![b as char]
            }
            _ => format!("%{b:02X}").chars().collect(),
        })
        .collect()
}

fn trim_float(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

fn source_label(source: RouteSource) -> &'static str {
    match source {
        RouteSource::Helioviewer => "Helioviewer",
        RouteSource::DirectSdo => "direct SDO",
        RouteSource::DirectSuvi => "direct SUVI",
        RouteSource::LastGoodCache => "last-good cache",
    }
}

fn human_age(age_s: i64) -> String {
    if age_s < 120 {
        format!("{age_s}s")
    } else if age_s < 3 * 3600 {
        format!("{}m", age_s / 60)
    } else {
        format!("{}h", age_s / 3600)
    }
}

fn validate_crop(crop: RoiCrop) -> PlannerResult<()> {
    if !crop.x.is_finite() || !crop.y.is_finite() || !crop.w.is_finite() || !crop.h.is_finite() {
        return Err(PlannerError::InvalidCrop(
            "coordinates must be finite numbers".to_string(),
        ));
    }
    if crop.w <= 0.0 || crop.h <= 0.0 {
        return Err(PlannerError::InvalidCrop(
            "width and height must be positive".to_string(),
        ));
    }
    Ok(())
}

fn validate_event_id_shape(event_id: &str) -> PlannerResult<()> {
    let (date, rest) = event_id
        .split_once('T')
        .ok_or_else(|| PlannerError::InvalidEventId(event_id.to_string()))?;
    if date.len() != 10 || date.chars().filter(|c| *c == '-').count() != 2 {
        return Err(PlannerError::InvalidEventId(event_id.to_string()));
    }
    let (time, suffix) = rest
        .split_once('Z')
        .ok_or_else(|| PlannerError::InvalidEventId(event_id.to_string()))?;
    let mut time_parts = time.split(':');
    let hh = time_parts.next().unwrap_or_default();
    let mm = time_parts.next().unwrap_or_default();
    if time_parts.next().is_some()
        || hh.len() != 2
        || mm.len() != 2
        || !hh.chars().all(|c| c.is_ascii_digit())
        || !mm.chars().all(|c| c.is_ascii_digit())
    {
        return Err(PlannerError::InvalidEventId(event_id.to_string()));
    }
    let suffix = suffix
        .strip_prefix('-')
        .ok_or_else(|| PlannerError::InvalidEventId(event_id.to_string()))?;
    let mut suffix_parts = suffix.split('-');
    let event_type = suffix_parts.next().unwrap_or_default();
    let nnn = suffix_parts.next().unwrap_or_default();
    if suffix_parts.next().is_some()
        || !matches!(
            event_type,
            "CME" | "FLR" | "IPS" | "SEP" | "GST" | "FILAMENT"
        )
        || nnn.len() != 3
        || !nnn.chars().all(|c| c.is_ascii_digit())
    {
        return Err(PlannerError::InvalidEventId(event_id.to_string()));
    }
    Ok(())
}

#[event(fetch)]
async fn main(req: Request, _env: Env, _ctx: Context) -> Result<Response> {
    match req.path().as_str() {
        "/routes" => Response::from_json(&route_table()),
        _ => Response::ok("helio-imagery v0.1"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(y: i32, mon: u32, d: u32, h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, mon, d, h, m, 0).unwrap()
    }

    #[test]
    fn route_table_orders_helioviewer_direct_last_good_for_sdo() {
        let route = route_for_layer(ImageryLayer::Sdo304);
        let sources: Vec<_> = route.candidates.iter().map(|c| c.source).collect();
        assert_eq!(
            sources,
            vec![
                RouteSource::Helioviewer,
                RouteSource::DirectSdo,
                RouteSource::LastGoodCache
            ]
        );
        assert_eq!(route.cache_key_latest, "v1/imagery/sdo/0304/latest.jpg");
        assert!(route.candidates[0]
            .url
            .as_ref()
            .unwrap()
            .contains("api.helioviewer.org"));
        assert!(route.candidates[1]
            .url
            .as_ref()
            .unwrap()
            .contains("sdo.gsfc.nasa.gov"));
    }

    #[test]
    fn route_table_orders_helioviewer_direct_last_good_for_suvi() {
        let route = route_for_layer(ImageryLayer::Suvi195);
        let sources: Vec<_> = route.candidates.iter().map(|c| c.source).collect();
        assert_eq!(
            sources,
            vec![
                RouteSource::Helioviewer,
                RouteSource::DirectSuvi,
                RouteSource::LastGoodCache
            ]
        );
        assert!(route.candidates[1]
            .url
            .as_ref()
            .unwrap()
            .contains("services.swpc.noaa.gov"));
    }

    #[test]
    fn primary_helioviewer_wins_when_alive() {
        let now = t(2026, 6, 12, 12, 0);
        let decision = plan_layer_fetch(
            ImageryLayer::Sdo193,
            now,
            &SourceAvailability::all_up(),
            None,
        );
        assert_eq!(decision.selected_source, Some(RouteSource::Helioviewer));
        assert_eq!(decision.badge.status, SourceStatus::Ok);
        assert!(!decision.badge.is_fallback);
        assert!(decision.write_latest);
        assert_eq!(decision.raster_handling, RasterHandling::OpaqueBytesOnly);
    }

    #[test]
    fn failover_test_kills_primary_and_selects_direct_sdo() {
        let now = t(2026, 6, 12, 12, 0);
        let decision = plan_layer_fetch(
            ImageryLayer::Sdo304,
            now,
            &SourceAvailability::primary_down(),
            None,
        );
        assert_eq!(decision.selected_source, Some(RouteSource::DirectSdo));
        assert!(decision
            .selected_url
            .unwrap()
            .contains("latest_2048_0304.jpg"));
        assert_eq!(decision.badge.status, SourceStatus::Ok);
        assert!(decision.badge.is_fallback);
        assert_eq!(
            decision.badge.reason.as_deref(),
            Some("Helioviewer primary unavailable")
        );
    }

    #[test]
    fn failover_test_kills_primary_and_selects_direct_suvi() {
        let now = t(2026, 6, 12, 12, 0);
        let decision = plan_layer_fetch(
            ImageryLayer::Suvi195,
            now,
            &SourceAvailability::primary_down(),
            None,
        );
        assert_eq!(decision.selected_source, Some(RouteSource::DirectSuvi));
        assert!(decision
            .selected_url
            .unwrap()
            .contains("/suvi/primary/195/"));
        assert_eq!(decision.badge.status, SourceStatus::Ok);
        assert!(decision.badge.is_fallback);
    }

    #[test]
    fn failover_uses_last_good_with_staleness_badge_when_all_upstreams_fail() {
        let now = t(2026, 6, 12, 12, 0);
        let last_good = LastGoodFrame {
            r2_key: "v1/imagery/sdo/0304/latest.jpg".to_string(),
            captured_at: t(2026, 6, 12, 10, 30),
            content_type: "image/jpeg".to_string(),
        };
        let availability = SourceAvailability {
            helioviewer: false,
            direct_sdo: false,
            direct_suvi: false,
        };
        let decision = plan_layer_fetch(ImageryLayer::Sdo304, now, &availability, Some(&last_good));
        assert_eq!(decision.selected_source, Some(RouteSource::LastGoodCache));
        assert_eq!(
            decision.last_good_key.as_deref(),
            Some("v1/imagery/sdo/0304/latest.jpg")
        );
        assert!(!decision.write_latest);
        assert_eq!(decision.badge.status, SourceStatus::Stale);
        assert_eq!(decision.badge.age_s, Some(90 * 60));
        assert_eq!(decision.badge.label, "cached 90m old");
    }

    #[test]
    fn gap_badge_when_no_upstream_and_no_last_good() {
        let now = t(2026, 6, 12, 12, 0);
        let availability = SourceAvailability {
            helioviewer: false,
            direct_sdo: false,
            direct_suvi: false,
        };
        let decision = plan_layer_fetch(ImageryLayer::SdoHmi, now, &availability, None);
        assert_eq!(decision.selected_source, None);
        assert_eq!(decision.badge.status, SourceStatus::Gap);
        assert_eq!(decision.badge.label, "imagery unavailable");
    }

    #[test]
    fn thumbnail_key_planner_matches_contract_event_transform() {
        assert_eq!(
            event_key_from_id("2026-06-04T07:31Z-CME-001").unwrap(),
            "2026-06-04T0731Z-CME-001"
        );
        assert_eq!(
            thumbnail_key_for_event_id("2026-06-04T07:31Z-CME-001").unwrap(),
            "v1/thumbs/2026-06-04T0731Z-CME-001.jpg"
        );
    }

    #[test]
    fn thumbnail_plan_uses_helioviewer_roi_and_never_decodes_pixels() {
        let plan = plan_roi_thumbnail(
            "2026-06-04T07:31Z-CME-001",
            t(2026, 6, 4, 7, 31),
            "LASCO-C2",
            RoiCrop {
                x: 512.0,
                y: 384.0,
                w: 256.0,
                h: 256.0,
            },
        )
        .unwrap();
        assert_eq!(plan.source, RouteSource::Helioviewer);
        assert_eq!(plan.r2_key, "v1/thumbs/2026-06-04T0731Z-CME-001.jpg");
        assert_eq!(plan.output_content_type, "image/jpeg");
        assert_eq!(plan.output_size_px, 96);
        assert_eq!(plan.raster_handling, RasterHandling::OpaqueBytesOnly);
        assert!(plan
            .screenshot_url
            .contains("api.helioviewer.org/v2/takeScreenshot"));
        assert!(plan
            .screenshot_url
            .contains("date=2026-06-04T07%3A31%3A00Z"));
        assert!(plan.screenshot_url.contains("layers=LASCO-C2"));
        assert!(plan.screenshot_url.contains("x0=512"));
        assert!(plan.screenshot_url.contains("width=256"));
    }

    #[test]
    fn invalid_event_id_and_invalid_crop_are_rejected() {
        assert!(thumbnail_key_for_event_id("2026-06-04T07:31:00Z-CME-001").is_err());
        assert!(plan_roi_thumbnail(
            "2026-06-04T07:31Z-CME-001",
            t(2026, 6, 4, 7, 31),
            "LASCO-C2",
            RoiCrop {
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 10.0,
            },
        )
        .is_err());
    }
}
