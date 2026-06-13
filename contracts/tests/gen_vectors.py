# /// script
# requires-python = ">=3.11"
# dependencies = ["ephem>=4.1"]
# ///
"""Golden-vector generator. Emits contracts/fixtures/vectors/*.json from the
reference formulas (formulas.py = the pinned semantics). Run via:

    uv run contracts/tests/gen_vectors.py

Regenerate ONLY when the contract version is deliberately bumped."""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import formulas as F

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fixtures" / "vectors"
RS = F.SUN_RADIUS_KM


def write(name, payload):
    payload = {"schema_version": "1.0.0", **payload}
    p = OUT / name
    p.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {p}")


# --- delay-correction.json ---------------------------------------------------
cases = []
for nm, d, v in [
    ("typical_quiet_400", 1.5e6, 400.0),
    ("storm_800_noaa_assumption", 1.5e6, 800.0),
    ("quiet_fixture_match", 1.48e6, 380.0),
    ("fast_storm_fixture_match", 1.52e6, 720.0),
    ("slow_wind_320", 1.61e6, 320.0),
]:
    cases.append({"name": nm, "inputs": {"spacecraft_earth_distance_km": d, "measured_speed_kms": v},
                  "expect": {"delay_s": F.l1_delay_seconds(d, v)}})
for nm, d, v in [
    ("speed_too_low_err", 1.5e6, 150.0),
    ("speed_too_high_err", 1.5e6, 3200.0),
    ("distance_out_of_range_err", 1.0e6, 400.0),
]:
    cases.append({"name": nm, "inputs": {"spacecraft_earth_distance_km": d, "measured_speed_kms": v},
                  "expect": {"error": "OutOfRange"}})
write("delay-correction.json", {"vectors": [{
    "function": "l1_delay_seconds",
    "tolerance": {"type": "relative", "value": 1e-9},
    "cases": cases,
}]})

# --- dbm.json -----------------------------------------------------------------
step_cases = []
for nm, r0, v0, g, w, dt in [
    ("fast_cme_1h", 21.5 * RS, 1350.0, 0.2e-7, 400.0, 3600.0),
    ("fast_cme_12h", 21.5 * RS, 1350.0, 0.2e-7, 400.0, 43200.0),
    ("slow_cme_accelerated_by_wind", 21.5 * RS, 300.0, 1.0e-7, 450.0, 7200.0),
    ("ballistic_gamma_zero", 21.5 * RS, 900.0, 0.0, 400.0, 3600.0),
    ("zero_dt_identity", 30.0 * RS, 800.0, 0.5e-7, 400.0, 0.0),
]:
    r, v = F.dbm_step(r0, v0, g, w, dt)
    step_cases.append({"name": nm,
                       "inputs": {"r_km": r0, "v_kms": v0, "gamma_per_km": g,
                                  "ambient_wind_kms": w, "dt_s": dt},
                       "expect": {"r_km": r, "v_kms": v}})

arr_cases = []
for nm, r0, v0, g, w, target in [
    ("fast_halo_to_1au", 21.5 * RS, 1350.0, 0.2e-7, 400.0, 1.488e8),
    ("moderate_cme_to_1au", 21.5 * RS, 600.0, 1.0e-7, 380.0, 1.488e8),
    ("slow_cme_to_1au", 21.5 * RS, 450.0, 0.5e-7, 420.0, 1.488e8),
]:
    t, v = F.dbm_arrival(r0, v0, 0.0, g, w, target)
    arr_cases.append({"name": nm,
                      "inputs": {"r_km": r0, "v_kms": v0, "t_unix": 0.0, "gamma_per_km": g,
                                 "ambient_wind_kms": w, "target_r_km": target},
                      "expect": {"t_arrival_unix": t, "v_arrival_kms": v,
                                 "transit_hours_approx": round(t / 3600.0, 2)}})
arr_cases.append({"name": "unreachable_in_30d_err",
                  "inputs": {"r_km": 21.5 * RS, "v_kms": 40.0, "t_unix": 0.0,
                             "gamma_per_km": 0.0, "ambient_wind_kms": 40.0,
                             "target_r_km": 1.488e8},
                  "expect": {"error": "OutOfRange"}})

