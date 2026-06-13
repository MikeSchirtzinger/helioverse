//! helio-core — the shared Rust→WASM physics + scoring crate (spec §4 stack, §4.2).
//!
//! THIS FILE IS THE CONTRACT, not the implementation. The signatures, units,
//! constants, and pinned semantics below are FROZEN at v1.0. The crate is
//! consumed by the browser client (primary) and importable by Workers for the
//! nightly eval. Implementations MUST reproduce the golden vectors in
//! contracts/fixtures/vectors/ to the stated tolerances.
//!
//! UNIT CONVENTIONS (everywhere, no exceptions):
//!   time        unix seconds UTC (f64)         angles      degrees (f64)
//!   distance    km                             speed       km/s
//!   B-field     nT, GSM frame                  density     particles/cm^3
//!
//! NUMERIC SEMANTICS ARE PINNED so independently-built implementations agree:
//! where a closed form exists we mandate it; where an integrator is needed we
//! mandate explicit Euler with the caller's dt. No implementation-defined
//! behavior is allowed to leak through this surface.

pub const AU_KM: f64 = 1.495978707e8;
pub const SUN_RADIUS_KM: f64 = 6.957e5;
/// NOAA-equivalent fixed L1->Earth delay, used ONLY in degraded fallback (spec §2.1).
pub const FIXED_FALLBACK_DELAY_S: f64 = 1800.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreError {
    /// Input outside the pinned validity range documented on the function.
    OutOfRange,
}

// ===========================================================================
// §2.1 — the real-delay correction
// ===========================================================================

/// Ballistic L1->Earth delay from the measured bulk speed.
///
/// PINNED: delay_s = spacecraft_earth_distance_km / measured_speed_kms. Exact.
/// VALIDITY: distance in [1.2e6, 1.8e6] km, speed in [200.0, 3000.0] km/s;
/// outside either range return Err(OutOfRange) — the CALLER then uses
/// FIXED_FALLBACK_DELAY_S and sets delay_quality = "degraded_fixed".
/// Vectors: fixtures/vectors/delay-correction.json (tolerance: exact, 1e-9 rel).
pub fn l1_delay_seconds(
    spacecraft_earth_distance_km: f64,
    measured_speed_kms: f64,
) -> Result<f64, CoreError>;

// ===========================================================================
// §6.1 — Drag-Based Model propagation
// ===========================================================================

/// gamma_per_km: drag parameter γ (units 1/km; typical 0.2e-7..2e-7).
/// ambient_wind_kms: ambient solar-wind speed w. Both are learnable θ (spec §8.5).
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
/// PINNED (closed form — no integrator ambiguity): with u0 = v0 − w,
///   u(dt) = u0 / (1 + γ·|u0|·dt)
///   r(dt) = r0 + w·dt + sign(u0)·ln(1 + γ·|u0|·dt) / γ
///   (γ = 0 degenerates to ballistic: u(dt) = u0, r = r0 + v0·dt)
/// Vectors: fixtures/vectors/dbm.json, function "dbm_step" (1e-9 rel).
pub fn dbm_step(state: &CmeState, p: &DbmParams, dt_s: f64) -> CmeState;

/// Arrival time + speed at target_r_km (e.g. ~1 AU minus magnetopause standoff).
///
/// PINNED: r(t) is strictly monotonic for v0 > 0; solve r(t) = target_r_km by
/// bisection on t in [0, 30 days] to |Δt| <= 1.0 s. Returns Err(OutOfRange) if
/// the front cannot reach target within 30 days.
/// Vectors: fixtures/vectors/dbm.json, function "dbm_arrival" (tolerance ±2 s, ±1e-6 km/s).
pub fn dbm_arrival(
    liftoff: &CmeState,
    p: &DbmParams,
    target_r_km: f64,
) -> Result<(f64 /* t_arrival_unix */, f64 /* v_arrival_kms */), CoreError>;

// ===========================================================================
// §6.3 — Earth-bound geometry & magnetosphere coupling
// ===========================================================================

/// Does the CME cone's angular span contain Earth?
///
/// PINNED: effective apex longitude = apex_lon_deg + parker_offset_deg.
/// Great-circle separation Δ between (eff_lon, apex_lat) and
/// (earth_helio_lon_deg, earth_helio_lat_deg) via
///   cos Δ = sin φ1 sin φ2 + cos φ1 cos φ2 cos(λ1 − λ2)
/// Returns Δ <= half_angle_deg.
/// Vectors: fixtures/vectors/dbm.json, function "cone_contains_earth" (exact booleans).
pub fn cone_contains_earth(
    apex_lon_deg: f64,
    apex_lat_deg: f64,
    half_angle_deg: f64,
    earth_helio_lon_deg: f64,
    earth_helio_lat_deg: f64,
    parker_offset_deg: f64,
) -> bool;

/// Newell solar-wind–magnetosphere coupling dΦ_MP/dt (arbitrary units).
///
/// PINNED: B_T = sqrt(By² + Bz²); clock angle θc = atan2(By, Bz);
///   coupling = v^(4/3) · B_T^(2/3) · |sin(θc/2)|^(8/3)
/// (Newell et al. 2007. Inputs km/s and nT; output left in those units —
/// it feeds relative displays and the Kp proxy, not absolute physics.)
/// Vectors: fixtures/vectors/coupling.json, function "newell_coupling" (1e-9 rel).
pub fn newell_coupling(v_kms: f64, by_nt: f64, bz_nt: f64) -> f64;

