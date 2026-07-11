/**
 * core/physics.ts — the single source of physics truth for the browser client.
 *
 * Every physics/scoring number in Helioverse (DBM propagation, L1 delay, Newell
 * coupling, Dst*, Kp→G, sky ephemeris, the go-look score) is computed by
 * `crates/helio-core` — the Rust crate verified against the golden vectors in
 * `contracts/fixtures/vectors/` to 1e-9 — compiled to WASM. This module is the
 * ONLY place the raw WASM surface is touched; everything else imports these
 * typed wrappers.
 *
 * There is intentionally NO second TypeScript implementation of any of these.
 * Before this module existed, the app shipped a parallel hand-written TS copy of
 * the same formulas that nothing verified; that fork has been deleted. If you
 * need a new physics quantity, add it to the Rust crate (+ a golden vector),
 * rebuild the WASM (`pnpm -w build:wasm`), and surface it here.
 *
 * Init: `initPhysics()` MUST resolve before any wrapper below is called. The app
 * awaits it in `main.tsx` before the first render; the node golden test
 * (`physics.golden.ts`) awaits it with the raw `.wasm` bytes. All wrappers are
 * synchronous once initialised, so they are safe to call inside the render loop.
 */

// Relative (not `@/`) so this resolves identically under Vite and tsx/node.
import init, * as wasm from '../wasm/helio-core/helio_core.js';

let initialized = false;

/**
 * Instantiate the WASM core. Idempotent.
 *
 * @param input  Browser: the hashed `.wasm` URL (from `?url`). Node/test: the
 *               raw `.wasm` bytes (`BufferSource`). Omitted: the glue resolves
 *               the sibling `.wasm` via `import.meta.url` (works under plain
 *               `--target web`, but Vite builds should pass the `?url`).
 */
export async function initPhysics(input?: wasm.InitInput): Promise<void> {
  if (initialized) return;
  // wasm-bindgen ≥0.2.93 takes a single `{ module_or_path }` object; the bare
  // positional form still works but logs a deprecation warning. Adapt here so
  // this stays the only module that knows the glue's init shape.
  await init(input === undefined ? undefined : { module_or_path: input });
  initialized = true;
}

/** True once the WASM core is instantiated and the wrappers are callable. */
export function physicsReady(): boolean {
  return initialized;
}

/**
 * Read element `i` of a fixed-length numeric array returned by the WASM core.
 * The core's multi-value returns are `Float64Array`; `noUncheckedIndexedAccess`
 * widens element access to `number | undefined`, so this asserts the contract
 * length and fails loudly if the core ever returns a short array.
 */
