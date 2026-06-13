"""Reference implementation of the PINNED numeric semantics in
contracts/wasm-api/helio_core_api.rs.

This is the contract's executable form: the vector generator emits golden
vectors from these functions, and validate.py re-derives every vector from
them. The Rust helio-core crate must reproduce these to the tolerances stated
in the API doc. If you change anything here, you are changing the contract:
bump the version and regenerate vectors.
"""

import math

AU_KM = 1.495978707e8
SUN_RADIUS_KM = 6.957e5
FIXED_FALLBACK_DELAY_S = 1800.0


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


# --- §2.1 delay -------------------------------------------------------------

def l1_delay_seconds(distance_km, speed_kms):
    """Returns delay in seconds, or None for OutOfRange (caller falls back)."""
    if not (1.2e6 <= distance_km <= 1.8e6):
        return None
    if not (200.0 <= speed_kms <= 3000.0):
        return None
    return distance_km / speed_kms


# --- §6.1 DBM ---------------------------------------------------------------

def dbm_step(r_km, v_kms, gamma_per_km, ambient_wind_kms, dt_s):
    """Closed-form advance under dv/dt = -gamma*(v-w)|v-w|."""
    w = ambient_wind_kms
    u0 = v_kms - w
    g = gamma_per_km
    if g == 0.0 or u0 == 0.0:
        return (r_km + v_kms * dt_s, v_kms)
    a = g * abs(u0) * dt_s
    u = u0 / (1.0 + a)
    sign = 1.0 if u0 > 0 else -1.0
    r = r_km + w * dt_s + sign * math.log(1.0 + a) / g
    return (r, w + u)


def dbm_arrival(r0_km, v0_kms, t0_unix, gamma_per_km, ambient_wind_kms, target_r_km):
    """Bisection on t in [0, 30 days] to |dt| <= 1.0 s. None if unreachable."""
    horizon = 30.0 * 86400.0
    r_end, _ = dbm_step(r0_km, v0_kms, gamma_per_km, ambient_wind_kms, horizon)
    if r_end < target_r_km:
        return None
    lo, hi = 0.0, horizon
    while hi - lo > 1.0:
        mid = 0.5 * (lo + hi)
        r, _ = dbm_step(r0_km, v0_kms, gamma_per_km, ambient_wind_kms, mid)
        if r < target_r_km:
            lo = mid
        else:
            hi = mid
    t = 0.5 * (lo + hi)
    _, v = dbm_step(r0_km, v0_kms, gamma_per_km, ambient_wind_kms, t)
    return (t0_unix + t, v)


# --- §6.3 geometry & coupling -----------------------------------------------

def cone_contains_earth(apex_lon, apex_lat, half_angle, earth_lon, earth_lat, parker_offset):
    lam1 = math.radians(apex_lon + parker_offset)
    phi1 = math.radians(apex_lat)
    lam2 = math.radians(earth_lon)
    phi2 = math.radians(earth_lat)
    cosd = math.sin(phi1) * math.sin(phi2) + math.cos(phi1) * math.cos(phi2) * math.cos(lam1 - lam2)
    sep = math.degrees(math.acos(clamp(cosd, -1.0, 1.0)))
    return sep <= half_angle


def newell_coupling(v_kms, by_nt, bz_nt):
    bt = math.hypot(by_nt, bz_nt)
    if bt == 0.0:
        return 0.0
    theta = math.atan2(by_nt, bz_nt)
    return (v_kms ** (4.0 / 3.0)) * (bt ** (2.0 / 3.0)) * (abs(math.sin(theta / 2.0)) ** (8.0 / 3.0))


def dst_step(dst_nt, v_kms, bz_nt, density_pcc, dt_s):
    """One explicit-Euler step, O'Brien-McPherron 2000. density reserved/unused in v1.0."""
    bs = max(0.0, -bz_nt)
    vbs = v_kms * bs * 1e-3  # mV/m
    q = -4.4 * max(0.0, vbs - 0.49)  # nT/h
    tau = 2.40 * math.exp(9.74 / (4.69 + vbs))  # h
    return dst_nt + (dt_s / 3600.0) * (q - dst_nt / tau)


def kp_to_g(kp):
    if kp < 5:
        return 0
    if kp >= 9:
        return 5
    return int(kp) - 4


# --- §7.1 darkness + go-look ------------------------------------------------

def darkness_factor(sun_alt_deg):
    return clamp((-6.0 - sun_alt_deg) / 12.0, 0.0, 1.0)


LIMITER_ORDER = ["Daylight", "Oval", "CloudObserved", "CloudForecast", "Moon"]


def go_look(oval_visible_prob, sun_alt_deg, moon_alt_deg, moon_illum_frac,
            cloud_total_consensus, cloud_low_consensus, cloud_model_spread,
            satellite_clear_now):
    darkness = darkness_factor(sun_alt_deg)
    moon_factor = 1.0 - 0.6 * moon_illum_frac * clamp(math.sin(math.radians(moon_alt_deg)), 0.0, 1.0)
    clear_fcst = clamp(1.0 - (0.7 * cloud_low_consensus + 0.3 * cloud_total_consensus), 0.0, 1.0)
    if satellite_clear_now is None:
        clear = clear_fcst
        confidence = (1.0 - cloud_model_spread) * 0.85
    else:
        clear = 0.5 * clear_fcst + 0.5 * satellite_clear_now
        confidence = (1.0 - cloud_model_spread) * 1.0
    score = oval_visible_prob * darkness * moon_factor * clear
    if score >= 0.30:
        verdict = "Likely"
    elif score >= 0.10:
        verdict = "Possible"
    else:
        verdict = "Unlikely"
    factors = {
        "Daylight": darkness,
        "Oval": oval_visible_prob,
        "CloudObserved": satellite_clear_now if satellite_clear_now is not None else 1.0,
        "CloudForecast": clear_fcst,
        "Moon": moon_factor,
    }
    best = min(factors.values())
    limiter = next(name for name in LIMITER_ORDER if factors[name] == best)
    return {"score": score, "verdict": verdict, "confidence": confidence,
            "dominant_limiter": limiter}