/// One explicit-Euler step of the O'Brien–McPherron Dst* injection–decay ODE.
///
/// PINNED (OBM 2000 constants, v1.0; density_pcc RESERVED for the pressure
/// correction post-v1 — accepted but unused, the signature is frozen now):
///   Bs   = max(0, −bz_nt)                       [nT]
///   VBs  = v_kms · Bs · 1e-3                    [mV/m]
///   Q    = −4.4 · max(0, VBs − 0.49)            [nT/h]
///   τ    = 2.40 · exp(9.74 / (4.69 + VBs))      [h]
///   dst' = dst + (dt_s/3600) · (Q − dst/τ)      [nT]
/// Vectors: fixtures/vectors/coupling.json, function "dst_step" (1e-9 rel).
pub fn dst_step(dst_nt: f64, v_kms: f64, bz_nt: f64, density_pcc: f64, dt_s: f64) -> f64;

/// Kp -> NOAA G-scale. PINNED: G0 Kp<5; G1 [5,6); G2 [6,7); G3 [7,8); G4 [8,9); G5 Kp>=9.
/// Vectors: fixtures/vectors/coupling.json, function "kp_to_g" (exact).
pub fn kp_to_g(kp: f64) -> u8;

// ===========================================================================
// §7.1 — sky astronomy (client-side; no API calls, ever)
// ===========================================================================

#[derive(Debug, Clone, Copy)]
pub struct SkyState {
    pub sun_alt_deg: f64,
    pub moon_alt_deg: f64,
    /// Illuminated fraction of the lunar disk, 0..1.
    pub moon_illum_frac: f64,
}

/// Topocentric sun/moon state for an observer.
///
/// SEMANTICS: standard low-precision ephemeris (Meeus-class) is sufficient.
/// ACCURACY CONTRACT (vs the anchors in fixtures/vectors/astronomy.json):
/// sun_alt ±0.3°, moon_alt ±0.5°, moon_illum ±0.02. Refraction ignored.
pub fn sky_state(lat_deg: f64, lon_deg: f64, t_unix: f64) -> SkyState;

/// Darkness factor for aurora visibility.
/// PINNED: clamp((−6 − sun_alt_deg) / 12, 0, 1)
///   => 0 at civil twilight or brighter (alt >= −6), 1 at astronomical dark
///   (alt <= −18), linear ramp between.
/// Vectors: fixtures/vectors/golook.json, function "darkness_factor" (1e-9).
pub fn darkness_factor(sun_alt_deg: f64) -> f64;

// ===========================================================================
// §7.1 + §4.1 invariant — the "go look" score (scalar inputs ONLY)
// ===========================================================================

#[derive(Debug, Clone, Copy)]
pub struct GoLookInputs {
    /// Visible-aurora probability 0..1 at the user's location, sampled from the
    /// delay-corrected OVATION grid.
    pub oval_visible_prob: f64,
    pub sun_alt_deg: f64,
    pub moon_alt_deg: f64,
    pub moon_illum_frac: f64,
    /// Multi-model consensus means, 0..1 (Open-Meteo, spec §3.6).
    pub cloud_total_consensus: f64,
    /// Low cloud weighted heaviest — it's what actually blocks aurora.
    pub cloud_low_consensus: f64,
    /// Cross-model disagreement 0..1 (0 = all models agree). This IS the error bar.
    pub cloud_model_spread: f64,
    /// GOES CSM Tier-0 point answer, 0..1 clear; None when the leg is unavailable.
    pub satellite_clear_now: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict { Likely, Possible, Unlikely }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Limiter { Daylight, Oval, CloudObserved, CloudForecast, Moon }

#[derive(Debug, Clone, Copy)]
pub struct GoLookScore {
    pub score: f64,
    pub verdict: Verdict,
    pub confidence: f64,
    /// The factor that most limits tonight — drives "why it might be wrong" (spec §8.6).
    pub dominant_limiter: Limiter,
}

/// The on-device "go look" score. v1.0 heuristic — the eval loop owns
/// refinement post-v1; changing ANY constant below is a minor version bump
/// with regenerated vectors.
///
/// PINNED:
///   darkness     = darkness_factor(sun_alt_deg)
///   moon_factor  = 1 − 0.6 · moon_illum_frac · clamp(sin(moon_alt_deg·π/180), 0, 1)
///   clear_fcst   = clamp(1 − (0.7·cloud_low + 0.3·cloud_total), 0, 1)
///   clear        = match satellite_clear_now {
///                    None      => clear_fcst,
///                    Some(sat) => 0.5·clear_fcst + 0.5·sat }
///   score        = oval_visible_prob · darkness · moon_factor · clear
///   confidence   = (1 − cloud_model_spread) · (if satellite leg missing {0.85} else {1.0})
///   verdict      = score >= 0.30 → Likely; >= 0.10 → Possible; else Unlikely
///   limiter      = argmin over factors {Daylight: darkness, Oval: oval_visible_prob,
///                  CloudObserved: sat-or-1.0, CloudForecast: clear_fcst,
///                  Moon: moon_factor}; ties broken by enum order
///                  (Daylight, Oval, CloudObserved, CloudForecast, Moon).
/// Vectors: fixtures/vectors/golook.json, function "go_look" (1e-9 rel on score
/// and confidence; exact on verdict and limiter).
pub fn go_look(inputs: &GoLookInputs) -> GoLookScore;
