// W1-P1d: DONKI event adapter
// Owner: DeepSeek builder (deepseek/deepseek-v4-pro) / GPT validator
//
// Acceptance: stable event IDs, versioned kinematics, link edges;
// event fixtures validate against contracts/schemas/event.schema.json.

use serde::{Deserialize, Serialize};

// ============================================================================
// DONKI raw API response types (subset of NASA DONKI JSON)
// ============================================================================

/// A single CME entry from DONKI /DONKI/CME endpoint.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DonkiCme {
    #[serde(rename = "activityID")]
    pub activity_id: String,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(default)]
    pub instruments: Vec<String>,
    #[serde(rename = "sourceLocation")]
    pub source_location: Option<String>,
    #[serde(rename = "activeRegionNum")]
    pub active_region_num: Option<i32>,
    #[serde(default, rename = "linkedEvents")]
    pub linked_events: Vec<DonkiLinkedEvent>,
    #[serde(default)]
    pub note: String,
}

/// A single FLR entry from DONKI /DONKI/FLR endpoint.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DonkiFlr {
    #[serde(rename = "flrID")]
    pub flr_id: String,
    #[serde(rename = "beginTime")]
    pub begin_time: String,
    #[serde(rename = "peakTime")]
    pub peak_time: String,
    #[serde(default, rename = "endTime")]
    pub end_time: Option<String>,
    #[serde(rename = "classType")]
    pub class_type: String,
    #[serde(rename = "sourceLocation")]
    pub source_location: Option<String>,
    #[serde(rename = "activeRegionNum")]
    pub active_region_num: Option<i32>,
    #[serde(default)]
    pub instruments: Vec<String>,
    #[serde(default, rename = "linkedEvents")]
    pub linked_events: Vec<DonkiLinkedEvent>,
    #[serde(default)]
    pub note: String,
}

/// A single CME Analysis from DONKI /DONKI/CMEAnalysis endpoint.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DonkiCmeAnalysis {
    #[serde(default, rename = "time21_5")]
    pub time21_5: Option<String>,
    #[serde(default)]
    pub latitude: Option<f64>,
    #[serde(default)]
    pub longitude: Option<f64>,
    #[serde(default, rename = "halfAngle")]
    pub half_angle: Option<f64>,
    #[serde(default)]
    pub speed: Option<f64>,
    #[serde(rename = "type", default)]
    pub cme_type: String,
    #[serde(default, rename = "isMostAccurate")]
    pub is_most_accurate: bool,
    #[serde(default, rename = "levelOfData")]
    pub level_of_data: Option<String>,
    #[serde(default)]
    pub note: String,
}

/// A link to another DONKI event.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DonkiLinkedEvent {
    #[serde(rename = "activityID")]
    pub activity_id: String,
}

// ============================================================================
// Normalized event types (serialize toward contracts/schemas/event.schema.json)
// ============================================================================

