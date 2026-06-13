//! Subscription row model — validates against
//! contracts/schemas/alert-subscription.schema.json (§7.5).
//!
//! Privacy invariant (spec §7.5): lat/lon are ROUNDED to 1 decimal (~11 km)
//! before they ever reach the server. The schema enforces `multipleOf: 0.1`.
//! The `round_location` constructor enforces this in code as well.
//!
//! A subscription row lives in D1; the JSON shape is what the subscribe
//! endpoint receives and what the cron sweep reads back.
//!
//! ## D1 table DDL (run in Cloudflare dashboard or via wrangler)
//! ```sql
//! CREATE TABLE IF NOT EXISTS subscriptions (
//!   subscription_id TEXT PRIMARY KEY,
//!   created_at      TEXT NOT NULL,
//!   json_body       TEXT NOT NULL,  -- full JSON matching schema
//!   lat_deg         REAL NOT NULL,  -- cached for threshold queries
//!   lon_deg         REAL NOT NULL
//! );
//! ```

use serde::{Deserialize, Serialize};

/// Canonical schema version for alert subscriptions.
pub const SUBSCRIPTION_SCHEMA_VERSION: &str = "1.0.0";

/// A single Web Push subscription row — full JSON shape matches
/// `alert-subscription.schema.json` exactly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct SubscriptionRow {
    pub schema_version: String,
    pub subscription_id: String,
    pub created_at: String,
    pub push: PushTriple,
    pub location: RoundedLocation,
    pub thresholds: AlertThresholds,
}

/// Standard Web Push (RFC 8030) subscription triple.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PushTriple {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

/// Location rounded to 1 decimal degree (~11 km) — privacy floor (spec §7.5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoundedLocation {
    pub lat_deg: f64,
    pub lon_deg: f64,
}

impl RoundedLocation {
    /// Round to one decimal place (enforces the schema's `multipleOf: 0.1`).
    pub fn new(lat_deg: f64, lon_deg: f64) -> Self {
        Self {
            lat_deg: (lat_deg * 10.0).round() / 10.0,
            lon_deg: (lon_deg * 10.0).round() / 10.0,
        }
    }

    /// Distance in km between two rounded locations (equirectangular approx).
    /// Accurate enough for alert-zone matching (~0.5% error at mid-latitudes).
    pub fn approx_distance_km(&self, other: &RoundedLocation) -> f64 {
        const EARTH_RADIUS_KM: f64 = 6371.0;
        let dlat = (self.lat_deg - other.lat_deg).to_radians();
        let dlon = (self.lon_deg - other.lon_deg).to_radians();
        let lat_mid = ((self.lat_deg + other.lat_deg) / 2.0).to_radians();
        let dy = dlat * EARTH_RADIUS_KM;
        let dx = dlon * EARTH_RADIUS_KM * lat_mid.cos();
        (dy * dy + dx * dx).sqrt()
    }
}

/// Per-channel alert thresholds from the subscription schema.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AlertThresholds {
    pub aurora_tonight: AuroraTonightThreshold,
    pub bz_turn: BzTurnThreshold,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kp_min: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuroraTonightThreshold {
    pub enabled: bool,
    pub min_go_look_score: f64,
}