cone_cases = []
for nm, alon, alat, ha, elon, elat, poff in [
    ("dead_center_hit", 0.0, 0.0, 30.0, 0.0, 0.0, 0.0),
    ("flank_hit_with_parker", -50.0, 5.0, 45.0, 0.0, 7.2, 10.0),
    ("near_miss_east_limb", -75.0, 0.0, 35.0, 0.0, 7.2, 10.0),
    ("backside_miss", 170.0, 10.0, 60.0, 0.0, 0.0, 10.0),
    ("boundary_exact_half_angle", 30.0, 0.0, 30.0, 0.0, 0.0, 0.0),
]:
    cone_cases.append({"name": nm,
                       "inputs": {"apex_lon_deg": alon, "apex_lat_deg": alat,
                                  "half_angle_deg": ha, "earth_helio_lon_deg": elon,
                                  "earth_helio_lat_deg": elat, "parker_offset_deg": poff},
                       "expect": {"contains": F.cone_contains_earth(alon, alat, ha, elon, elat, poff)}})

write("dbm.json", {"vectors": [
    {"function": "dbm_step", "tolerance": {"type": "relative", "value": 1e-9}, "cases": step_cases},
    {"function": "dbm_arrival",
     "tolerance": {"type": "absolute", "value": 2.0,
                   "note": "±2 s on t_arrival_unix; ±1e-6 km/s relative on v_arrival_kms; transit_hours_approx is informational"},
     "cases": arr_cases},
    {"function": "cone_contains_earth", "tolerance": {"type": "exact"}, "cases": cone_cases},
]})

# --- coupling.json --------------------------------------------------------------
newell_cases = []
for nm, v, by, bz in [
    ("southward_typical", 400.0, 0.0, -5.0),
    ("storm_southward_with_by", 700.0, 3.0, -10.0),
    ("northward_zero_coupling", 400.0, 0.0, 5.0),
    ("pure_by_half_coupling_angle", 500.0, 5.0, 0.0),
    ("zero_field", 450.0, 0.0, 0.0),
]:
    newell_cases.append({"name": nm, "inputs": {"v_kms": v, "by_nt": by, "bz_nt": bz},
                         "expect": {"coupling": F.newell_coupling(v, by, bz)}})

dst_cases = []
for nm, dst, v, bz, n, dt in [
    ("quiet_decay_only", -10.0, 380.0, 2.0, 4.0, 300.0),
    ("storm_main_phase_step", -50.0, 700.0, -15.0, 12.0, 300.0),
    ("onset_step_1min", 0.0, 600.0, -8.0, 8.0, 60.0),
    ("recovery_phase", -120.0, 450.0, 1.0, 5.0, 3600.0),
]:
    dst_cases.append({"name": nm,
                      "inputs": {"dst_nt": dst, "v_kms": v, "bz_nt": bz,
                                 "density_pcc": n, "dt_s": dt},
                      "expect": {"dst_next_nt": F.dst_step(dst, v, bz, n, dt)}})

kp_cases = [{"name": f"kp_{kp}", "inputs": {"kp": kp}, "expect": {"g": F.kp_to_g(kp)}}
            for kp in [0.0, 4.33, 4.99, 5.0, 5.67, 6.33, 7.0, 8.67, 8.99, 9.0]]

write("coupling.json", {"vectors": [
    {"function": "newell_coupling", "tolerance": {"type": "relative", "value": 1e-9}, "cases": newell_cases},
    {"function": "dst_step", "tolerance": {"type": "relative", "value": 1e-9}, "cases": dst_cases},
    {"function": "kp_to_g", "tolerance": {"type": "exact"}, "cases": kp_cases},
]})

# --- golook.json ------------------------------------------------------------------
dark_cases = [{"name": f"sun_alt_{a}", "inputs": {"sun_alt_deg": a},
               "expect": {"factor": F.darkness_factor(a)}}
              for a in [-25.0, -18.0, -12.0, -6.0, 0.0, 10.0]]

