//! Pinned constants from the WASM API contract.

/// Astronomical Unit in km (IAU 2012).
pub const AU_KM: f64 = 1.495978707e8;

/// Solar radius in km.
pub const SUN_RADIUS_KM: f64 = 6.957e5;

/// NOAA-equivalent fixed L1→Earth delay, used ONLY in degraded fallback (spec §2.1).
pub const FIXED_FALLBACK_DELAY_S: f64 = 1800.0;
