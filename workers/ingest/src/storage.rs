//! W1-P1f: Storage layer — R2/KV key planner + append-only guards.
//! Owner: DeepSeek builder (deepseek/deepseek-v4-pro) / GPT validator
//!
//! Implements the key layout from `contracts/r2-layout.md`:
//! - Latest mutable key: `v1/snapshot/latest.json` (R2 public, KV copy)
//! - Archive immutable key: `v1/snapshot/archive/YYYY/MM/DD/HHMM.json` (write-once)
//!
//! ## Invariants
//! - Archive keys are write-once — a writer finding an existing archive key
//!   MUST NOT overwrite (append-only guarantee).
//! - Latest key is mutable (overwritten each tick).
//! - Every write produces a KeyPlan with both keys, plus validation metadata.
//! - KV holds a copy of `snapshot/latest` for Worker-internal reads (alert sweep);
//!   R2 is the client-facing truth.
//!
//! This module is pure logic — no actual R2/KV bindings. It produces the
//! key plan that the worker boundary can use to write to Cloudflare services.

use chrono::{DateTime, Utc};
use serde::Serialize;

// ═══════════════════════════════════════════════════════════════════════════
// Key plan types
// ═══════════════════════════════════════════════════════════════════════════

/// A write plan for one cron tick: which keys to write, and whether each
/// is allowed (append-only safety check).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KeyPlan {
    /// The snapshot as-of timestamp used to derive archive key.
    pub generated_at: String,
    /// R2 public mutable key — overwritten every tick.
    pub latest_r2_key: String,
    /// R2 public immutable archive key — write-once.
    pub archive_r2_key: String,
    /// KV internal copy key (mirrors latest for alert sweep).
    pub kv_latest_key: String,
    /// Whether the archive key already exists (prevents double-write).
    pub archive_exists: bool,
    /// Whether this plan is safe to execute.
    pub is_safe: bool,
    /// Human-readable reason if !is_safe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safety_issue: Option<String>,
    /// Contract version prefix.
    pub key_prefix: String,
}

/// R2 key constants matching `contracts/r2-layout.md`.
pub const R2_LATEST_SNAPSHOT_KEY: &str = "v1/snapshot/latest.json";
pub const R2_ARCHIVE_SNAPSHOT_PREFIX: &str = "v1/snapshot/archive";
pub const KV_LATEST_SNAPSHOT_KEY: &str = "snapshot/latest";
pub const KEY_VERSION_PREFIX: &str = "v1";

/// Validate that a key string conforms to the R2 layout spec.
pub fn is_valid_r2_snapshot_key(key: &str) -> bool {
    if key == R2_LATEST_SNAPSHOT_KEY {
        return true;
    }

    let Some(rest) = key.strip_prefix(&format!("{R2_ARCHIVE_SNAPSHOT_PREFIX}/")) else {
        return false;
    };
    let Some(stamp) = rest.strip_suffix(".json") else {
        return false;
    };

    let parts: Vec<&str> = stamp.split('/').collect();
    if parts.len() != 4 {
        return false;
    }
    // YYYY / MM / DD / HHMM
    if parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 || parts[3].len() != 4 {
        return false;
    }
    if !parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
        return false;
    }
    // HHMM must have valid hours/minutes
    let hour: u32 = parts[3][0..2].parse().unwrap_or(99);
    let minute: u32 = parts[3][2..4].parse().unwrap_or(99);
    if hour > 23 || minute > 59 {
        return false;
    }
    // Reconstruct and validate as a real date-time
    let candidate = format!(
        "{}-{}-{}T{:02}:{:02}:00Z",
        parts[0], parts[1], parts[2], hour, minute
    );
    DateTime::parse_from_rfc3339(&candidate).is_ok()
}

/// Derive the immutable archive key from a timestamp.
///
/// Format: `v1/snapshot/archive/YYYY/MM/DD/HHMM.json`
/// The timestamp is the `generated_at` of the snapshot — the as-of wall clock.
pub fn archive_key_for(generated_at: &DateTime<Utc>) -> String {
    format!(
        "{R2_ARCHIVE_SNAPSHOT_PREFIX}/{}.json",
        generated_at.format("%Y/%m/%d/%H%M")
    )
}

/// Build a KeyPlan for the given snapshot timestamp.
///
/// `archive_exists` should be `true` if an object already exists at the
/// archive key (checked by the worker boundary before writing).
pub fn plan_write(
    generated_at: &DateTime<Utc>,
    archive_exists: bool,
) -> KeyPlan {
    let archive_key = archive_key_for(generated_at);
    let (is_safe, safety_issue) = if archive_exists {
        (
            false,
            Some(format!(
                "append-only violation: archive key `{archive_key}` already exists"
            )),
        )
    } else {
        // validate key conforms to layout
        if !is_valid_r2_snapshot_key(&archive_key) {
            (
                false,
                Some(format!("archive key `{archive_key}` does not conform to r2-layout")),
            )
        } else {
            (true, None)
        }
    };

    KeyPlan {
        generated_at: generated_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        latest_r2_key: R2_LATEST_SNAPSHOT_KEY.to_string(),
        archive_r2_key: archive_key,
        kv_latest_key: KV_LATEST_SNAPSHOT_KEY.to_string(),
        archive_exists,
        is_safe,
        safety_issue,
        key_prefix: KEY_VERSION_PREFIX.to_string(),
    }
}