function at(arr: Float64Array, i: number): number {
  const v = arr[i];
  if (v === undefined) {
    throw new Error(`helio-core: result array missing index ${i}`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Pinned constants (from the WASM core, not re-typed here).
// ---------------------------------------------------------------------------

export const AU_KM = (): number => wasm.au_km();
export const SUN_RADIUS_KM = (): number => wasm.sun_radius_km();

// ---------------------------------------------------------------------------
// L1→Earth measured-delay correction.
// ---------------------------------------------------------------------------

/**
 * Ballistic L1→Earth delay (s) from the measured bulk speed, or `null` when the
 * inputs are out of the pinned validity range (distance 1.2–1.8 Mkm, speed
 * 200–3000 km/s). Callers must surface unavailable rather than invent a delay.
 */
export function l1DelaySeconds(
  spacecraftEarthDistanceKm: number,
  measuredSpeedKms: number,
): number | null {
  const d = wasm.l1_delay_seconds(spacecraftEarthDistanceKm, measuredSpeedKms);
  return d === undefined ? null : d;
}

// ---------------------------------------------------------------------------
// Drag-Based Model.
// ---------------------------------------------------------------------------

export interface CmeState {
  /** Heliocentric distance of the apex front (km). */
  rKm: number;
  /** Front speed (km/s). */
  vKms: number;
  /** Time of this state (unix seconds). */
  tUnix: number;
}

export interface DbmParams {
  /** Drag parameter γ (1/km). */
  gammaPerKm: number;
  /** Ambient solar-wind speed the front relaxes toward (km/s). */
  ambientWindKms: number;
}

/** Advance a CME front by `dtS` under the pinned DBM closed form. */
export function dbmStep(state: CmeState, params: DbmParams, dtS: number): CmeState {
  const out = wasm.dbm_step(
    state.rKm,
    state.vKms,
    state.tUnix,
    params.gammaPerKm,
    params.ambientWindKms,
    dtS,
  );
  return { rKm: at(out, 0), vKms: at(out, 1), tUnix: at(out, 2) };
}

/**
 * Arrival time + speed at `targetRKm`, or `null` if the front cannot reach the
 * target within 30 days (bisection to ≤1 s per the contract).
 */
export function dbmArrival(
  liftoff: CmeState,
  params: DbmParams,
  targetRKm: number,
): { tArrivalUnix: number; vArrivalKms: number } | null {
  const out = wasm.dbm_arrival(
    liftoff.rKm,
    liftoff.vKms,
    liftoff.tUnix,
    params.gammaPerKm,
    params.ambientWindKms,
    targetRKm,
  );
  return out ? { tArrivalUnix: at(out, 0), vArrivalKms: at(out, 1) } : null;
}

/** Does the CME cone's angular span contain Earth? */
export function coneContainsEarth(
  apexLonDeg: number,
  apexLatDeg: number,
  halfAngleDeg: number,
  earthHelioLonDeg: number,
  earthHelioLatDeg: number,
  parkerOffsetDeg: number,
): boolean {
  return wasm.cone_contains_earth(
    apexLonDeg,
    apexLatDeg,
    halfAngleDeg,
    earthHelioLonDeg,
    earthHelioLatDeg,
    parkerOffsetDeg,
  );
}

// ---------------------------------------------------------------------------
// Newell coupling, Dst* ODE, Kp→G.
// ---------------------------------------------------------------------------

/** Newell solar-wind–magnetosphere coupling dΦ_MP/dt (arbitrary units). */
export function newellCoupling(vKms: number, byNt: number, bzNt: number): number {
  return wasm.newell_coupling(vKms, byNt, bzNt);
}

/** One explicit-Euler step of the O'Brien–McPherron Dst* ODE (nT). */
export function dstStep(
  dstNt: number,
  vKms: number,
  bzNt: number,
  densityPcc: number,
  dtS: number,
): number {
  return wasm.dst_step(dstNt, vKms, bzNt, densityPcc, dtS);
}

/** Kp → NOAA G-scale (0–5). */
export function kpToG(kp: number): number {
  return wasm.kp_to_g(kp);
}

// ---------------------------------------------------------------------------
// Sky astronomy and local viewing score.
// ---------------------------------------------------------------------------

export interface SkyState {
  sunAltDeg: number;
  moonAltDeg: number;
  /** Illuminated fraction of the lunar disk, 0..1. */
  moonIllumFrac: number;
}

/** Topocentric sun/moon state for an observer (Meeus-class ephemeris, no I/O). */
export function skyState(latDeg: number, lonDeg: number, tUnix: number): SkyState {
  const o = wasm.sky_state(latDeg, lonDeg, tUnix);
  return { sunAltDeg: at(o, 0), moonAltDeg: at(o, 1), moonIllumFrac: at(o, 2) };
}

/** Darkness factor for aurora visibility: clamp((−6 − sunAlt)/12, 0, 1). */
export function darknessFactor(sunAltDeg: number): number {
  return wasm.darkness_factor(sunAltDeg);
}

export type Verdict = 'Likely' | 'Possible' | 'Unlikely';
export type Limiter = 'Daylight' | 'Oval' | 'CloudObserved' | 'CloudForecast' | 'Moon';

// Index order MUST match the discriminants packed in wasm.rs `go_look`.
const VERDICT_BY_IDX: readonly Verdict[] = ['Likely', 'Possible', 'Unlikely'];
const LIMITER_BY_IDX: readonly Limiter[] = [
  'Daylight',
  'Oval',
  'CloudObserved',
  'CloudForecast',
  'Moon',
];

export interface GoLookInputs {
  ovalVisibleProb: number;
  sunAltDeg: number;
  moonAltDeg: number;
  moonIllumFrac: number;
  cloudTotalConsensus: number;
  cloudLowConsensus: number;
  cloudModelSpread: number;
  /** GOES CSM point answer 0..1 clear; `null` when the satellite leg is unavailable. */
  satelliteClearNow: number | null;
}

export interface GoLookScore {
  score: number;
  verdict: Verdict;
  confidence: number;
  /** The factor that most limits tonight (drives "why it might be wrong"). */
  dominantLimiter: Limiter;
}

/** The on-device "go look" score. v1.0 heuristic (scalar inputs only). */
export function goLook(inputs: GoLookInputs): GoLookScore {
  const o = wasm.go_look(
    inputs.ovalVisibleProb,
    inputs.sunAltDeg,
    inputs.moonAltDeg,
    inputs.moonIllumFrac,
    inputs.cloudTotalConsensus,
    inputs.cloudLowConsensus,
    inputs.cloudModelSpread,
    inputs.satelliteClearNow ?? undefined,
  );
  return {
    score: at(o, 0),
    verdict: VERDICT_BY_IDX[at(o, 1)] ?? 'Unlikely',
    confidence: at(o, 2),
    dominantLimiter: LIMITER_BY_IDX[at(o, 3)] ?? 'Oval',
  };
}
