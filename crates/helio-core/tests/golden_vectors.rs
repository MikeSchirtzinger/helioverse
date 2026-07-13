use helio_core::*;

const DBM_JSON: &str = include_str!("../../../contracts/fixtures/vectors/dbm.json");
const COUPLING_JSON: &str = include_str!("../../../contracts/fixtures/vectors/coupling.json");
const DELAY_JSON: &str = include_str!("../../../contracts/fixtures/vectors/delay-correction.json");
const GOLOOK_JSON: &str = include_str!("../../../contracts/fixtures/vectors/golook.json");
const ASTRONOMY_JSON: &str = include_str!("../../../contracts/fixtures/vectors/astronomy.json");

fn assert_close(actual: f64, expect: f64, abs_tol: f64) {
    assert!(
        (actual - expect).abs() <= abs_tol,
        "actual {actual:?} expected {expect:?} abs diff {} > {abs_tol}",
        (actual - expect).abs()
    );
}

fn assert_rel_close(actual: f64, expect: f64, rel_tol: f64) {
    let scale = expect.abs().max(1.0);
    assert_close(actual, expect, rel_tol * scale);
}

#[test]
fn golden_fixtures_are_wired() {
    for (json, marker) in [
        (DBM_JSON, "dbm_arrival"),
        (COUPLING_JSON, "newell_coupling"),
        (DELAY_JSON, "l1_delay_seconds"),
        (GOLOOK_JSON, "go_look"),
        (ASTRONOMY_JSON, "sky_state"),
    ] {
        assert!(json.contains("\"schema_version\": \"1.0.0\""));
        assert!(json.contains(marker));
    }
}

#[test]
fn delay_correction_vectors() -> Result<(), CoreError> {
    let ok_cases = [
        (1_500_000.0, 400.0, 3750.0),
        (1_500_000.0, 800.0, 1875.0),
        (1_480_000.0, 380.0, 3_894.736_842_105_263_3),
        (1_520_000.0, 720.0, 2_111.111_111_111_111_3),
        (1_610_000.0, 320.0, 5031.25),
    ];
    for (distance, speed, expect) in ok_cases {
        assert_rel_close(l1_delay_seconds(distance, speed)?, expect, 1e-9);
    }
    assert_eq!(
        l1_delay_seconds(1_500_000.0, 150.0),
        Err(CoreError::OutOfRange)
    );
    assert_eq!(
        l1_delay_seconds(1_500_000.0, 3200.0),
        Err(CoreError::OutOfRange)
    );
    assert_eq!(
        l1_delay_seconds(1_000_000.0, 400.0),
        Err(CoreError::OutOfRange)
    );
    Ok(())
}

#[test]
fn dbm_step_vectors() {
    let cases = [
        (
            14_957_550.0,
            1350.0,
            2e-8,
            400.0,
            3600.0,
            19_705_660.112_683_438,
            1_289.180_082_366_155_1,
        ),
        (
            14_957_550.0,
            1350.0,
            2e-8,
            400.0,
            43_200.0,
            62_201_348.247_493_744,
            921.748_681_898_066_7,
        ),
        (
            14_957_550.0,
            300.0,
            1e-7,
            450.0,
            7200.0,
            17_171_984.116_749_078,
            314.620_938_628_158_85,
        ),
        (14_957_550.0, 900.0, 0.0, 400.0, 3600.0, 18_197_550.0, 900.0),
        (20_871_000.0, 800.0, 5e-8, 400.0, 0.0, 20_871_000.0, 800.0),
    ];
    for (r, v, gamma, wind, dt, exp_r, exp_v) in cases {
        let state = CmeState {
            r_km: r,
            v_kms: v,
            t_unix: 123.0,
        };
        let params = DbmParams {
            gamma_per_km: gamma,
            ambient_wind_kms: wind,
        };
        let got = dbm_step(&state, &params, dt);
        assert_rel_close(got.r_km, exp_r, 1e-9);
        assert_rel_close(got.v_kms, exp_v, 1e-9);
        assert_close(got.t_unix, 123.0 + dt, 0.0);
    }
}

