/**
 * scene/cme-propagation.ts — Data-anchored CME front kinematics (Drag-Based Model).
 *
 * Pure functions, no three.js. The interplanetary leg of a CME is the one part
 * of the journey nothing images continuously, so it is *simulated* — but it is
 * not arbitrary. It is pinned to every measured/modelled anchor we have and the
 * physics between the anchors is the real solar-wind drag law, not an arbitrary
 * easing curve. The result is a front whose speed is physically meaningful and
 * whose position lands exactly on the data we show elsewhere.
 *
 * ANCHORS (all from NASA DONKI CME Analysis + WSA-Enlil):
 *   t0  liftoff time            → front at the Sun surface (R0).
 *   t1  21.5 R_sun crossing     → front at 0.1 AU (R1). DONKI's `time21_5`;
 *                                 when absent we derive it from the measured
 *                                 launch speed (the un-imaged near-Sun leg).
 *   v0  measured launch speed   → the front's speed at 21.5 R_sun.
 *   eta modelled ENLIL ETA      → front at 1 AU (Earth) at the predicted time.
 *
 * MODEL:
 *   • t0 → t1  (Sun → 0.1 AU): linear position interpolation between the two
 *     DONKI time/radius anchors. Its displayed leg speed is therefore derived
 *     from those anchors; DONKI's reported speed remains the t1/DBM input.
 *   • t1 → ∞   (0.1 AU outward): the Drag-Based Model (Vršnak 2013). The CME
 *     trades momentum with the ambient solar wind w, so a fast CME *decelerates*
 *     and a slow one *accelerates* — both asymptoting to w. The drag coefficient
 *     γ is SOLVED so the front reaches 1 AU exactly at the modelled ENLIL ETA.
 *     The start is measured, the far anchor and curve are modelled, and
 *     that curve is real drag physics. The front does NOT stop at Earth — it
 *     keeps coasting (still shedding speed toward w) out past Mars' orbit.
 *
 *   When no ETA is known we fall back to a pure forward DBM from v0 with a
 *   default drag coefficient (still physical, just unconstrained at the far end).
 */

import type { CmeEventData, HelioPoint } from './types';
import {
  AU_KM,
  SUN_RADIUS_KM,
  DEFAULT_DBM_GAMMA_PER_KM,
  DEFAULT_DBM_AMBIENT_WIND_KMS,
} from './constants';

const R0_KM = SUN_RADIUS_KM;
/** 21.5 R_sun ≈ 0.1 AU — the DONKI `time21_5` kinematic anchor. */
const R1_KM = 21.5 * SUN_RADIUS_KM;
/** The front keeps travelling past Earth out toward the scene edge (~2.6 AU). */
const MAX_R_KM = AU_KM * 2.6;
/** Ambient solar-wind speed the DBM relaxes the front toward (km/s). */
const AMBIENT_W_KMS = DEFAULT_DBM_AMBIENT_WIND_KMS;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Event liftoff in unix seconds (falls back to arrival-window start). */
function liftoffUnix(event: CmeEventData): number {
  if (event.liftoff_unix) return event.liftoff_unix;
  return event.arrivalWindow?.start ?? 0;
}

/** Modelled arrival ETA in unix seconds, or null. */
function etaUnix(event: CmeEventData): number | null {
  return event.arrivalWindow?.eta ?? null;
}

// ---------------------------------------------------------------------------
// Drag-Based Model — closed form (Vršnak 2013), stable for accel & decel.
//   v(τ) = w + Δv / (1 + γ|Δv|τ)
//   r(τ) = R1 + w·τ + sign(Δv)·ln(1 + γ|Δv|τ) / γ          (Δv = v0 − w)
// Using |Δv| in the denominator keeps it monotone toward w from either side
// (a slow CME speeds up to w; a fast CME slows down to w), with no singularity.
//
// NOTE — physics-core boundary: the verified core (`helio-core`, via
// `core/physics`) owns the *forecast* DBM as `dbm_step`/`dbm_arrival` (forward
// integration + arrival bisection). The scene instead needs random-access r(τ)
// and a γ fitted to the modelled ETA so the timeline can be scrubbed to any
// instant — the core does not expose those yet. The closed form below is the
// analytic solution of the *same* drag law the core integrates. TODO(R5):
// promote `dbm_distance`/`dbm_speed`/`solve_gamma` into the Rust crate (+ golden
// vectors) and call them here to retire this last local physics copy.
// ---------------------------------------------------------------------------

/** Distance travelled past R1 over elapsed `tau_s`, given Δv, wind, drag γ. */
function dbmDistanceKm(tau_s: number, dv_kms: number, w_kms: number, gamma_per_km: number): number {
  if (tau_s <= 0) return 0;
  const adv = Math.abs(dv_kms);
  const s = Math.sign(dv_kms);
  if (adv < 1e-6 || gamma_per_km <= 0) return (w_kms + dv_kms) * tau_s; // ~constant v0
  return w_kms * tau_s + (s * Math.log(1 + gamma_per_km * adv * tau_s)) / gamma_per_km;
}