/// The fully normalized event produced by this adapter.
/// Serializes compatibly with contracts/schemas/event.schema.json.
#[derive(Debug, Clone, Serialize)]
pub struct NormalizedEvent {
    pub schema_version: String,
    pub id: String,
    pub uuid: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub detected_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub liftoff_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_region: Option<NormalizedSourceRegion>,
    pub kinematics: Vec<NormalizedKinematics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flare: Option<NormalizedFlare>,
    pub earth_bound_score: f64,
    pub links: Vec<NormalizedLink>,
    pub predictions: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<serde_json::Value>,
    pub provenance: NormalizedProvenance,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormalizedSourceRegion {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ar_number: Option<i32>,
    pub lon_deg: f64,
    pub lat_deg: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrument: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormalizedKinematics {
    pub version: i32,
    pub measured_at: String,
    pub speed_kms: f64,
    pub half_angle_deg: f64,
    pub direction: NormalizedDirection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cme_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurement_technique: Option<String>,
    pub is_halo: bool,
    pub is_most_accurate: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormalizedDirection {
    pub lon_deg: f64,
    pub lat_deg: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormalizedFlare {
    pub class: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xray_peak_wm2: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormalizedLink {
    pub id: String,
    pub rel: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormalizedProvenance {
    pub catalog: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub donki_activity_id: Option<String>,
    pub first_seen_at: String,
    pub as_of: String,
}

// ============================================================================
// Public adapter API
// ============================================================================

/// Parse a raw DONKI CME JSON string and an optional set of CMEAnalysis entries
/// into a single normalized event.
///
/// `cme_json` — the DONKI /CME response for one CME.
/// `analyses` — all CMEAnalysis entries linked to this CME (sorted oldest-first).
/// `as_of` — the timestamp when this pull was made.
pub fn parse_cme(
    cme_json: &str,
    analyses: &[DonkiCmeAnalysis],
    as_of: &str,
) -> Result<NormalizedEvent, String> {
    let cme: DonkiCme =
        serde_json::from_str(cme_json).map_err(|e| format!("CME parse error: {e}"))?;

    // --- build event ID from DONKI activity ID ---
    let event_id = donki_activity_to_event_id(&cme.activity_id)?;
    let uuid = make_deterministic_uuid(&event_id);

    // --- source region ---
    let source_region = parse_source_location(
        cme.source_location.as_deref(),
        cme.active_region_num,
        cme.instruments.first().map(|s| s.as_str()),
    );

    // --- kinematics (versioned from CMEAnalysis) ---
    let kinematics: Vec<NormalizedKinematics> = analyses
        .iter()
        .filter(|a| a.speed.is_some() && a.half_angle.is_some())
        .enumerate()
        .map(|(i, a)| {
            let version = (i + 1) as i32;
            let measured_at = a.time21_5.clone().unwrap_or_default();
            let lon = a.longitude.unwrap_or(0.0);
            let lat = a.latitude.unwrap_or(0.0);
            let half_angle = a.half_angle.unwrap_or(45.0);
            let speed = a.speed.unwrap_or(500.0);
            let is_halo = half_angle >= 45.0;

            NormalizedKinematics {
                version,
                measured_at,
                speed_kms: speed,
                half_angle_deg: half_angle,
                direction: NormalizedDirection {
                    lon_deg: lon,
                    lat_deg: lat,
                },
                cme_type: if a.cme_type.is_empty() {
                    None
                } else {
                    Some(a.cme_type.clone())
                },
                measurement_technique: a.level_of_data.clone(),
                is_halo,
                is_most_accurate: a.is_most_accurate,
            }
        })
        .collect();

    // --- earth-bound score ---
    let earth_bound_score = if let Some(ref last_k) = kinematics.last() {
        compute_earth_bound_score(
            last_k.direction.lon_deg,
            last_k.direction.lat_deg,
            last_k.half_angle_deg,
            last_k.is_halo,
        )
    } else if let Some(ref sr) = source_region {
        compute_earth_bound_score(sr.lon_deg, sr.lat_deg, 45.0, false)
    } else {
        0.0
    };

    // --- build link edges ---
    let mut links: Vec<NormalizedLink> = Vec::new();
    for le in &cme.linked_events {
        if let Ok(linked_id) = donki_activity_to_event_id(&le.activity_id) {
            // CME is caused_by flare; CME causes IPS/GST
            let rel = if linked_id.contains("-FLR-") {
                "caused_by"
            } else {
                "associated"
            };
            links.push(NormalizedLink {
                id: linked_id,
                rel: rel.to_string(),
            });
        }
    }

    let detected_at = cme.start_time.clone();
    let first_seen_at = as_of.to_string();

    Ok(NormalizedEvent {
        schema_version: "1.0.0".to_string(),
        id: event_id,
        uuid,
        event_type: "CME".to_string(),
        detected_at,
        peak_at: None,
        liftoff_at: Some(cme.start_time),
        source_region,
        kinematics,
        flare: None,
        earth_bound_score,
        links,
        predictions: vec![],
        outcome: None,
        provenance: NormalizedProvenance {
            catalog: "DONKI".to_string(),
            donki_activity_id: Some(cme.activity_id),
            first_seen_at,
            as_of: as_of.to_string(),
        },
    })
}

/// Parse a raw DONKI FLR JSON string into a single normalized event.
pub fn parse_flr(flr_json: &str, as_of: &str) -> Result<NormalizedEvent, String> {
    let flr: DonkiFlr =
        serde_json::from_str(flr_json).map_err(|e| format!("FLR parse error: {e}"))?;

    let event_id = donki_activity_to_event_id(&flr.flr_id)?;
    let uuid = make_deterministic_uuid(&event_id);

    // Flares have no kinematics — empty array
    let kinematics: Vec<NormalizedKinematics> = Vec::new();

    let source_region = parse_source_location(
        flr.source_location.as_deref(),
        flr.active_region_num,
        flr.instruments.first().map(|s| s.as_str()),
    );

    // Build flare info
    let flare = Some(NormalizedFlare {
        class: flr.class_type.clone(),
        xray_peak_wm2: None, // DONKI FLR doesn't carry flux in W/m²
    });

    // --- build link edges ---
    let mut links: Vec<NormalizedLink> = Vec::new();
    for le in &flr.linked_events {
        if let Ok(linked_id) = donki_activity_to_event_id(&le.activity_id) {
            // FLR causes CME, IPS, SEP
            let rel = if linked_id.contains("-CME-") {
                "causes"
            } else if linked_id.contains("-IPS-") || linked_id.contains("-SEP-") {
                "causes"
            } else {
                "associated"
            };
            links.push(NormalizedLink {
                id: linked_id,
                rel: rel.to_string(),
            });
        }
    }

    let first_seen_at = as_of.to_string();

    Ok(NormalizedEvent {
        schema_version: "1.0.0".to_string(),
        id: event_id,
        uuid,
        event_type: "FLR".to_string(),
        detected_at: flr.begin_time.clone(),
        peak_at: Some(flr.peak_time),
        liftoff_at: None,
        source_region,
        kinematics,
        flare,
        earth_bound_score: 0.0, // flares don't carry an earth-bound score
        links,
        predictions: vec![],
        outcome: None,
        provenance: NormalizedProvenance {
            catalog: "DONKI".to_string(),
            donki_activity_id: Some(flr.flr_id),
            first_seen_at,
            as_of: as_of.to_string(),
        },
    })
}

/// Batch-parse: given CME and FLR arrays, plus CMEAnalysis entries keyed by CME activity ID,
/// produce all normalized events with cross-links populated.
///
/// This is the main entry for a cron poll loop pulling a window from DONKI.
pub fn parse_batch(
    cmes_json: &str,
    flrs_json: &str,
    analyses_by_cme: &std::collections::HashMap<String, Vec<DonkiCmeAnalysis>>,
    as_of: &str,
) -> Result<Vec<NormalizedEvent>, String> {
    let mut events: Vec<NormalizedEvent> = Vec::new();

    // Parse CMEs
    let cmes: Vec<DonkiCme> =
        serde_json::from_str(cmes_json).map_err(|e| format!("CME batch parse error: {e}"))?;
    for cme in &cmes {
        let analyses = analyses_by_cme
            .get(&cme.activity_id)
            .cloned()
            .unwrap_or_default();
        let cme_json =
            serde_json::to_string(cme).map_err(|e| format!("CME re-serialize error: {e}"))?;
        events.push(parse_cme(&cme_json, &analyses, as_of)?);
    }

    // Parse FLRs
    let flrs: Vec<DonkiFlr> =
        serde_json::from_str(flrs_json).map_err(|e| format!("FLR batch parse error: {e}"))?;
    for flr in &flrs {
        let flr_json =
            serde_json::to_string(flr).map_err(|e| format!("FLR re-serialize error: {e}"))?;
        events.push(parse_flr(&flr_json, as_of)?);
    }

    // Sort by detected_at
    events.sort_by(|a, b| a.detected_at.cmp(&b.detected_at));

    Ok(events)
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Convert a DONKI activity ID like "2026-06-04T07:31:00-CME-001"
/// into our canonical event ID "2026-06-04T07:31Z-CME-001".
/// The difference: DONKI uses `:00` before the type tag; we use `Z`.
fn donki_activity_to_event_id(activity_id: &str) -> Result<String, String> {
    // Expected format: YYYY-MM-DDThh:mm:ss-TYPE-NNN
    let parts: Vec<&str> = activity_id.splitn(3, '-').collect();
    if parts.len() < 3 {
        return Err(format!("invalid DONKI activity ID: {activity_id}"));
    }
    // parts[0] = "2026", parts[1] = "06", parts[2] = "04T07:31:00-TYPE-001"
    let date = format!("{}-{}", parts[0], parts[1]); // "2026-06"
                                                     // Split the remainder at the first hyphen after the time
    let rest = parts[2];
    // Find where the time ends (seconds) — the first hyphen after "hh:mm:ss"
    if let Some(idx) = rest
        .find("-CME-")
        .or_else(|| rest.find("-FLR-"))
        .or_else(|| rest.find("-IPS-"))
        .or_else(|| rest.find("-SEP-"))
        .or_else(|| rest.find("-GST-"))
        .or_else(|| rest.find("-FILAMENT-"))
    {
        let time_part = &rest[..idx]; // e.g. "04T07:31:00"
        let type_suffix = &rest[idx..]; // e.g. "-CME-001"
                                        // Replace seconds ":ss" with "Z"
        let date_time = format!("{}-{}", date, time_part);
        // time_part is "DDThh:mm:ss" — strip seconds, append Z
        if let Some(sec_pos) = date_time.rfind(':') {
            let without_sec = &date_time[..sec_pos]; // "2026-06-04T07:31"
            Ok(format!("{without_sec}Z{type_suffix}"))
        } else {
            Ok(format!("{date_time}Z{type_suffix}"))
        }
    } else {
        Err(format!("cannot parse DONKI activity ID: {activity_id}"))
    }
}

/// Parse a "S15W10" or "N18E12" source location string into lon/lat degrees.
/// Stonyhurst convention: lon +west, lat +north.
/// DONKI format: N/S lat, E/W lon — but DONKI E means east (negative in Stonyhurst).
fn parse_source_location(
    loc_str: Option<&str>,
    ar_number: Option<i32>,
    instrument: Option<&str>,
) -> Option<NormalizedSourceRegion> {
    let loc = loc_str?;
    if loc.len() < 4 {
        return None;
    }
    let chars: Vec<char> = loc.chars().collect();

    // Parse latitude: first character is N or S; find where it ends
    let lat_sign: f64 = if chars[0] == 'N' {
        1.0
    } else if chars[0] == 'S' {
        -1.0
    } else {
        return None;
    };
    let lat_start = 1;
    let mut lat_end = lat_start;
    while lat_end < chars.len() && (chars[lat_end].is_ascii_digit() || chars[lat_end] == '.') {
        lat_end += 1;
    }
    if lat_end == lat_start {
        return None;
    }
    let lat_val: f64 = chars[lat_start..lat_end]
        .iter()
        .collect::<String>()
        .parse()
        .ok()?;
    let lat = lat_sign * lat_val;

    // Parse longitude
    if lat_end >= chars.len() {
        return None;
    }
    let lon_sign: f64 = if chars[lat_end] == 'W' {
        1.0 // W = west = + in Stonyhurst
    } else if chars[lat_end] == 'E' {
        -1.0 // E = east = - in Stonyhurst
    } else {
        return None;
    };
    let lon_start = lat_end + 1;
    let lon_str: String = chars[lon_start..].iter().collect();
    let lon_val: f64 = lon_str.parse().ok()?;
    let lon = lon_sign * lon_val;

    Some(NormalizedSourceRegion {
        ar_number,
        lon_deg: lon,
        lat_deg: lat,
        instrument: instrument.map(|s| s.to_string()),
    })
}

/// Compute a geometric earth-bound score (0..1) from apex direction and half-angle.
/// v1 ships the geometric heuristic; calibration is post-v1 (spec §8.5).
fn compute_earth_bound_score(
    lon_deg: f64,
    lat_deg: f64,
    half_angle_deg: f64,
    is_halo: bool,
) -> f64 {
    if is_halo {
        // Halo CME: high confidence of earth-directedness
        // Score degrades if apex is far from disk center
        let dist = (lon_deg.powi(2) + lat_deg.powi(2)).sqrt();
        if dist <= 10.0 {
            return 0.95;
        } else if dist <= 25.0 {
            return 0.85;
        } else {
            return 0.75;
        }
    }

    // Non-halo: how well does the cone cover Earth's helio-longitude?
    let angular_dist = (lon_deg.powi(2) + lat_deg.powi(2)).sqrt();
    let overlap = half_angle_deg - angular_dist;

    if overlap >= 0.0 {
        // Earth is inside the cone
        (0.3 + 0.5 * (overlap / half_angle_deg.max(1.0)).min(1.0)).clamp(0.0, 1.0)
    } else {
        // Earth is outside; partial spillover if close
        let spill = overlap.abs();
        if spill < half_angle_deg * 0.5 {
            (0.3 * (1.0 - spill / (half_angle_deg * 0.5))).max(0.0)
        } else {
            0.0
        }
    }
}

/// Deterministic UUID v5-style hash from an event ID string.
/// Uses the std DefaultHasher for a stable hash across processes.
fn make_deterministic_uuid(id: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    // Namespace prefix to avoid collisions with other UUID uses
    let namespaced = format!("helioverse.event.v1:{id}");
    let mut hasher = DefaultHasher::new();
    namespaced.hash(&mut hasher);
    let h = hasher.finish();

    // Format as UUID v4-style but with deterministic bits
    // Use all 64 bits of hash, spread across the UUID fields
    let a = ((h >> 32) as u32).to_be();
    let b = ((h >> 16) & 0xFFFF) as u16;
    let c = (((h >> 48) & 0x0FFF) | 0x4000) as u16; // version 4 marker
    let d = (((h >> 8) & 0x3FFF) | 0x8000) as u16; // variant 1 marker
    let e = (h & 0xFFFF_FFFF_FFFF) as u64;

    format!("{a:08x}-{b:04x}-{c:04x}-{d:04x}-{e:012x}")
}

// ============================================================================
// Fixture-based tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // --- Representative DONKI API fixtures ---

    /// A CME as returned by DONKI /DONKI/CME endpoint.
    const FIXTURE_CME_HALO: &str = r#"{
        "activityID": "2026-06-04T07:31:00-CME-001",
        "catalog": "M2M_CATALOG",
        "startTime": "2026-06-04T07:31Z",
        "sourceLocation": "N18E12",
        "activeRegionNum": 14120,
        "note": "Halo CME detected by SOHO LASCO C2 and C3 in coronagraph imagery.",
        "instruments": ["SOHO LASCO C2", "SOHO LASCO C3"],
        "linkedEvents": [
            {"activityID": "2026-06-04T07:18:00-FLR-001"}
        ]
    }"#;

    /// A CME without a linked flare (standalone CME).
    const FIXTURE_CME_RESOLVED: &str = r#"{
        "activityID": "2026-05-20T11:12:00-CME-002",
        "catalog": "M2M_CATALOG",
        "startTime": "2026-05-20T11:12Z",
        "sourceLocation": "S14W08",
        "activeRegionNum": 14102,
        "note": "CME visible in LASCO C3.",
        "instruments": ["LASCO/C3"],
        "linkedEvents": [
            {"activityID": "2026-05-23T05:12:00-IPS-001"},
            {"activityID": "2026-05-23T08:00:00-GST-001"}
        ]
    }"#;

    /// An X-class flare from DONKI /DONKI/FLR.
    const FIXTURE_FLR_X: &str = r#"{
        "flrID": "2026-06-04T07:18:00-FLR-001",
        "catalog": "M2M_CATALOG",
        "beginTime": "2026-06-04T07:17Z",
        "peakTime": "2026-06-04T07:31Z",
        "endTime": "2026-06-04T07:45Z",
        "classType": "X1.2",
        "sourceLocation": "N18E12",
        "activeRegionNum": 14120,
        "instruments": ["GOES-16 XRS"],
        "linkedEvents": [
            {"activityID": "2026-06-04T07:31:00-CME-001"}
        ]
    }"#;

    /// An M-class flare.
    const FIXTURE_FLR_M: &str = r#"{
        "flrID": "2026-05-20T10:08:00-FLR-002",
        "catalog": "M2M_CATALOG",
        "beginTime": "2026-05-20T10:00Z",
        "peakTime": "2026-05-20T10:08Z",
        "endTime": "2026-05-20T10:18Z",
        "classType": "M5.4",
        "sourceLocation": "S14W08",
        "activeRegionNum": 14102,
        "instruments": ["GOES-16 XRS"],
        "linkedEvents": [
            {"activityID": "2026-05-20T11:12:00-CME-002"}
        ]
    }"#;

    /// CMEAnalysis entries for the halo CME (version 1).
    fn analyses_halo_v1() -> DonkiCmeAnalysis {
        DonkiCmeAnalysis {
            time21_5: Some("2026-06-04T09:40Z".to_string()),
            latitude: Some(15.0),
            longitude: Some(-10.0),
            half_angle: Some(42.0),
            speed: Some(1250.0),
            cme_type: "O".to_string(),
            is_most_accurate: false,
            level_of_data: Some("SWPC_CAT".to_string()),
            note: String::new(),
        }
    }

    /// CMEAnalysis entries for the halo CME (version 2, most accurate).
    fn analyses_halo_v2() -> DonkiCmeAnalysis {
        DonkiCmeAnalysis {
            time21_5: Some("2026-06-04T13:05Z".to_string()),
            latitude: Some(16.0),
            longitude: Some(-12.0),
            half_angle: Some(48.0),
            speed: Some(1350.0),
            cme_type: "O".to_string(),
            is_most_accurate: true,
            level_of_data: Some("LE".to_string()),
            note: String::new(),
        }
    }

    /// CMEAnalysis for the resolved CME.
    fn analyses_resolved_v1() -> DonkiCmeAnalysis {
        DonkiCmeAnalysis {
            time21_5: Some("2026-05-20T14:50Z".to_string()),
            latitude: Some(-12.0),
            longitude: Some(6.0),
            half_angle: Some(38.0),
            speed: Some(880.0),
            cme_type: "C".to_string(),
            is_most_accurate: true,
            level_of_data: Some("LE".to_string()),
            note: String::new(),
        }
    }

    // ========================================================================
    // Tests
    // ========================================================================

    #[test]
    fn test_activity_id_to_event_id() {
        // Standard CME
        let id = donki_activity_to_event_id("2026-06-04T07:31:00-CME-001").unwrap();
        assert_eq!(id, "2026-06-04T07:31Z-CME-001");

        // FLR
        let id = donki_activity_to_event_id("2026-06-04T07:18:00-FLR-001").unwrap();
        assert_eq!(id, "2026-06-04T07:18Z-FLR-001");

        // IPS
        let id = donki_activity_to_event_id("2026-05-23T05:12:00-IPS-001").unwrap();
        assert_eq!(id, "2026-05-23T05:12Z-IPS-001");

        // GST
        let id = donki_activity_to_event_id("2026-05-23T08:00:00-GST-001").unwrap();
        assert_eq!(id, "2026-05-23T08:00Z-GST-001");

        // Error on garbage
        assert!(donki_activity_to_event_id("garbage").is_err());
    }

    #[test]
    fn test_uuid_deterministic() {
        let uuid1 = make_deterministic_uuid("2026-06-04T07:31Z-CME-001");
        let uuid2 = make_deterministic_uuid("2026-06-04T07:31Z-CME-001");
        let uuid3 = make_deterministic_uuid("2026-06-04T07:18Z-FLR-001");

        // Same input → same output
        assert_eq!(uuid1, uuid2);
        // Different input → different output
        assert_ne!(uuid1, uuid3);
        // Must look like a UUID
        assert_eq!(uuid1.len(), 36);
        assert_eq!(uuid1.chars().filter(|&c| c == '-').count(), 4);
    }

    #[test]
    fn test_parse_source_location() {
        // N18E12 — north 18°, east 12° (east = negative in Stonyhurst)
        let sr = parse_source_location(Some("N18E12"), Some(14120), Some("LASCO/C2")).unwrap();
        assert_eq!(sr.lat_deg, 18.0);
        assert_eq!(sr.lon_deg, -12.0);
        assert_eq!(sr.ar_number, Some(14120));
        assert_eq!(sr.instrument.as_deref(), Some("LASCO/C2"));

        // S14W08 — south 14°, west 8° (west = positive in Stonyhurst)
        let sr = parse_source_location(Some("S14W08"), Some(14102), None).unwrap();
        assert_eq!(sr.lat_deg, -14.0);
        assert_eq!(sr.lon_deg, 8.0);
        assert_eq!(sr.ar_number, Some(14102));
        assert!(sr.instrument.is_none());

        // Edge: near disk center
        let sr = parse_source_location(Some("N02E01"), None, None).unwrap();
        assert_eq!(sr.lat_deg, 2.0);
        assert_eq!(sr.lon_deg, -1.0);

        // Edge: limb at west
        let sr = parse_source_location(Some("S30W90"), None, None).unwrap();
        assert_eq!(sr.lat_deg, -30.0);
        assert_eq!(sr.lon_deg, 90.0);

        // Invalid
        assert!(parse_source_location(Some("X10Y20"), None, None).is_none());
        assert!(parse_source_location(None, None, None).is_none());
        assert!(parse_source_location(Some(""), None, None).is_none());
    }

    #[test]
    fn test_earth_bound_score() {
        // Halo CME near disk center — highest score
        let score = compute_earth_bound_score(0.0, 0.0, 50.0, true);
        assert!(score > 0.9);

        // Halo CME slightly off-center
        let score = compute_earth_bound_score(-12.0, 16.0, 48.0, true);
        assert!(score > 0.8);

        // Non-halo with Earth inside cone
        let score = compute_earth_bound_score(-10.0, 15.0, 42.0, false);
        assert!(score > 0.5);

        // Limb CME — very low score
        let score = compute_earth_bound_score(80.0, 0.0, 30.0, false);
        assert_eq!(score, 0.0);

        // Far side — zero
        let score = compute_earth_bound_score(120.0, 20.0, 45.0, false);
        assert_eq!(score, 0.0);
    }

    #[test]
    fn test_parse_cme_halo_with_analyses() {
        let analyses = vec![analyses_halo_v1(), analyses_halo_v2()];
        let event = parse_cme(FIXTURE_CME_HALO, &analyses, "2026-06-04T14:00Z").unwrap();

        // --- identity ---
        assert_eq!(event.schema_version, "1.0.0");
        assert_eq!(event.id, "2026-06-04T07:31Z-CME-001");
        assert_eq!(event.event_type, "CME");
        assert_eq!(event.detected_at, "2026-06-04T07:31Z");
        assert_eq!(event.liftoff_at.as_deref(), Some("2026-06-04T07:31Z"));
        assert_eq!(event.uuid.len(), 36);

        // --- source region ---
        let sr = event.source_region.as_ref().unwrap();
        assert_eq!(sr.lon_deg, -12.0);
        assert_eq!(sr.lat_deg, 18.0);
        assert_eq!(sr.ar_number, Some(14120));

        // --- kinematics (2 versions) ---
        assert_eq!(event.kinematics.len(), 2);

        let k1 = &event.kinematics[0];
        assert_eq!(k1.version, 1);
        assert_eq!(k1.measured_at, "2026-06-04T09:40Z");
        assert_eq!(k1.speed_kms, 1250.0);
        assert_eq!(k1.half_angle_deg, 42.0);
        assert_eq!(k1.direction.lon_deg, -10.0);
        assert_eq!(k1.direction.lat_deg, 15.0);
        assert_eq!(k1.cme_type.as_deref(), Some("O"));
        assert_eq!(k1.measurement_technique.as_deref(), Some("SWPC_CAT"));
        assert!(!k1.is_most_accurate);
        assert!(!k1.is_halo); // half_angle 42 < 45 threshold

        let k2 = &event.kinematics[1];
        assert_eq!(k2.version, 2);
        assert_eq!(k2.measured_at, "2026-06-04T13:05Z");
        assert_eq!(k2.speed_kms, 1350.0);
        assert_eq!(k2.half_angle_deg, 48.0);
        assert_eq!(k2.direction.lon_deg, -12.0);
        assert_eq!(k2.direction.lat_deg, 16.0);
        assert_eq!(k2.cme_type.as_deref(), Some("O"));
        assert_eq!(k2.measurement_technique.as_deref(), Some("LE"));
        assert!(k2.is_most_accurate);
        assert!(k2.is_halo); // half_angle 48 >= 45

        // --- links ---
        assert_eq!(event.links.len(), 1);
        assert_eq!(event.links[0].id, "2026-06-04T07:18Z-FLR-001");
        assert_eq!(event.links[0].rel, "caused_by");

        // --- earth bound score ---
        assert!(event.earth_bound_score > 0.0);

        // --- provenance ---
        assert_eq!(event.provenance.catalog, "DONKI");
        assert_eq!(
            event.provenance.donki_activity_id.as_deref(),
            Some("2026-06-04T07:31:00-CME-001")
        );
        assert_eq!(event.provenance.as_of, "2026-06-04T14:00Z");

        // --- no flare on a CME ---
        assert!(event.flare.is_none());

        // --- predictions and outcome are empty for ingest ---
        assert!(event.predictions.is_empty());
        assert!(event.outcome.is_none());
    }

    #[test]
    fn test_parse_cme_resolved_with_analyses() {
        let analyses = vec![analyses_resolved_v1()];
        let event = parse_cme(FIXTURE_CME_RESOLVED, &analyses, "2026-05-24T06:00Z").unwrap();

        assert_eq!(event.id, "2026-05-20T11:12Z-CME-002");
        assert_eq!(event.event_type, "CME");
        assert_eq!(event.detected_at, "2026-05-20T11:12Z");

        let sr = event.source_region.as_ref().unwrap();
        assert_eq!(sr.lat_deg, -14.0);
        assert_eq!(sr.lon_deg, 8.0);

        // One kinematics version
        assert_eq!(event.kinematics.len(), 1);
        let k = &event.kinematics[0];
        assert_eq!(k.version, 1);
        assert_eq!(k.speed_kms, 880.0);
        assert_eq!(k.half_angle_deg, 38.0);
        assert!(k.is_most_accurate);
        assert!(!k.is_halo);

        // Links to IPS and GST
        assert_eq!(event.links.len(), 2);
        assert!(event
            .links
            .iter()
            .any(|l| l.id == "2026-05-23T05:12Z-IPS-001"));
        assert!(event
            .links
            .iter()
            .any(|l| l.id == "2026-05-23T08:00Z-GST-001"));
    }

    #[test]
    fn test_parse_cme_no_analyses() {
        // CME with no CMEAnalysis yet — should still produce valid event
        let analyses: Vec<DonkiCmeAnalysis> = vec![];
        let event = parse_cme(FIXTURE_CME_HALO, &analyses, "2026-06-04T08:10Z").unwrap();

        assert_eq!(event.id, "2026-06-04T07:31Z-CME-001");
        assert!(event.kinematics.is_empty()); // no analysis = no kinematics
        assert!(event.earth_bound_score >= 0.0); // falls back to source region heuristic
    }

    #[test]
    fn test_parse_flr_x_class() {
        let event = parse_flr(FIXTURE_FLR_X, "2026-06-04T08:00Z").unwrap();

        assert_eq!(event.schema_version, "1.0.0");
        assert_eq!(event.id, "2026-06-04T07:18Z-FLR-001");
        assert_eq!(event.event_type, "FLR");
        assert_eq!(event.detected_at, "2026-06-04T07:17Z");
        assert_eq!(event.peak_at.as_deref(), Some("2026-06-04T07:31Z"));
        assert!(event.liftoff_at.is_none());

        // Source region
        let sr = event.source_region.as_ref().unwrap();
        assert_eq!(sr.lat_deg, 18.0);
        assert_eq!(sr.lon_deg, -12.0);
        assert_eq!(sr.ar_number, Some(14120));

        // Flare info
        let flare = event.flare.as_ref().unwrap();
        assert_eq!(flare.class, "X1.2");
        assert!(flare.xray_peak_wm2.is_none()); // DONKI doesn't provide this

        // No kinematics for flares
        assert!(event.kinematics.is_empty());

        // Link: FLR causes CME
        assert_eq!(event.links.len(), 1);
        assert_eq!(event.links[0].id, "2026-06-04T07:31Z-CME-001");
        assert_eq!(event.links[0].rel, "causes");

        // Flares have earth_bound_score 0
        assert_eq!(event.earth_bound_score, 0.0);
    }

    #[test]
    fn test_parse_flr_m_class() {
        let event = parse_flr(FIXTURE_FLR_M, "2026-05-20T12:00Z").unwrap();

        assert_eq!(event.id, "2026-05-20T10:08Z-FLR-002");
        assert_eq!(event.event_type, "FLR");
        assert_eq!(event.detected_at, "2026-05-20T10:00Z");
        assert_eq!(event.peak_at.as_deref(), Some("2026-05-20T10:08Z"));

        let flare = event.flare.as_ref().unwrap();
        assert_eq!(flare.class, "M5.4");

        let sr = event.source_region.as_ref().unwrap();
        assert_eq!(sr.lat_deg, -14.0);
        assert_eq!(sr.lon_deg, 8.0);

        // FLR causes CME
        assert_eq!(event.links.len(), 1);
        assert_eq!(event.links[0].id, "2026-05-20T11:12Z-CME-002");
        assert_eq!(event.links[0].rel, "causes");
    }

    #[test]
    fn test_parse_batch_cme_and_flr() {
        // Build analyses map
        let mut analyses_by_cme: HashMap<String, Vec<DonkiCmeAnalysis>> = HashMap::new();
        analyses_by_cme.insert(
            "2026-06-04T07:31:00-CME-001".to_string(),
            vec![analyses_halo_v1(), analyses_halo_v2()],
        );
        analyses_by_cme.insert(
            "2026-05-20T11:12:00-CME-002".to_string(),
            vec![analyses_resolved_v1()],
        );

        // Batch of CMEs and FLRs as DONKI array responses
        let cmes_json = format!("[{FIXTURE_CME_HALO},{FIXTURE_CME_RESOLVED}]");
        let flrs_json = format!("[{FIXTURE_FLR_X},{FIXTURE_FLR_M}]");

        let events = parse_batch(
            &cmes_json,
            &flrs_json,
            &analyses_by_cme,
            "2026-06-04T14:00Z",
        )
        .unwrap();

        assert_eq!(events.len(), 4);

        // Sorted by detected_at
        let ids: Vec<&str> = events.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "2026-05-20T10:08Z-FLR-002",
                "2026-05-20T11:12Z-CME-002",
                "2026-06-04T07:18Z-FLR-001",
                "2026-06-04T07:31Z-CME-001",
            ]
        );

        // Spot-check: first FLR has correct flare class
        assert_eq!(events[0].event_type, "FLR");
        assert_eq!(events[0].flare.as_ref().unwrap().class, "M5.4");

        // Spot-check: first CME has 1 kinematics, second has 2
        assert_eq!(events[1].kinematics.len(), 1);
        assert_eq!(events[3].kinematics.len(), 2);
    }

