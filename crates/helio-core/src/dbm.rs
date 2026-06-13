//! §6.1 — Drag-Based Model (DBM) propagation
//!
//! Vectors: contracts/fixtures/vectors/dbm.json (tolerances per function).

use crate::error::CoreError;

/// Drag parameter γ (1/km) + ambient solar-wind speed w (km/s).
#[derive(Debug, Clone, Copy)]
pub struct DbmParams {
    pub gamma_per_km: f64,
    pub ambient_wind_kms: f64,
}

/// CME apex front state: heliocentric distance, speed, time.
#[derive(Debug, Clone, Copy)]
pub struct CmeState {
    pub r_km: f64,
    pub v_kms: f64,
    pub t_unix: f64,
}

/// Advance the front by dt_s under dv/dt = −γ (v−w)|v−w|.
///
/// PINNED closed form (no integrator ambiguity).
/// Vectors: fixtures/vectors/dbm.json, function "dbm_step" (1e-9 rel).
pub fn dbm_step(state: &CmeState, p: &DbmParams, dt_s: f64) -> CmeState {
    let w = p.ambient_wind_kms;
    let u0 = state.v_kms - w;
    let g = p.gamma_per_km;

    if g == 0.0 || u0 == 0.0 {
        return CmeState {
            r_km: state.r_km + state.v_kms * dt_s,
            v_kms: state.v_kms,
            t_unix: state.t_unix + dt_s,
        };
    }

    let a = g * u0.abs() * dt_s;
    let u = u0 / (1.0 + a);
    let sign = if u0 > 0.0 { 1.0 } else { -1.0 };
    let r_km = state.r_km + w * dt_s + sign * (1.0 + a).ln() / g;

    CmeState {
        r_km,
        v_kms: w + u,
        t_unix: state.t_unix + dt_s,
    }
}

/// Arrival time + speed at target_r_km.
///
/// PINNED: bisection on t in [0, 30 days] to |Δt| ≤ 1.0 s.
/// Vectors: fixtures/vectors/dbm.json, function "dbm_arrival" (±2 s, ±1e-6 km/s).
pub fn dbm_arrival(
    liftoff: &CmeState,
    p: &DbmParams,
    target_r_km: f64,
) -> Result<(f64, f64), CoreError> {
    let horizon_s = 30.0 * 86_400.0;
    if dbm_step(liftoff, p, horizon_s).r_km < target_r_km {
        return Err(CoreError::OutOfRange);
    }

    let mut lo = 0.0;
    let mut hi = horizon_s;
    while hi - lo > 1.0 {
        let mid = 0.5 * (lo + hi);
        if dbm_step(liftoff, p, mid).r_km < target_r_km {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    let dt = 0.5 * (lo + hi);
    let arrival = dbm_step(liftoff, p, dt);
    Ok((liftoff.t_unix + dt, arrival.v_kms))
}

/// Does the CME cone's angular span contain Earth?
///
/// PINNED: great-circle separation with Parker spiral offset.
/// Vectors: fixtures/vectors/dbm.json, function "cone_contains_earth" (exact booleans).
pub fn cone_contains_earth(
    apex_lon_deg: f64,
    apex_lat_deg: f64,
    half_angle_deg: f64,
    earth_helio_lon_deg: f64,
    earth_helio_lat_deg: f64,
    parker_offset_deg: f64,
) -> bool {
    let lam1 = (apex_lon_deg + parker_offset_deg).to_radians();
    let phi1 = apex_lat_deg.to_radians();
    let lam2 = earth_helio_lon_deg.to_radians();
    let phi2 = earth_helio_lat_deg.to_radians();

    let cos_delta = phi1.sin() * phi2.sin() + phi1.cos() * phi2.cos() * (lam1 - lam2).cos();
    let sep_deg = cos_delta.clamp(-1.0, 1.0).acos().to_degrees();
    sep_deg <= half_angle_deg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dbm_step_ballistic() {
        let state = CmeState { r_km: 20.0e6, v_kms: 500.0, t_unix: 0.0 };
        let p = DbmParams { gamma_per_km: 0.0, ambient_wind_kms: 400.0 };
        let next = dbm_step(&state, &p, 3600.0);
        // Ballistic: r = 20e6 + 500 * 3600 = 21.8e6
        assert!((next.r_km - 21.8e6).abs() < 1e3);
    }
}