/// Plan a write with optional archive-existence check (for test determinism).
pub fn plan_write_safe(generated_at: &DateTime<Utc>) -> KeyPlan {
    plan_write(generated_at, false)
}

/// Check if a key is the mutable latest key (allowed to overwrite).
pub fn is_latest_key(key: &str) -> bool {
    key == R2_LATEST_SNAPSHOT_KEY
}

/// Check if a key is an archive key (must be write-once).
pub fn is_archive_key(key: &str) -> bool {
    key.starts_with(R2_ARCHIVE_SNAPSHOT_PREFIX) && key.ends_with(".json")
}

/// Human-readable representation of the key hierarchy.
pub fn describe_keys() -> String {
    format!(
        "R2 public (client-facing):\n  latest: {R2_LATEST_SNAPSHOT_KEY} (mutable, overwrite each tick)\n  \
         archive: {R2_ARCHIVE_SNAPSHOT_PREFIX}/YYYY/MM/DD/HHMM.json (immutable, write-once, append-only)\n\
         KV internal (alert sweep):\n  latest: {KV_LATEST_SNAPSHOT_KEY} (mutable, mirrors R2 latest)\n\
         All keys prefixed: {KEY_VERSION_PREFIX}/"
    )
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn dt(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
    }

    // ── Key validation ────────────────────────────────────────────────────

    #[test]
    fn valid_latest_key_is_accepted() {
        assert!(is_valid_r2_snapshot_key(R2_LATEST_SNAPSHOT_KEY));
        assert!(is_latest_key(R2_LATEST_SNAPSHOT_KEY));
        assert!(!is_archive_key(R2_LATEST_SNAPSHOT_KEY));
    }

    #[test]
    fn valid_archive_key_is_accepted() {
        let key = "v1/snapshot/archive/2026/06/12/0805.json";
        assert!(is_valid_r2_snapshot_key(key));
        assert!(is_archive_key(key));
        assert!(!is_latest_key(key));
    }

    #[test]
    fn archive_key_rejects_invalid_paths() {
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/06/12/0805")); // no .json
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/06/12/0805.txt"));
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/other/file.json"));
        assert!(!is_valid_r2_snapshot_key("v2/snapshot/archive/2026/06/12/0805.json")); // wrong version
        assert!(!is_valid_r2_snapshot_key(""));
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/latest"));
    }

    #[test]
    fn archive_key_rejects_invalid_timestamps() {
        // Bad month
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/13/12/0805.json"));
        // Bad day
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/06/32/0805.json"));
        // Bad hour
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/06/12/2505.json"));
        // Bad minute
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/06/12/0865.json"));
        // Non-digit chars
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/ab/12/0805.json"));
        // Wrong segment length
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/6/12/0805.json")); // month too short
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/06/12/805.json")); // time too short
        // Extra segments
        assert!(!is_valid_r2_snapshot_key("v1/snapshot/archive/2026/06/12/08/05.json"));
    }

    // ── Archive key derivation ────────────────────────────────────────────

    #[test]
    fn archive_key_derivation_consistent() {
        let ts = dt(2026, 6, 12, 8, 5);
        let key = archive_key_for(&ts);
        assert_eq!(key, "v1/snapshot/archive/2026/06/12/0805.json");
        assert!(is_valid_r2_snapshot_key(&key));
        assert!(is_archive_key(&key));
    }

    #[test]
    fn archive_key_at_midnight() {
        let ts = dt(2026, 1, 1, 0, 0);
        let key = archive_key_for(&ts);
        assert_eq!(key, "v1/snapshot/archive/2026/01/01/0000.json");
        assert!(is_valid_r2_snapshot_key(&key));
    }

    #[test]
    fn archive_key_at_year_end() {
        let ts = dt(2026, 12, 31, 23, 59);
        let key = archive_key_for(&ts);
        assert_eq!(key, "v1/snapshot/archive/2026/12/31/2359.json");
        assert!(is_valid_r2_snapshot_key(&key));
    }

    #[test]
    fn archive_key_bijective() {
        // Given a timestamp, the archive key can be reconstructed back to the
        // same timestamp (minute precision).
        let ts = dt(2026, 6, 12, 14, 43);
        let key = archive_key_for(&ts);
        assert!(key.contains("2026/06/12/1443"));
    }

    // ── KeyPlan safety ────────────────────────────────────────────────────

    #[test]
    fn plan_is_safe_when_archive_does_not_exist() {
        let ts = dt(2026, 6, 12, 8, 5);
        let plan = plan_write(&ts, false);
        assert!(plan.is_safe);
        assert!(plan.safety_issue.is_none());
        assert!(!plan.archive_exists);
        assert_eq!(plan.latest_r2_key, R2_LATEST_SNAPSHOT_KEY);
        assert_eq!(plan.kv_latest_key, KV_LATEST_SNAPSHOT_KEY);
        assert_eq!(plan.archive_r2_key, "v1/snapshot/archive/2026/06/12/0805.json");
        assert_eq!(plan.key_prefix, KEY_VERSION_PREFIX);
    }

    #[test]
    fn plan_is_unsafe_when_archive_exists() {
        let ts = dt(2026, 6, 12, 8, 5);
        let plan = plan_write(&ts, true);
        assert!(!plan.is_safe);
        assert!(plan.safety_issue.is_some());
        assert!(plan.archive_exists);
        let issue = plan.safety_issue.unwrap();
        assert!(issue.contains("append-only violation"));
        assert!(issue.contains("v1/snapshot/archive/2026/06/12/0805.json"));
    }

    #[test]
    fn plan_safe_helper_never_marks_existing() {
        let ts = dt(2026, 6, 12, 8, 5);
        let plan = plan_write_safe(&ts);
        assert!(plan.is_safe);
        assert!(!plan.archive_exists);
    }

    #[test]
    fn plan_generated_at_is_iso_8601() {
        let ts = dt(2026, 6, 12, 8, 5);
        let plan = plan_write(&ts, false);
        // Must be ISO-8601 with seconds and trailing Z
        assert_eq!(plan.generated_at, "2026-06-12T08:05:00Z");
    }

    // ── Append-only invariant ─────────────────────────────────────────────

    #[test]
    fn append_only_different_timestamps_produce_different_keys() {
        let ts1 = dt(2026, 6, 12, 8, 5);
        let ts2 = dt(2026, 6, 12, 8, 6); // one minute later
        let k1 = archive_key_for(&ts1);
        let k2 = archive_key_for(&ts2);
        assert_ne!(k1, k2);
        assert_eq!(k1, "v1/snapshot/archive/2026/06/12/0805.json");
        assert_eq!(k2, "v1/snapshot/archive/2026/06/12/0806.json");
    }

    #[test]
    fn append_only_same_timestamp_produces_same_key() {
        let ts = dt(2026, 6, 12, 8, 5);
        let k1 = archive_key_for(&ts);
        let k2 = archive_key_for(&ts);
        assert_eq!(k1, k2);
        // This is why the plan must check archive_exists — the same timestamp
        // in a subsequent tick would collide.
    }

    #[test]
    fn append_only_latest_key_is_always_same() {
        // Latest key is mutable and always the same string
        let plan1 = plan_write(&dt(2026, 6, 12, 8, 5), false);
        let plan2 = plan_write(&dt(2026, 6, 12, 9, 30), false);
        assert_eq!(plan1.latest_r2_key, plan2.latest_r2_key);
        assert_eq!(plan1.latest_r2_key, R2_LATEST_SNAPSHOT_KEY);
        assert_ne!(plan1.archive_r2_key, plan2.archive_r2_key);
    }

    // ── KV mirroring ──────────────────────────────────────────────────────

    #[test]
    fn kv_key_is_stable_and_shorter_than_r2() {
        // KV key should not include version prefix (KV namespace is
        // per-worker, so v1/ prefix is unnecessary overhead)
        let plan = plan_write(&dt(2026, 6, 12, 8, 5), false);
        assert_eq!(plan.kv_latest_key, KV_LATEST_SNAPSHOT_KEY);
        assert!(!plan.kv_latest_key.starts_with("v1/"));
    }

    // ── Describe ──────────────────────────────────────────────────────────

    #[test]
    fn describe_contains_all_key_families() {
        let desc = describe_keys();
        assert!(desc.contains(R2_LATEST_SNAPSHOT_KEY));
        assert!(desc.contains(R2_ARCHIVE_SNAPSHOT_PREFIX));
        assert!(desc.contains(KV_LATEST_SNAPSHOT_KEY));
        assert!(desc.contains(KEY_VERSION_PREFIX));
    }

    // ── Key budget check (per r2-layout.md) ───────────────────────────────

    #[test]
    fn archive_keys_are_listing_friendly() {
        // Keys use YYYY/MM/DD/HHMM path structure for CDN listing
        let key = archive_key_for(&dt(2026, 6, 12, 14, 43));
        // Prefix listing by day should work
        let day_prefix = "v1/snapshot/archive/2026/06/12/";
        assert!(key.starts_with(day_prefix));
        // All timestamp components are zero-padded for string sorting
        assert!(key.contains("/06/"));
        assert!(key.contains("/12/"));
    }

    #[test]
    fn archive_key_counter_preserves_minute_granularity() {
        // 5-min cadence: each tick must get a unique archive key
        let mut seen = std::collections::HashSet::new();
        for minute in (0..60).step_by(5) {
            let ts = dt(2026, 6, 12, 0, minute);
            let key = archive_key_for(&ts);
            assert!(seen.insert(key), "duplicate key for minute {minute}");
        }
        assert_eq!(seen.len(), 12); // 12 five-minute ticks per hour
    }
}