#[test]
fn dbm_arrival_vectors() -> Result<(), CoreError> {
    let cases = [
        (
            14_957_550.0,
            1350.0,
            0.0,
            2e-8,
            400.0,
            148_800_000.0,
            160_047.489_166_259_77,
            635.096_008_476_426_4,
        ),
        (
            14_957_550.0,
            600.0,
            0.0,
            1e-7,
            380.0,
            148_800_000.0,
            298_926.349_639_892_6,
            409.037_615_449_770_4,
        ),
        (
            14_957_550.0,
            450.0,
            0.0,
            5e-8,
            420.0,
            148_800_000.0,
            300_932.933_807_373_05,
            440.669_706_757_011_6,
        ),
    ];
    for (r, v, t, gamma, wind, target, exp_t, exp_v) in cases {
        let state = CmeState {
            r_km: r,
            v_kms: v,
            t_unix: t,
        };
        let params = DbmParams {
            gamma_per_km: gamma,
            ambient_wind_kms: wind,
        };
        let (got_t, got_v) = dbm_arrival(&state, &params, target)?;
        assert_close(got_t, exp_t, 2.0);
        assert_rel_close(got_v, exp_v, 1e-6);
    }

    let unreachable = CmeState {
        r_km: 14_957_550.0,
        v_kms: 40.0,
        t_unix: 0.0,
    };
    let params = DbmParams {
        gamma_per_km: 0.0,
        ambient_wind_kms: 40.0,
    };
    assert_eq!(
        dbm_arrival(&unreachable, &params, 148_800_000.0),
        Err(CoreError::OutOfRange)
    );
    Ok(())
}

#[test]
fn cone_contains_earth_vectors() {
    let cases = [
        (0.0, 0.0, 30.0, 0.0, 0.0, 0.0, true),
        (-50.0, 5.0, 45.0, 0.0, 7.2, 10.0, true),
        (-75.0, 0.0, 35.0, 0.0, 7.2, 10.0, false),
        (170.0, 10.0, 60.0, 0.0, 0.0, 10.0, false),
        (30.0, 0.0, 30.0, 0.0, 0.0, 0.0, true),
    ];
    for (apex_lon, apex_lat, half, earth_lon, earth_lat, parker, expect) in cases {
        assert_eq!(
            cone_contains_earth(apex_lon, apex_lat, half, earth_lon, earth_lat, parker),
            expect
        );
    }
}

#[test]
fn coupling_vectors() {
    for (v, by, bz, expect) in [
        (400.0, 0.0, -5.0, 8_617.738_760_127_531),
        (700.0, 3.0, -10.0, 28_857.924_865_405_657),
        (400.0, 0.0, 5.0, 0.0),
        (500.0, 5.0, 0.0, 4_605.039_373_300_48),
        (450.0, 0.0, 0.0, 0.0),
    ] {
        assert_rel_close(newell_coupling(v, by, bz), expect, 1e-9);
    }

    for (dst, v, bz, den, dt, expect) in [
        (-10.0, 380.0, 2.0, 4.0, 300.0, -9.956_480_638_849_2),
        (-50.0, 700.0, -15.0, 12.0, 300.0, -52.756_003_317_414_83),
        (0.0, 600.0, -8.0, 8.0, 60.0, -0.316_066_666_666_666_66),
        (-120.0, 450.0, 1.0, 5.0, 3600.0, -113.733_211_994_284_87),
    ] {
        assert_rel_close(dst_step(dst, v, bz, den, dt), expect, 1e-9);
    }

    for (kp, g) in [
        (0.0, 0),
        (4.33, 0),
        (4.99, 0),
        (5.0, 1),
        (5.67, 1),
        (6.33, 2),
        (7.0, 3),
        (8.67, 4),
        (8.99, 4),
        (9.0, 5),
    ] {
        assert_eq!(kp_to_g(kp), g);
    }
}

