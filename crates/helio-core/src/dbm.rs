//! Drag-Based Model (DBM) propagation.
//!
//! Vectors: contracts/fixtures/vectors/dbm.json (tolerances per function).

use crate::error::CoreError;

const MAX_TRANSIT_SECONDS: f64 = 30.0 * 86_400.0;
// 30 days / 2^22 is approximately 0.62 seconds, inside the pinned 1-second
// bisection interval without relying on a floating-point loop condition.
const BISECTION_ITERATIONS: usize = 22;

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
#[must_use]
pub fn dbm_step(state: &CmeState, params: &DbmParams, dt_s: f64) -> CmeState {
    let ambient_wind = params.ambient_wind_kms;
    let initial_relative_speed = state.v_kms - ambient_wind;
    let gamma = params.gamma_per_km;

    if gamma == 0.0 || initial_relative_speed == 0.0 {
        return CmeState {
            r_km: state.r_km + state.v_kms * dt_s,
            v_kms: state.v_kms,
            t_unix: state.t_unix + dt_s,
        };
    }

    let drag_amount = gamma * initial_relative_speed.abs() * dt_s;
    let relative_speed = initial_relative_speed / (1.0 + drag_amount);
    let direction = if initial_relative_speed > 0.0 {
        1.0
    } else {
        -1.0
    };
    let r_km = state.r_km + ambient_wind * dt_s + direction * drag_amount.ln_1p() / gamma;

    CmeState {
        r_km,
        v_kms: ambient_wind + relative_speed,
        t_unix: state.t_unix + dt_s,
    }
}

/// Arrival time + speed at target_r_km.
///
/// PINNED: bisection on t in [0, 30 days] to |Δt| ≤ 1.0 s.
/// Vectors: fixtures/vectors/dbm.json, function "dbm_arrival" (±2 s, ±1e-6 km/s).
///
/// # Errors
///
/// Returns [`CoreError::OutOfRange`] when an input is non-finite or
/// non-physical, the target is behind the initial front, or the front cannot
/// reach the target within 30 days.
pub fn dbm_arrival(
    liftoff: &CmeState,
    params: &DbmParams,
    target_r_km: f64,
) -> Result<(f64, f64), CoreError> {
    let all_finite = [
        liftoff.r_km,
        liftoff.v_kms,
        liftoff.t_unix,
        params.gamma_per_km,
        params.ambient_wind_kms,
        target_r_km,
    ]
    .into_iter()
    .all(f64::is_finite);
    let physically_valid = liftoff.r_km >= 0.0
        && liftoff.v_kms > 0.0
        && params.gamma_per_km >= 0.0
        && params.ambient_wind_kms > 0.0
        && target_r_km >= liftoff.r_km;
    if !all_finite || !physically_valid {
        return Err(CoreError::OutOfRange);
    }

    if target_r_km == liftoff.r_km {
        return Ok((liftoff.t_unix, liftoff.v_kms));
    }

    let horizon = dbm_step(liftoff, params, MAX_TRANSIT_SECONDS);
    if !horizon.r_km.is_finite() || horizon.r_km < target_r_km {
        return Err(CoreError::OutOfRange);
    }

    let mut lo = 0.0;
    let mut hi = MAX_TRANSIT_SECONDS;
    for _ in 0..BISECTION_ITERATIONS {
        let mid = 0.5 * (lo + hi);
        if dbm_step(liftoff, params, mid).r_km < target_r_km {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    let dt = 0.5 * (lo + hi);
    let arrival = dbm_step(liftoff, params, dt);
    Ok((arrival.t_unix, arrival.v_kms))
}

/// Does the CME cone's angular span contain Earth?
///
/// PINNED: great-circle separation with Parker spiral offset.
/// Vectors: fixtures/vectors/dbm.json, function "cone_contains_earth" (exact booleans).
#[must_use]
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
        let state = CmeState {
            r_km: 20.0e6,
            v_kms: 500.0,
            t_unix: 0.0,
        };
        let params = DbmParams {
            gamma_per_km: 0.0,
            ambient_wind_kms: 400.0,
        };
        let next = dbm_step(&state, &params, 3600.0);
        // Ballistic: r = 20e6 + 500 * 3600 = 21.8e6
        assert!((next.r_km - 21.8e6).abs() < 1e3);
    }

    #[test]
    fn dbm_arrival_rejects_invalid_inputs() {
        let valid_state = CmeState {
            r_km: 20.0e6,
            v_kms: 500.0,
            t_unix: 0.0,
        };
        let valid_params = DbmParams {
            gamma_per_km: 2.0e-8,
            ambient_wind_kms: 400.0,
        };

        let invalid_state = CmeState {
            v_kms: f64::NAN,
            ..valid_state
        };
        assert_eq!(
            dbm_arrival(&invalid_state, &valid_params, 148_800_000.0),
            Err(CoreError::OutOfRange)
        );

        let invalid_params = DbmParams {
            gamma_per_km: -2.0e-8,
            ..valid_params
        };
        assert_eq!(
            dbm_arrival(&valid_state, &invalid_params, 148_800_000.0),
            Err(CoreError::OutOfRange)
        );

        assert_eq!(
            dbm_arrival(&valid_state, &valid_params, valid_state.r_km - 1.0),
            Err(CoreError::OutOfRange)
        );
        assert_eq!(
            dbm_arrival(&valid_state, &valid_params, valid_state.r_km),
            Ok((valid_state.t_unix, valid_state.v_kms))
        );
    }
}