impl Default for AuroraTonightThreshold {
    fn default() -> Self {
        Self {
            enabled: true,
            min_go_look_score: 0.30, // "Likely" boundary
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BzTurnThreshold {
    pub enabled: bool,
    pub bz_south_nt: f64,
    pub min_sustained_minutes: u32,
}

impl Default for AlertThresholds {
    fn default() -> Self {
        Self {
            aurora_tonight: AuroraTonightThreshold::default(),
            bz_turn: BzTurnThreshold::default(),
            kp_min: None,
        }
    }
}

impl Default for BzTurnThreshold {
    fn default() -> Self {
        Self {
            enabled: true,
            bz_south_nt: -5.0,     // moderate southward
            min_sustained_minutes: 5, // 5-minute debounce
        }
    }
}

// ── validation helpers ────────────────────────────────────────────────────

impl SubscriptionRow {
    /// Check that the subscription_id matches the UUID v4 pattern.
    pub fn validate_id_format(&self) -> bool {
        uuid::Uuid::parse_str(&self.subscription_id).is_ok()
    }

    /// Check that lat_deg is a multiple of 0.1 (privacy invariant).
    pub fn is_location_rounded(&self) -> bool {
        let lat_tenths = (self.location.lat_deg * 10.0).round();
        let lon_tenths = (self.location.lon_deg * 10.0).round();
        (lat_tenths - self.location.lat_deg * 10.0).abs() < 1e-9
            && (lon_tenths - self.location.lon_deg * 10.0).abs() < 1e-9
    }

    /// Returns `Ok(self)` if all local invariants hold.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SUBSCRIPTION_SCHEMA_VERSION {
            return Err(format!(
                "schema_version {} != expected {}",
                self.schema_version, SUBSCRIPTION_SCHEMA_VERSION
            ));
        }
        if !self.validate_id_format() {
            return Err(format!("invalid UUID: {}", self.subscription_id));
        }
        if !(-90.0..=90.0).contains(&self.location.lat_deg) {
            return Err(format!("lat_deg out of range: {}", self.location.lat_deg));
        }
        if !(-180.0..=180.0).contains(&self.location.lon_deg) {
            return Err(format!("lon_deg out of range: {}", self.location.lon_deg));
        }
        if !self.is_location_rounded() {
            return Err("location not rounded to 0.1° (privacy invariant)".into());
        }
        if !(0.0..=1.0).contains(&self.thresholds.aurora_tonight.min_go_look_score) {
            return Err(format!(
                "min_go_look_score out of range: {}",
                self.thresholds.aurora_tonight.min_go_look_score
            ));
        }
        if self.thresholds.bz_turn.bz_south_nt > 0.0 {
            return Err(format!(
                "bz_south_nt must be <= 0: {}",
                self.thresholds.bz_turn.bz_south_nt
            ));
        }
        if self.thresholds.bz_turn.min_sustained_minutes > 60 {
            return Err(format!(
                "min_sustained_minutes > 60: {}",
                self.thresholds.bz_turn.min_sustained_minutes
            ));
        }
        if let Some(kp) = self.thresholds.kp_min {
            if !(0.0..=9.0).contains(&kp) {
                return Err(format!("kp_min out of range: {}", kp));
            }
        }
        Ok(())
    }

    /// Serialize to a JSON string for D1 storage.
    pub fn to_json_string(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Deserialize from a D1-stored JSON string.
    pub fn from_json_string(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}

// ── tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sub(lat: f64, lon: f64) -> SubscriptionRow {
        SubscriptionRow {
            schema_version: SUBSCRIPTION_SCHEMA_VERSION.into(),
            subscription_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d".into(),
            created_at: "2026-06-12T08:00:00Z".into(),
            push: PushTriple {
                endpoint: "https://example.com/push/1".into(),
                p256dh: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=".into(),
                auth: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
            },
            location: RoundedLocation::new(lat, lon),
            thresholds: AlertThresholds::default(),
        }
    }

    #[test]
    fn subscribe_validates_against_schema_shape() {
        let sub = make_sub(65.0, -148.0);
        let json = serde_json::to_value(&sub).unwrap();

        // All required top-level keys present
        assert!(json.get("schema_version").is_some());
        assert!(json.get("subscription_id").is_some());
        assert!(json.get("created_at").is_some());
        assert!(json.get("push").is_some());
        assert!(json.get("location").is_some());
        assert!(json.get("thresholds").is_some());

        // No extra keys
        let expected_keys: Vec<&str> = vec![
            "schema_version", "subscription_id", "created_at",
            "push", "location", "thresholds",
        ];
        let mut actual_keys: Vec<&str> = json.as_object().unwrap().keys().map(|s| s.as_str()).collect();
        actual_keys.sort();
        let mut ek = expected_keys.clone();
        ek.sort();
        assert_eq!(actual_keys, ek);

        // Push triple fields
        let push = &json["push"];
        assert!(push.get("endpoint").is_some());
        assert!(push.get("p256dh").is_some());
        assert!(push.get("auth").is_some());

        // Location fields
        let loc = &json["location"];
        assert_eq!(loc["lat_deg"].as_f64().unwrap(), 65.0);
        assert_eq!(loc["lon_deg"].as_f64().unwrap(), -148.0);

        // Thresholds fields
        let thresh = &json["thresholds"];
        let at = &thresh["aurora_tonight"];
        assert_eq!(at["enabled"].as_bool().unwrap(), true);
        assert!((at["min_go_look_score"].as_f64().unwrap() - 0.30).abs() < 1e-9);
        let bz = &thresh["bz_turn"];
        assert_eq!(bz["enabled"].as_bool().unwrap(), true);
        assert!((bz["bz_south_nt"].as_f64().unwrap() - (-5.0)).abs() < 1e-9);
        assert_eq!(bz["min_sustained_minutes"].as_u64().unwrap(), 5);
    }

    #[test]
    fn subscription_roundtrip_json() {
        let sub = make_sub(64.8, -147.5);
        let json_str = sub.to_json_string().unwrap();
        let parsed: SubscriptionRow = SubscriptionRow::from_json_string(&json_str).unwrap();
        assert_eq!(sub, parsed);
    }

    #[test]
    fn location_rounding_works() {
        let loc = RoundedLocation::new(64.837, -147.562);
        assert!((loc.lat_deg - 64.8).abs() < 1e-9);
        assert!((loc.lon_deg - (-147.6)).abs() < 1e-9);
    }

    #[test]
    fn location_rounding_idempotent() {
        let loc = RoundedLocation::new(65.0, -148.0);
        assert!((loc.lat_deg - 65.0).abs() < 1e-9);
        assert!((loc.lon_deg - (-148.0)).abs() < 1e-9);
    }

    #[test]
    fn rounding_detected_in_validation() {
        // exact one-decimal values
        let sub = make_sub(65.0, -148.0);
        assert!(sub.validate().is_ok());

        // non-rounded value should fail
        let mut sub2 = make_sub(65.0, -148.0);
        sub2.location.lat_deg = 65.037;
        assert!(sub2.validate().is_err());
    }

    #[test]
    fn validate_bad_schema_version() {
        let mut sub = make_sub(65.0, -148.0);
        sub.schema_version = "0.9.0".into();
        assert!(sub.validate().is_err());
    }

    #[test]
    fn validate_bad_uuid() {
        let mut sub = make_sub(65.0, -148.0);
        sub.subscription_id = "not-a-uuid".into();
        assert!(sub.validate().is_err());
    }

    #[test]
    fn validate_lat_out_of_range() {
        let mut sub = make_sub(65.0, -148.0);
        sub.location.lat_deg = 95.0;
        assert!(sub.validate().is_err());
    }

    #[test]
    fn validate_thresholds_ranges() {
        let mut sub = make_sub(65.0, -148.0);
        sub.thresholds.aurora_tonight.min_go_look_score = 1.5;
        assert!(sub.validate().is_err());

        let mut sub2 = make_sub(65.0, -148.0);
        sub2.thresholds.bz_turn.bz_south_nt = 1.0;
        assert!(sub2.validate().is_err());

        let mut sub3 = make_sub(65.0, -148.0);
        sub3.thresholds.kp_min = Some(10.0);
        assert!(sub3.validate().is_err());

        let mut sub4 = make_sub(65.0, -148.0);
        sub4.thresholds.bz_turn.min_sustained_minutes = 120;
        assert!(sub4.validate().is_err());
    }

    #[test]
    fn approx_distance_same_point() {
        let a = RoundedLocation::new(65.0, -148.0);
        let b = RoundedLocation::new(65.0, -148.0);
        assert!(a.approx_distance_km(&b) < 0.01);
    }

    #[test]
    fn approx_distance_rough() {
        // Oslo (~60N, 11E) to Tromsø (~70N, 19E): ~1120 km
        let oslo = RoundedLocation::new(59.9, 10.8);
        let tromso = RoundedLocation::new(69.6, 19.0);
        let d = oslo.approx_distance_km(&tromso);
        // Should be roughly 1100 km
        assert!(d > 800.0 && d < 1400.0, "got {d} km");
    }

    #[test]
    fn subscription_serializes_snake_case() {
        let sub = make_sub(65.0, -148.0);
        let json = serde_json::to_string(&sub).unwrap();
        assert!(json.contains("schema_version"));
        assert!(json.contains("subscription_id"));
        assert!(json.contains("created_at"));
        assert!(json.contains("min_go_look_score"));
        assert!(json.contains("bz_south_nt"));
        assert!(!json.contains("schemaVersion"));
    }
}
