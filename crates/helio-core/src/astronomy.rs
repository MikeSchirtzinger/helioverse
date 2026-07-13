//! Sky astronomy (client-side; no API calls).

#[derive(Debug, Clone, Copy)]
pub struct SkyState {
    pub sun_alt_deg: f64,
    pub moon_alt_deg: f64,
    pub moon_illum_frac: f64,
}

const DEG: f64 = std::f64::consts::PI / 180.0;
const RAD: f64 = 180.0 / std::f64::consts::PI;

fn unix_to_julian_day(t_unix: f64) -> f64 {
    t_unix / 86_400.0 + 2_440_587.5
}

fn norm360(deg: f64) -> f64 {
    deg.rem_euclid(360.0)
}

fn gmst_rad(jd: f64) -> f64 {
    let t = (jd - 2_451_545.0) / 36_525.0;
    let deg = 280.460_618_37 + 360.985_647_366_29 * (jd - 2_451_545.0) + 0.000_387_933 * t * t
        - t * t * t / 38_710_000.0;
    norm360(deg) * DEG
}

fn obliquity_rad(jd: f64) -> f64 {
    (23.439_291 - 0.000_000_36 * (jd - 2_451_545.0)) * DEG
}

fn sun_ra_dec_lambda(jd: f64) -> (f64, f64, f64) {
    let n = jd - 2_451_545.0;
    let l = norm360(280.466_46 + 0.985_647_36 * n);
    let g = norm360(357.529_11 + 0.985_600_28 * n) * DEG;
    let lambda = norm360(
        l + 1.914_602 * g.sin() + 0.019_993 * (2.0 * g).sin() + 0.000_289 * (3.0 * g).sin(),
    ) * DEG;
    let eps = obliquity_rad(jd);
    let ra = (eps.cos() * lambda.sin()).atan2(lambda.cos());
    let dec = (eps.sin() * lambda.sin()).asin();
    (ra, dec, lambda)
}

fn equatorial_altitude_deg(lat_deg: f64, lon_deg: f64, jd: f64, ra: f64, dec: f64) -> f64 {
    let phi = lat_deg * DEG;
    let lst = gmst_rad(jd) + lon_deg * DEG;
    let h = lst - ra;
    (phi.sin() * dec.sin() + phi.cos() * dec.cos() * h.cos()).asin() * RAD
}