/** DBM speed (km/s) at elapsed `tau_s`. */
function dbmSpeedKms(tau_s: number, dv_kms: number, w_kms: number, gamma_per_km: number): number {
  if (tau_s <= 0) return w_kms + dv_kms;
  const adv = Math.abs(dv_kms);
  if (adv < 1e-6 || gamma_per_km <= 0) return w_kms + dv_kms;
  return w_kms + dv_kms / (1 + gamma_per_km * adv * tau_s);
}

/**
 * Solve the drag coefficient γ so a CME launched past R1 at speed `v0` into wind
 * `w` covers exactly `R` km in `T` s (i.e. reaches 1 AU at the modelled ETA).
 * Returns null when no positive γ can fit the anchors (then the caller uses a
 * straight constant-speed interpolation so the arrival anchor is still honoured).
 */
function solveDbmGamma(R_km: number, T_s: number, v0_kms: number, w_kms: number): number | null {
  if (T_s <= 0) return null;
  const dv = v0_kms - w_kms;
  if (Math.abs(dv) < 1) return null; // v0 ≈ w → effectively constant speed
  const avg = R_km / T_s;
  const lo = Math.min(v0_kms, w_kms);
  const hi = Math.max(v0_kms, w_kms);
  // A drag solution exists only when the required average speed sits between the
  // launch speed and the wind speed — the physical band the front relaxes across.
  if (avg <= lo || avg >= hi) return null;

  const f = (g: number) => dbmDistanceKm(T_s, dv, w_kms, g) - R_km;
  let gLo = 1e-12;
  let gHi = 1e-4;
  let fLo = f(gLo);
  const fHi = f(gHi);
  if (fLo === 0) return gLo;
  if (fHi === 0) return gHi;
  if (fLo * fHi > 0) return null; // not bracketed within sane γ range
  for (let i = 0; i < 80; i += 1) {
    const gMid = Math.sqrt(gLo * gHi); // geometric midpoint — γ spans many decades
    const fMid = f(gMid);
    if (Math.abs(fMid) < 1) return gMid;
    if (fLo * fMid < 0) {
      gHi = gMid;
    } else {
      gLo = gMid;
      fLo = fMid;
    }
  }
  return Math.sqrt(gLo * gHi);
}

// ---------------------------------------------------------------------------
// Per-event kinematics (memoised) — the anchors + the fitted drag law.
// ---------------------------------------------------------------------------

export interface CmeKinematics {
  /** Liftoff (front at Sun surface). */
  t0_unix: number;
  /** 21.5 R_sun crossing (front at 0.1 AU). */
  t1_unix: number;
  /** Measured launch speed at 21.5 R_sun (km/s). */
  v0_kms: number;
  /** Ambient solar-wind speed the front relaxes toward (km/s). */
  w_kms: number;
  /** Fitted drag coefficient (1/km), or null when phase 2 is a straight interp. */
  gamma_per_km: number | null;
  /** Constant phase-2 speed used when gamma is null (km/s). */
  vConst_kms: number;
  /** True when the far end is pinned to a modelled ETA. */
  etaPinned: boolean;
  /** Speed at the 1 AU arrival anchor (km/s) — for readouts. */
  arrivalSpeed_kms: number;
}

const KIN_CACHE = new WeakMap<CmeEventData, CmeKinematics>();

/** Build (and cache) the anchored kinematics for an event. */
export function cmeKinematics(event: CmeEventData): CmeKinematics {
  const cached = KIN_CACHE.get(event);
  if (cached) return cached;

  const t0 = liftoffUnix(event);
  const v0 = Math.max(50, event.speed_kms || 500);
  const w = AMBIENT_W_KMS;
  // Near-Sun leg: measured 21.5 R_sun time when present, else derived from v0.
  const t1 = event.time21_5_unix ?? t0 + (R1_KM - R0_KM) / v0;
  const eta = etaUnix(event);

  let kin: CmeKinematics;
  if (!eta || eta <= t1) {
    // No usable far anchor — pure forward DBM from the measured launch speed.
    kin = {
      t0_unix: t0,
      t1_unix: t1,
      v0_kms: v0,
      w_kms: w,
      gamma_per_km: DEFAULT_DBM_GAMMA_PER_KM,
      vConst_kms: 0,
      etaPinned: false,
      arrivalSpeed_kms: dbmSpeedKms(
        (AU_KM - R1_KM) / Math.max(v0, w),
        v0 - w,
        w,
        DEFAULT_DBM_GAMMA_PER_KM,
      ),
    };
  } else {
    const T = eta - t1;
    const R = AU_KM - R1_KM;
    const gamma = solveDbmGamma(R, T, v0, w);
    if (gamma == null) {
      // Anchors can't be reconciled by drag alone — honour the ETA with a
      // straight constant-speed interpolation (still lands on the data).
      const vConst = R / T;
      kin = {
        t0_unix: t0,
        t1_unix: t1,
        v0_kms: v0,
        w_kms: w,
        gamma_per_km: null,
        vConst_kms: vConst,
        etaPinned: true,
        arrivalSpeed_kms: vConst,
      };
    } else {
      kin = {
        t0_unix: t0,
        t1_unix: t1,
        v0_kms: v0,
        w_kms: w,
        gamma_per_km: gamma,
        vConst_kms: 0,
        etaPinned: true,
        arrivalSpeed_kms: dbmSpeedKms(T, v0 - w, w, gamma),
      };
    }
  }

  KIN_CACHE.set(event, kin);
  return kin;
}

