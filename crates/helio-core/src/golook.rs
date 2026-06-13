//! §7.1 — "Go Look" score (scalar inputs ONLY — §4.1 invariant)

#[derive(Debug, Clone, Copy)]
pub struct GoLookInputs {
    pub oval_visible_prob: f64,
    pub sun_alt_deg: f64,
    pub moon_alt_deg: f64,
    pub moon_illum_frac: f64,
    pub cloud_total_consensus: f64,
    pub cloud_low_consensus: f64,
    pub cloud_model_spread: f64,
    pub satellite_clear_now: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Likely,
    Possible,
    Unlikely,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Limiter {
    Daylight,
    Oval,
    CloudObserved,
    CloudForecast,
    Moon,
}

#[derive(Debug, Clone, Copy)]
pub struct GoLookScore {
    pub score: f64,
    pub verdict: Verdict,
    pub confidence: f64,
    pub dominant_limiter: Limiter,
}

/// Darkness factor for aurora visibility.
///
/// PINNED: clamp((−6 − sun_alt_deg) / 12, 0, 1)
/// Vectors: contracts/fixtures/vectors/golook.json, function "darkness_factor" (1e-9).
pub fn darkness_factor(sun_alt_deg: f64) -> f64 {
    let factor = (-6.0 - sun_alt_deg) / 12.0;
    factor.clamp(0.0, 1.0)
}

/// The on-device "go look" score. v1.0 heuristic.
///
/// PINNED semantics — see contracts/wasm-api/helio_core_api.rs.
/// Vectors: contracts/fixtures/vectors/golook.json, function "go_look" (1e-9 rel on score).
pub fn go_look(inputs: &GoLookInputs) -> GoLookScore {
    let darkness = darkness_factor(inputs.sun_alt_deg);
    let moon_factor = 1.0
        - 0.6
            * inputs.moon_illum_frac
            * inputs.moon_alt_deg.to_radians().sin().clamp(0.0, 1.0);
    let clear_fcst = (1.0
        - (0.7 * inputs.cloud_low_consensus + 0.3 * inputs.cloud_total_consensus))
        .clamp(0.0, 1.0);

    let (clear, confidence, cloud_observed_limiter) = match inputs.satellite_clear_now {
        None => (clear_fcst, (1.0 - inputs.cloud_model_spread) * 0.85, 1.0),
        Some(sat) => (
            0.5 * clear_fcst + 0.5 * sat,
            1.0 - inputs.cloud_model_spread,
            sat,
        ),
    };

    let score = inputs.oval_visible_prob * darkness * moon_factor * clear;
    let verdict = if score >= 0.30 {
        Verdict::Likely
    } else if score >= 0.10 {
        Verdict::Possible
    } else {
        Verdict::Unlikely
    };

    // Argmin with contract tie order: Daylight, Oval, CloudObserved,
    // CloudForecast, Moon. Strict comparisons preserve earlier ties.
    let mut best_value = darkness;
    let mut dominant_limiter = Limiter::Daylight;
    for (limiter, value) in [
        (Limiter::Oval, inputs.oval_visible_prob),
        (Limiter::CloudObserved, cloud_observed_limiter),
        (Limiter::CloudForecast, clear_fcst),
        (Limiter::Moon, moon_factor),
    ] {
        if value < best_value {
            best_value = value;
            dominant_limiter = limiter;
        }
    }

    GoLookScore {
        score,
        verdict,
        confidence,
        dominant_limiter,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_darkness_factor_day() {
        // Sun at +10° => full daylight => factor 0
        assert!((darkness_factor(10.0) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_darkness_factor_night() {
        // Sun at -20° => full darkness => factor 1
        assert!((darkness_factor(-20.0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_darkness_factor_twilight() {
        // Sun at -12° => midpoint of ramp => factor 0.5
        assert!((darkness_factor(-12.0) - 0.5).abs() < 1e-9);
    }
}