fn moon_ra_dec_lambda_beta_dist(jd: f64) -> (f64, f64, f64, f64, f64) {
    // Low-precision geocentric lunar elements plus the largest periodic
    // perturbations from Paul Schlyter's Meeus-derived formulation. Distance is
    // returned in Earth radii for the topocentric parallax correction below.
    let d = jd - 2_451_543.5;
    let n_deg = norm360(125.122_8 - 0.052_953_808_3 * d);
    let n = n_deg * DEG;
    let inc = 5.145_4 * DEG;
    let arg_perigee_deg = norm360(318.063_4 + 0.164_357_322_3 * d);
    let arg_perigee = arg_perigee_deg * DEG;
    let a_er = 60.266_6;
    let ecc = 0.054_900;
    let mean_anomaly_deg = norm360(115.365_4 + 13.064_992_950_9 * d);
    let mean_anomaly = mean_anomaly_deg * DEG;

    let mut ecc_anomaly =
        mean_anomaly + ecc * mean_anomaly.sin() * (1.0 + ecc * mean_anomaly.cos());
    for _ in 0..3 {
        ecc_anomaly -= (ecc_anomaly - ecc * ecc_anomaly.sin() - mean_anomaly)
            / (1.0 - ecc * ecc_anomaly.cos());
    }

    let xv = a_er * (ecc_anomaly.cos() - ecc);
    let yv = a_er * (1.0 - ecc * ecc).sqrt() * ecc_anomaly.sin();
    let true_anomaly = yv.atan2(xv);
    let dist_er = xv.hypot(yv);

    let lon_arg = true_anomaly + arg_perigee;
    let xh = dist_er * (n.cos() * lon_arg.cos() - n.sin() * lon_arg.sin() * inc.cos());
    let yh = dist_er * (n.sin() * lon_arg.cos() + n.cos() * lon_arg.sin() * inc.cos());
    let zh = dist_er * lon_arg.sin() * inc.sin();
    let lon = yh.atan2(xh);
    let lat = zh.atan2(xh.hypot(yh));

    let lm = norm360(n_deg + arg_perigee_deg + mean_anomaly_deg);
    let ms = norm360(356.047_0 + 0.985_600_258_5 * d);
    let ls = norm360(280.460 + 0.985_647_4 * d);
    let mm = mean_anomaly_deg;
    let elong = norm360(lm - ls);
    let f = norm360(lm - n_deg);
    let sin_deg = |x: f64| (x * DEG).sin();

    let lon_deg = lon * RAD - 1.274 * sin_deg(mm - 2.0 * elong) + 0.658 * sin_deg(2.0 * elong)
        - 0.186 * sin_deg(ms)
        - 0.059 * sin_deg(2.0 * mm - 2.0 * elong)
        - 0.057 * sin_deg(mm - 2.0 * elong + ms)
        + 0.053 * sin_deg(mm + 2.0 * elong)
        + 0.046 * sin_deg(2.0 * elong - ms)
        + 0.041 * sin_deg(mm - ms)
        - 0.035 * sin_deg(elong)
        - 0.031 * sin_deg(mm + ms)
        - 0.015 * sin_deg(2.0 * f - 2.0 * elong)
        + 0.011 * sin_deg(mm - 4.0 * elong);

    let lat_deg = lat * RAD
        - 0.173 * sin_deg(f - 2.0 * elong)
        - 0.055 * sin_deg(mm - f - 2.0 * elong)
        - 0.046 * sin_deg(mm + f - 2.0 * elong)
        + 0.033 * sin_deg(f + 2.0 * elong)
        + 0.017 * sin_deg(2.0 * mm + f);

    let lambda = norm360(lon_deg) * DEG;
    let beta = lat_deg * DEG;
    let eps = obliquity_rad(jd);

    let x = lambda.cos() * beta.cos();
    let y = lambda.sin() * beta.cos();
    let z = beta.sin();
    let ye = y * eps.cos() - z * eps.sin();
    let ze = y * eps.sin() + z * eps.cos();
    let ra = ye.atan2(x);
    let dec = ze.atan2(x.hypot(ye));

    (ra, dec, lambda, beta, dist_er)
}

fn topocentric_moon_altitude_deg(
    lat_deg: f64,
    lon_deg: f64,
    jd: f64,
    ra: f64,
    dec: f64,
    dist_er: f64,
) -> f64 {
    let geocentric_alt = equatorial_altitude_deg(lat_deg, lon_deg, jd, ra, dec) * DEG;
    let parallax = (1.0 / dist_er).asin();
    (geocentric_alt - parallax * geocentric_alt.cos()) * RAD
}

/// Topocentric sun/moon state for an observer.
///
/// ACCURACY CONTRACT (vs anchors in contracts/fixtures/vectors/astronomy.json):
/// sun_alt ±0.3°, moon_alt ±0.5°, moon_illum ±0.02. Refraction ignored.
#[must_use]
pub fn sky_state(lat_deg: f64, lon_deg: f64, t_unix: f64) -> SkyState {
    let jd = unix_to_julian_day(t_unix);
    let (sun_ra, sun_dec, sun_lambda) = sun_ra_dec_lambda(jd);
    let sun_alt_deg = equatorial_altitude_deg(lat_deg, lon_deg, jd, sun_ra, sun_dec);

    let (moon_ra, moon_dec, moon_lambda, moon_beta, moon_dist_er) =
        moon_ra_dec_lambda_beta_dist(jd);
    let moon_alt_deg =
        topocentric_moon_altitude_deg(lat_deg, lon_deg, jd, moon_ra, moon_dec, moon_dist_er);

    let cos_elong = (moon_lambda - sun_lambda).cos() * moon_beta.cos();
    let elong = cos_elong.clamp(-1.0, 1.0).acos();
    let moon_illum_frac = ((1.0 - elong.cos()) / 2.0).clamp(0.0, 1.0);

    SkyState {
        sun_alt_deg,
        moon_alt_deg,
        moon_illum_frac,
    }
}