gl_cases = []
gl_inputs = [
    ("storm_night_clear_likely", dict(oval_visible_prob=0.65, sun_alt_deg=-30.0, moon_alt_deg=-10.0,
                                      moon_illum_frac=0.2, cloud_total_consensus=0.1,
                                      cloud_low_consensus=0.05, cloud_model_spread=0.1,
                                      satellite_clear_now=0.95)),
    ("moonlit_partly_cloudy_possible", dict(oval_visible_prob=0.45, sun_alt_deg=-20.0, moon_alt_deg=40.0,
                                            moon_illum_frac=0.95, cloud_total_consensus=0.4,
                                            cloud_low_consensus=0.25, cloud_model_spread=0.2,
                                            satellite_clear_now=0.7)),
    ("daylight_kills_it", dict(oval_visible_prob=0.9, sun_alt_deg=5.0, moon_alt_deg=-5.0,
                               moon_illum_frac=0.5, cloud_total_consensus=0.0,
                               cloud_low_consensus=0.0, cloud_model_spread=0.0,
                               satellite_clear_now=1.0)),
    ("satellite_leg_missing_degrades_confidence", dict(oval_visible_prob=0.5, sun_alt_deg=-25.0,
                                                       moon_alt_deg=-20.0, moon_illum_frac=0.1,
                                                       cloud_total_consensus=0.2, cloud_low_consensus=0.1,
                                                       cloud_model_spread=0.15, satellite_clear_now=None)),
    ("observed_overcast_blocks", dict(oval_visible_prob=0.7, sun_alt_deg=-30.0, moon_alt_deg=-15.0,
                                      moon_illum_frac=0.0, cloud_total_consensus=0.3,
                                      cloud_low_consensus=0.2, cloud_model_spread=0.6,
                                      satellite_clear_now=0.05)),
    ("weak_oval_unlikely", dict(oval_visible_prob=0.05, sun_alt_deg=-30.0, moon_alt_deg=-15.0,
                                moon_illum_frac=0.0, cloud_total_consensus=0.0,
                                cloud_low_consensus=0.0, cloud_model_spread=0.0,
                                satellite_clear_now=1.0)),
]
for nm, kw in gl_inputs:
    gl_cases.append({"name": nm, "inputs": kw, "expect": F.go_look(**kw)})

write("golook.json", {"vectors": [
    {"function": "darkness_factor", "tolerance": {"type": "relative", "value": 1e-9}, "cases": dark_cases},
    {"function": "go_look",
     "tolerance": {"type": "relative", "value": 1e-9,
                   "note": "score and confidence relative 1e-9; verdict and dominant_limiter exact"},
     "cases": gl_cases},
]})

# --- astronomy.json (anchors, tolerance per API contract) -----------------------
import ephem  # noqa: E402

anchors = []
for nm, lat, lon, when in [
    ("tromso_midnight_sun_jun", 69.65, 18.96, "2026/06/12 00:00:00"),
    ("reykjavik_winter_dark", 64.13, -21.90, "2026/01/15 23:00:00"),
    ("columbus_oh_evening", 40.00, -83.00, "2026/03/01 02:00:00"),
    ("fairbanks_equinox_night", 64.84, -147.72, "2026/03/21 10:00:00"),
]:
    obs = ephem.Observer()
    obs.lat, obs.lon = str(lat), str(lon)
    obs.date = when
    obs.pressure = 0  # contract: refraction ignored
    sun, moon = ephem.Sun(), ephem.Moon()
    sun.compute(obs)
    moon.compute(obs)
    t_unix = (obs.date.datetime() - ephem.Date("1970/01/01").datetime()).total_seconds()
    anchors.append({
        "name": nm,
        "inputs": {"lat_deg": lat, "lon_deg": lon, "t_unix": t_unix,
                   "iso_utc": when.replace("/", "-").replace(" ", "T") + "Z"},
        "expect": {"sun_alt_deg": round(math.degrees(float(sun.alt)), 3),
                   "moon_alt_deg": round(math.degrees(float(moon.alt)), 3),
                   "moon_illum_frac": round(float(moon.phase) / 100.0, 4)},
    })

write("astronomy.json", {"vectors": [{
    "function": "sky_state",
    "tolerance": {"type": "absolute",
                  "value": {"sun_alt_deg": 0.3, "moon_alt_deg": 0.5, "moon_illum_frac": 0.02},
                  "note": "anchors generated with pyephem, refraction off; any Meeus-class ephemeris must land inside these bands"},
    "cases": anchors,
}]})

print("done")
