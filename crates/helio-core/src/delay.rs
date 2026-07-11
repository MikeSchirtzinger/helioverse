//! Measured L1→Earth propagation delay.

use crate::error::CoreError;

/// Ballistic L1→Earth delay from the measured bulk speed.
///
/// PINNED: delay_s = distance / speed. Exact.
/// VALIDITY: distance in [1.2e6, 1.8e6] km, speed in [200.0, 3000.0] km/s.
///
/// Vectors: contracts/fixtures/vectors/delay-correction.json (tolerance: exact, 1e-9 rel).
pub fn l1_delay_seconds(
    spacecraft_earth_distance_km: f64,
    measured_speed_kms: f64,
) -> Result<f64, CoreError> {
    if !(1.2e6..=1.8e6).contains(&spacecraft_earth_distance_km) {
        return Err(CoreError::OutOfRange);
    }
    if !(200.0..=3000.0).contains(&measured_speed_kms) {
        return Err(CoreError::OutOfRange);
    }
    Ok(spacecraft_earth_distance_km / measured_speed_kms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_delay_simple() {
        // 1.5e6 km / 400 km/s = 3750 s
        let result = l1_delay_seconds(1_500_000.0, 400.0).unwrap();
        assert!((result - 3750.0).abs() < 1e-6);
    }

    #[test]
    fn test_out_of_range() {
        assert_eq!(
            l1_delay_seconds(1_000_000.0, 400.0),
            Err(CoreError::OutOfRange)
        );
        assert_eq!(
            l1_delay_seconds(2_000_000.0, 400.0),
            Err(CoreError::OutOfRange)
        );
        assert_eq!(
            l1_delay_seconds(1_500_000.0, 100.0),
            Err(CoreError::OutOfRange)
        );
    }
}