#[test]
fn golook_vectors() {
    for (sun_alt, expect) in [
        (-25.0, 1.0),
        (-18.0, 1.0),
        (-12.0, 0.5),
        (-6.0, 0.0),
        (0.0, 0.0),
        (10.0, 0.0),
    ] {
        assert_rel_close(darkness_factor(sun_alt), expect, 1e-9);
    }

    let cases = [
        (
            GoLookInputs {
                oval_visible_prob: 0.65,
                sun_alt_deg: -30.0,
                moon_alt_deg: -10.0,
                moon_illum_frac: 0.2,
                cloud_total_consensus: 0.1,
                cloud_low_consensus: 0.05,
                cloud_model_spread: 0.1,
                satellite_clear_now: Some(0.95),
            },
            0.612_625,
            Verdict::Likely,
            0.9,
            Limiter::Oval,
        ),
        (
            GoLookInputs {
                oval_visible_prob: 0.45,
                sun_alt_deg: -20.0,
                moon_alt_deg: 40.0,
                moon_illum_frac: 0.95,
                cloud_total_consensus: 0.4,
                cloud_low_consensus: 0.25,
                cloud_model_spread: 0.2,
                satellite_clear_now: Some(0.7),
            },
            0.200_300_297_126_070_36,
            Verdict::Possible,
            0.8,
            Limiter::Oval,
        ),
        (
            GoLookInputs {
                oval_visible_prob: 0.9,
                sun_alt_deg: 5.0,
                moon_alt_deg: -5.0,
                moon_illum_frac: 0.5,
                cloud_total_consensus: 0.0,
                cloud_low_consensus: 0.0,
                cloud_model_spread: 0.0,
                satellite_clear_now: Some(1.0),
            },
            0.0,
            Verdict::Unlikely,
            1.0,
            Limiter::Daylight,
        ),
        (
            GoLookInputs {
                oval_visible_prob: 0.5,
                sun_alt_deg: -25.0,
                moon_alt_deg: -20.0,
                moon_illum_frac: 0.1,
                cloud_total_consensus: 0.2,
                cloud_low_consensus: 0.1,
                cloud_model_spread: 0.15,
                satellite_clear_now: None,
            },
            0.435,
            Verdict::Likely,
            0.722_499_999_999_999_9,
            Limiter::Oval,
        ),
        (
            GoLookInputs {
                oval_visible_prob: 0.7,
                sun_alt_deg: -30.0,
                moon_alt_deg: -15.0,
                moon_illum_frac: 0.0,
                cloud_total_consensus: 0.3,
                cloud_low_consensus: 0.2,
                cloud_model_spread: 0.6,
                satellite_clear_now: Some(0.05),
            },
            0.287,
            Verdict::Possible,
            0.4,
            Limiter::CloudObserved,
        ),
        (
            GoLookInputs {
                oval_visible_prob: 0.05,
                sun_alt_deg: -30.0,
                moon_alt_deg: -15.0,
                moon_illum_frac: 0.0,
                cloud_total_consensus: 0.0,
                cloud_low_consensus: 0.0,
                cloud_model_spread: 0.0,
                satellite_clear_now: Some(1.0),
            },
            0.05,
            Verdict::Unlikely,
            1.0,
            Limiter::Oval,
        ),
    ];

    for (inputs, score, verdict, confidence, limiter) in cases {
        let got = go_look(&inputs);
        assert_rel_close(got.score, score, 1e-9);
        assert_eq!(got.verdict, verdict);
        assert_rel_close(got.confidence, confidence, 1e-9);
        assert_eq!(got.dominant_limiter, limiter);
    }
}

#[test]
fn astronomy_vectors() {
    let cases = [
        (69.65, 18.96, 1_781_222_400.0, 3.787, 8.128, 0.1428),
        (64.13, -21.9, 1_768_518_000.0, -39.608, -54.549, 0.0791),
        (40.0, -83.0, 1_772_330_400.0, -30.595, 58.676, 0.9319),
        (64.84, -147.72, 1_774_087_200.0, -24.844, -7.419, 0.0741),
    ];

    for (lat, lon, t, exp_sun, exp_moon_alt, exp_illum) in cases {
        let got = sky_state(lat, lon, t);
        assert_close(got.sun_alt_deg, exp_sun, 0.3);
        assert_close(got.moon_alt_deg, exp_moon_alt, 0.5);
        assert_close(got.moon_illum_frac, exp_illum, 0.02);
    }
}