    #[test]
    fn test_parse_cme_serializes_to_event_schema_shape() {
        let analyses = vec![analyses_halo_v1(), analyses_halo_v2()];
        let event = parse_cme(FIXTURE_CME_HALO, &analyses, "2026-06-04T14:00Z").unwrap();
        let json = serde_json::to_value(&event).unwrap();

        // Required fields present
        assert_eq!(json["schema_version"], "1.0.0");
        assert_eq!(json["id"], "2026-06-04T07:31Z-CME-001");
        assert!(json["uuid"].as_str().unwrap().len() == 36);
        assert_eq!(json["type"], "CME");
        assert_eq!(json["detected_at"], "2026-06-04T07:31Z");
        assert!(json["kinematics"].is_array());
        assert!(json["earth_bound_score"].is_f64());
        assert!(json["links"].is_array());
        assert!(json["predictions"].is_array());
        assert!(json["provenance"]["catalog"] == "DONKI");

        // kinematics version ordering: oldest first
        let kin_array = json["kinematics"].as_array().unwrap();
        assert_eq!(kin_array.len(), 2);
        assert_eq!(kin_array[0]["version"], 1);
        assert_eq!(kin_array[1]["version"], 2);
        assert!(!kin_array[0]["is_most_accurate"].as_bool().unwrap());
        assert!(kin_array[1]["is_most_accurate"].as_bool().unwrap());

        // kinematics 2 is halo
        assert!(kin_array[1]["is_halo"].as_bool().unwrap());
    }

    #[test]
    fn test_parse_flr_serializes_to_event_schema_shape() {
        let event = parse_flr(FIXTURE_FLR_X, "2026-06-04T08:00Z").unwrap();
        let json = serde_json::to_value(&event).unwrap();

        assert_eq!(json["type"], "FLR");
        assert_eq!(json["flare"]["class"], "X1.2");
        // FLR has peak_at
        assert_eq!(json["peak_at"], "2026-06-04T07:31Z");
        // No liftoff for FLR
        assert!(json.get("liftoff_at").is_none() || json["liftoff_at"].is_null());
        // Empty kinematics
        assert_eq!(json["kinematics"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_parse_cme_invalid_json() {
        let analyses: Vec<DonkiCmeAnalysis> = vec![];
        assert!(parse_cme("not json", &analyses, "now").is_err());
        assert!(parse_cme("{}", &analyses, "now").is_err()); // missing required fields
    }

    #[test]
    fn test_parse_flr_invalid_json() {
        assert!(parse_flr("not json", "now").is_err());
        assert!(parse_flr("{}", "now").is_err());
    }
}
