/**
 * scene/magnetosphere.ts — Magnetopause compression & radiation-belt response.
 *
 * Pure physics, no three.js. Turns solar-wind conditions into the subsolar
 * magnetopause standoff distance (how far the dayside magnetic boundary is
 * pushed toward Earth) using the published Shue et al. (1998) empirical model,
 * and from that the state of the outer Van Allen belt and the geosynchronous
 * "satellite risk" flag.
 *
 * Shue, J.-H., et al. (1998), "Magnetopause location under extreme solar wind
 * conditions", J. Geophys. Res., 103(A8), 17691–17700.
 *
 * REAL vs DERIVED:
 *   `magnetosphereFromConditions` is the real model — feed it MEASURED solar-wind
 *   dynamic pressure + IMF Bz (e.g. live SWPC) and it returns the true standoff.
 *   `stormMagnetosphere` is a DERIVED driver: for the historical storm replay we
 *   don't have in-situ L1 plasma, so we map the scene's geomagnetic-activity
 *   curve (0..1) onto a plausible pressure/Bz ramp. It is labelled `derived`.
 */

/** Geosynchronous orbit radius in Earth radii (where most comms/GPS satellites fly). */
export const GEO_RE = 6.6;

/** Quiet-time subsolar magnetopause standoff (Re) — the reference "uncompressed" size. */
export const QUIET_STANDOFF_RE = 10.5;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Solar-wind dynamic pressure (nPa) from proton number density (cm⁻³) and bulk
 * speed (km/s): Pdyn = ρv². In these units Pdyn[nPa] ≈ 1.6726e-6 · n · v².
 */
export function dynamicPressureNPa(density_pcc: number, speed_kms: number): number {
  return 1.6726e-6 * density_pcc * speed_kms * speed_kms;
}

/** Shue (1998) subsolar standoff distance r₀ (Re). */
export function shueStandoffRe(pdyn_nPa: number, bz_nt: number): number {
  const p = Math.max(0.01, pdyn_nPa);
  return (10.22 + 1.29 * Math.tanh(0.184 * (bz_nt + 8.14))) * Math.pow(p, -1 / 6.6);
}

/** Shue (1998) flaring parameter α (controls how the boundary opens toward the tail). */
export function shueAlpha(pdyn_nPa: number, bz_nt: number): number {
  return (0.58 - 0.007 * bz_nt) * (1 + 0.024 * Math.log(Math.max(0.01, pdyn_nPa)));
}

/**
 * Shue (1998) magnetopause radius (Re) at angle θ measured from the subsolar
 * (Sun-facing) point: r(θ) = r₀ · (2 / (1 + cos θ))^α. θ=0 is the nose.
 */
export function shueRadiusRe(r0Re: number, alpha: number, thetaRad: number): number {
  return r0Re * Math.pow(2 / (1 + Math.cos(thetaRad)), alpha);
}

export interface MagnetosphereState {
  /** Solar-wind dynamic pressure (nPa). */
  pdyn_nPa: number;
  /** IMF Bz (nT) — southward (negative) opens the magnetosphere. */
  bz_nt: number;
  /** Subsolar magnetopause standoff distance (Re). */
  standoffRe: number;
  /** Shue flaring parameter α. */
  alpha: number;
  /** Outer Van Allen belt outer edge (Re) — shadowed/eroded as r₀ shrinks. */
  outerBeltOuterRe: number;
  /** Compression fraction 0 (quiet) → 1 (severely compressed inside GEO). */
  compression: number;
  /** True when the magnetopause is pushed inside geosynchronous orbit (6.6 Re). */
  insideGeo: boolean;
  /** True when these conditions are a derived proxy, not measured in-situ. */
  derived: boolean;
}

/** Build the full magnetosphere state from MEASURED solar-wind conditions. */
export function magnetosphereFromConditions(
  pdyn_nPa: number,
  bz_nt: number,
  derived = false,
): MagnetosphereState {
  const standoffRe = shueStandoffRe(pdyn_nPa, bz_nt);
  const alpha = shueAlpha(pdyn_nPa, bz_nt);
  // Nominal outer belt outer edge ~6.8 Re; the magnetopause shadows it as it
  // compresses (the outer belt cannot extend past the boundary).
  const outerBeltOuterRe = Math.max(3.0, Math.min(6.8, standoffRe - 0.6));
  // Compression: 0 at the quiet standoff, 1 once pushed to ~5 Re (well inside GEO).
  const compression = clamp01((QUIET_STANDOFF_RE - standoffRe) / (QUIET_STANDOFF_RE - 5));
  return {
    pdyn_nPa,
    bz_nt,
    standoffRe,
    alpha,
    outerBeltOuterRe,
    compression,
    insideGeo: standoffRe < GEO_RE,
    derived,
  };
}

/**
 * DERIVED magnetosphere conditions for a storm activity level 0..1 (from
 * `geomagneticActivity`). Maps the activity curve onto a quiet→shock ramp:
 * quiet ≈ 2 nPa / Bz −1, peak ≈ 16 nPa / Bz −16, which puts the magnetopause
 * just inside GEO at the storm peak. Not in-situ data — flagged `derived`.
 */
export function stormMagnetosphere(activity: number): MagnetosphereState {
  const a = clamp01(activity);
  const pdyn = 2 + a * a * 14; // nonlinear: jumps at shock arrival
  const bz = -1 - a * 15;
  return magnetosphereFromConditions(pdyn, bz, true);
}