/**
 * Closed-form DBM radius (km) at `elapsed_s` after the 21.5 R_sun crossing for a
 * CME launched at `v0` into ambient wind `w` with drag `gamma`. Exported for
 * tests / external callers; the scene uses `cmeFrontRadiusKm`.
 */
export function dbmRadiusKm(
  elapsed_s: number,
  v0_kms: number,
  w_kms: number = AMBIENT_W_KMS,
  gamma: number = DEFAULT_DBM_GAMMA_PER_KM,
): number {
  if (elapsed_s <= 0) return R1_KM;
  return R1_KM + dbmDistanceKm(elapsed_s, v0_kms - w_kms, w_kms, gamma);
}

/**
 * Radius (km from Sun centre) of the CME front at a given time, anchored to the
 * measured liftoff, 21.5 R_sun crossing and launch speed, plus a modelled ETA.
 */
export function cmeFrontRadiusKm(event: CmeEventData, unix: number): number {
  const k = cmeKinematics(event);
  if (unix <= k.t0_unix) return R0_KM;
  if (unix <= k.t1_unix) {
    // Near-Sun leg: straight position interpolation between two DONKI anchors.
    const f = (unix - k.t0_unix) / Math.max(1, k.t1_unix - k.t0_unix);
    return R0_KM + (R1_KM - R0_KM) * f;
  }
  const tau = unix - k.t1_unix;
  const r =
    k.gamma_per_km == null
      ? R1_KM + k.vConst_kms * tau
      : R1_KM + dbmDistanceKm(tau, k.v0_kms - k.w_kms, k.w_kms, k.gamma_per_km);
  return Math.min(MAX_R_KM, r);
}

/**
 * Instantaneous front speed (km/s) at a given time. This is the physically
 * meaningful speed the UI surfaces: the derived anchor-to-anchor speed before
 * 21.5 R_sun, then the measured DONKI speed relaxing toward ambient wind.
 */
export function cmeFrontSpeedKms(event: CmeEventData, unix: number): number {
  const k = cmeKinematics(event);
  // Exactly at liftoff the measured launch velocity is already defined. Zero
  // applies only before the event exists; using <= produced a contradictory
  // "0 km/s · measured launch" readout at the launch milestone.
  if (unix < k.t0_unix) return 0;
  if (unix < k.t1_unix) return (R1_KM - R0_KM) / Math.max(1, k.t1_unix - k.t0_unix);
  if (cmeFrontRadiusKm(event, unix) >= MAX_R_KM) return k.w_kms; // parked at edge
  const tau = unix - k.t1_unix;
  if (k.gamma_per_km == null) return k.vConst_kms;
  return dbmSpeedKms(tau, k.v0_kms - k.w_kms, k.w_kms, k.gamma_per_km);
}

/** Front position as a scene HelioPoint along the CME source direction. */
export function cmeFrontPoint(event: CmeEventData, unix: number): HelioPoint {
  return {
    lon_deg: event.sourcePosition.lon_deg,
    lat_deg: event.sourcePosition.lat_deg,
    r_km: cmeFrontRadiusKm(event, unix),
  };
}

/** 0 before liftoff → 1 at arrival ETA (clamped). */
export function arrivalProgress(event: CmeEventData, unix: number): number {
  const t0 = liftoffUnix(event);
  const eta = etaUnix(event);
  if (!eta || eta <= t0) {
    return clamp01((cmeFrontRadiusKm(event, unix) - R0_KM) / (AU_KM - R0_KM));
  }
  return clamp01((unix - t0) / (eta - t0));
}

export function hasErupted(event: CmeEventData, unix: number): boolean {
  return unix >= liftoffUnix(event);
}

export function hasArrived(event: CmeEventData, unix: number): boolean {
  const eta = etaUnix(event);
  return eta !== null && unix >= eta;
}

/**
 * Labelled replay-only event activity proxy, 0..1: quiet until the modelled
 * front nears Earth, then a bounded main phase and recovery. This may drive the
 * replay magnetosphere illustration; it is never substituted for live L1 or
 * OVATION measurements.
 */
export function geomagneticActivity(event: CmeEventData, unix: number): number {
  const eta = etaUnix(event);
  if (!eta) return arrivalProgress(event, unix) > 0.92 ? 0.6 : 0;
  const t0 = liftoffUnix(event);
  const span = Math.max(1, eta - t0);

  if (unix < eta) {
    // Ramp in over the final ~15% of the transit.
    return 0.85 * smoothstep(0.85, 1, (unix - t0) / span);
  }
  // Main phase then recovery.
  const stormHold_s = 6 * 3600;
  const recovery_s = 18 * 3600;
  const since = unix - eta;
  if (since <= stormHold_s) return 1;
  return Math.max(0, 1 - smoothstep(0, recovery_s, since - stormHold_s));
}
