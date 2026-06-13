//! §6.3 — Newell coupling + Dst ODE + Kp-to-G

/// Newell solar-wind–magnetosphere coupling dΦ_MP/dt (arbitrary units).
///
/// PINNED: coupling = v^(4/3) · B_T^(2/3) · |sin(θc/2)|^(8/3)
/// Vectors: contracts/fixtures/vectors/coupling.json (1e-9 rel).
pub fn newell_coupling(v_kms: f64, by_nt: f64, bz_nt: f64) -> f64 {
    let bt = by_nt.hypot(bz_nt);
    if bt == 0.0 {
        return 0.0;
    }
    let theta_c = by_nt.atan2(bz_nt);
    v_kms.powf(4.0 / 3.0) * bt.powf(2.0 / 3.0) * (theta_c / 2.0).sin().abs().powf(8.0 / 3.0)
}

/// One explicit-Euler step of the O'Brien–McPherron Dst* ODE.
///
/// PINNED: OBM 2000 constants. density_pcc reserved/unused in v1.0.
/// Vectors: contracts/fixtures/vectors/coupling.json (1e-9 rel).
pub fn dst_step(dst_nt: f64, v_kms: f64, bz_nt: f64, _density_pcc: f64, dt_s: f64) -> f64 {
    let bs = 0.0_f64.max(-bz_nt);
    let vbs = v_kms * bs * 1.0e-3;
    let q = -4.4 * 0.0_f64.max(vbs - 0.49);
    let tau = 2.40 * (9.74 / (4.69 + vbs)).exp();
    dst_nt + (dt_s / 3600.0) * (q - dst_nt / tau)
}

/// Kp → NOAA G-scale.
///
/// PINNED: G0 Kp<5; G1 [5,6); G2 [6,7); G3 [7,8); G4 [8,9); G5 Kp≥9.
/// Vectors: contracts/fixtures/vectors/coupling.json (exact).
pub fn kp_to_g(kp: f64) -> u8 {
    if kp < 5.0 {
        0
    } else if kp >= 9.0 {
        5
    } else {
        kp as u8 - 4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kp_to_g() {
        assert_eq!(kp_to_g(4.0), 0);
        // Example placeholder — real tests in W1-P2
    }
}
