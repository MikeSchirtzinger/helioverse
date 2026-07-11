//! WASM FFI surface — thin `#[wasm_bindgen]` wrappers over the verified pure
//! functions in this crate.
//!
//! THERE IS NO PHYSICS HERE. Every function below is pure marshalling: it
//! unpacks flat scalar arguments, calls the golden-vector-tested function, and
//! packs the result back into a JS-friendly flat shape (scalar, `Float64Array`,
//! `bool`, or `undefined`). Keeping this layer physics-free means:
//!   • the native golden-vector tests in `tests/golden_vectors.rs` continue to
//!     verify the real implementations untouched, and
//!   • the TS-side golden test (`apps/web/src/core/physics.golden.ts`) verifies
//!     this marshalling + the actual built `.wasm` reproduces the same vectors.
//! Two independent ends, both pinned to `contracts/fixtures/vectors/`.
//!
//! ABI conventions (so the TS wrappers stay trivial):
//!   • `Result<T, CoreError>`  → `Option<T>`  → JS `T | undefined`.
//!   • structs (`CmeState`, `SkyState`, `GoLookScore`) → fixed-length
//!     `Float64Array`, field order documented at each function.
//!   • enums (`Verdict`, `Limiter`) → their stable integer discriminant; the TS
//!     wrapper maps the index back to the string union.

use wasm_bindgen::prelude::*;

use crate::{astronomy, constants, coupling, dbm, delay, golook};

// ---------------------------------------------------------------------------
// Pinned constants (exported as functions — wasm-bindgen const export is awkward
// and this keeps a single call-shape for the TS side to mirror the contract).
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn au_km() -> f64 {
    constants::AU_KM
}

#[wasm_bindgen]
pub fn sun_radius_km() -> f64 {
    constants::SUN_RADIUS_KM
}

// ---------------------------------------------------------------------------
// L1→Earth measured-delay correction.
// Returns `undefined` when inputs are out of the pinned validity range.
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn l1_delay_seconds(spacecraft_earth_distance_km: f64, measured_speed_kms: f64) -> Option<f64> {
    delay::l1_delay_seconds(spacecraft_earth_distance_km, measured_speed_kms).ok()
}

// ---------------------------------------------------------------------------
// Drag-Based Model.
// ---------------------------------------------------------------------------

/// Advance a CME front by `dt_s`. Returns `[r_km, v_kms, t_unix]`.
#[wasm_bindgen]
pub fn dbm_step(
    r_km: f64,
    v_kms: f64,
    t_unix: f64,
    gamma_per_km: f64,
    ambient_wind_kms: f64,
    dt_s: f64,
) -> Vec<f64> {
    let next = dbm::dbm_step(
        &dbm::CmeState { r_km, v_kms, t_unix },
        &dbm::DbmParams { gamma_per_km, ambient_wind_kms },
        dt_s,
    );
    vec![next.r_km, next.v_kms, next.t_unix]
}

/// Arrival time + speed at `target_r_km`. Returns `[t_arrival_unix, v_arrival_kms]`,
/// or `undefined` if the front cannot reach the target within 30 days.
#[wasm_bindgen]
pub fn dbm_arrival(
    r_km: f64,
    v_kms: f64,
    t_unix: f64,
    gamma_per_km: f64,
    ambient_wind_kms: f64,
    target_r_km: f64,
) -> Option<Vec<f64>> {
    dbm::dbm_arrival(
        &dbm::CmeState { r_km, v_kms, t_unix },
        &dbm::DbmParams { gamma_per_km, ambient_wind_kms },
        target_r_km,
    )
    .ok()
    .map(|(t_arrival, v_arrival)| vec![t_arrival, v_arrival])
}

/// Does the CME cone's angular span contain Earth?
#[wasm_bindgen]
pub fn cone_contains_earth(
    apex_lon_deg: f64,
    apex_lat_deg: f64,
    half_angle_deg: f64,
    earth_helio_lon_deg: f64,
    earth_helio_lat_deg: f64,
    parker_offset_deg: f64,
) -> bool {
    dbm::cone_contains_earth(
        apex_lon_deg,
        apex_lat_deg,
        half_angle_deg,
        earth_helio_lon_deg,
        earth_helio_lat_deg,
        parker_offset_deg,
    )
}

// ---------------------------------------------------------------------------
// Newell coupling, Dst* ODE, Kp→G.
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn newell_coupling(v_kms: f64, by_nt: f64, bz_nt: f64) -> f64 {
    coupling::newell_coupling(v_kms, by_nt, bz_nt)
}

#[wasm_bindgen]
pub fn dst_step(dst_nt: f64, v_kms: f64, bz_nt: f64, density_pcc: f64, dt_s: f64) -> f64 {
    coupling::dst_step(dst_nt, v_kms, bz_nt, density_pcc, dt_s)
}

#[wasm_bindgen]
pub fn kp_to_g(kp: f64) -> u8 {
    coupling::kp_to_g(kp)
}

// ---------------------------------------------------------------------------
// Sky astronomy and local viewing score.
// ---------------------------------------------------------------------------

/// Topocentric sun/moon state. Returns `[sun_alt_deg, moon_alt_deg, moon_illum_frac]`.
#[wasm_bindgen]
pub fn sky_state(lat_deg: f64, lon_deg: f64, t_unix: f64) -> Vec<f64> {
    let s = astronomy::sky_state(lat_deg, lon_deg, t_unix);
    vec![s.sun_alt_deg, s.moon_alt_deg, s.moon_illum_frac]
}

#[wasm_bindgen]
pub fn darkness_factor(sun_alt_deg: f64) -> f64 {
    golook::darkness_factor(sun_alt_deg)
}

/// The "go look" score. `satellite_clear_now` is `undefined` when the satellite
/// leg is unavailable. Returns `[score, verdict_idx, confidence, limiter_idx]`:
///   verdict_idx — 0 Likely, 1 Possible, 2 Unlikely
///   limiter_idx — 0 Daylight, 1 Oval, 2 CloudObserved, 3 CloudForecast, 4 Moon
#[wasm_bindgen]
pub fn go_look(
    oval_visible_prob: f64,
    sun_alt_deg: f64,
    moon_alt_deg: f64,
    moon_illum_frac: f64,
    cloud_total_consensus: f64,
    cloud_low_consensus: f64,
    cloud_model_spread: f64,
    satellite_clear_now: Option<f64>,
) -> Vec<f64> {
    let out = golook::go_look(&golook::GoLookInputs {
        oval_visible_prob,
        sun_alt_deg,
        moon_alt_deg,
        moon_illum_frac,
        cloud_total_consensus,
        cloud_low_consensus,
        cloud_model_spread,
        satellite_clear_now,
    });
    let verdict_idx = match out.verdict {
        golook::Verdict::Likely => 0.0,
        golook::Verdict::Possible => 1.0,
        golook::Verdict::Unlikely => 2.0,
    };
    let limiter_idx = match out.dominant_limiter {
        golook::Limiter::Daylight => 0.0,
        golook::Limiter::Oval => 1.0,
        golook::Limiter::CloudObserved => 2.0,
        golook::Limiter::CloudForecast => 3.0,
        golook::Limiter::Moon => 4.0,
    };
    vec![out.score, verdict_idx, out.confidence, limiter_idx]
}
