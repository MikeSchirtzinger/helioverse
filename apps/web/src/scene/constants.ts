/**
 * scene/constants.ts — Physical constants matching the contracts.
 *
 * Every constant here is pinned to contracts/wasm-api/helio_core_api.rs
 * and the golden vectors. Do NOT change without bumping the contract version.
 */

// ---------------------------------------------------------------------------
// Contract-pinned constants (helio_core_api.rs)
// ---------------------------------------------------------------------------

/** Astronomical Unit in km (contract: AU_KM). */
export const AU_KM = 1.495978707e8;

/** Solar radius in km (contract: SUN_RADIUS_KM). */
export const SUN_RADIUS_KM = 6.957e5;

/** NOAA-equivalent fixed L1→Earth delay, seconds (contract: FIXED_FALLBACK_DELAY_S). */
export const FIXED_FALLBACK_DELAY_S = 1800;

/** Earth equatorial radius in km. */
export const EARTH_RADIUS_KM = 6371;

/** Typical L1 halo-orbit distance from Earth in km (~1.5 Mkm). */
export const L1_EARTH_DISTANCE_KM = 1.5e6;

// ---------------------------------------------------------------------------
// Scene-domain constants
// ---------------------------------------------------------------------------

/** Default solar-wind speed for Parker spiral rendering (km/s). */
export const DEFAULT_SOLAR_WIND_SPEED_KMS = 400;

/** Solar synodic rotation period in seconds (~25.38 days). */
export const SOLAR_SYNODIC_ROTATION_S = 25.38 * 86400;

/** Solar sidereal rotation period in seconds (~25.05 days). */
export const SOLAR_SIDEREAL_ROTATION_S = 25.05 * 86400;

/** Default propagation model gamma for DBM (1/km). Contract typical 0.2e-7..2e-7. */
export const DEFAULT_DBM_GAMMA_PER_KM = 2e-8;

/** Default ambient solar-wind speed for DBM (km/s). */
export const DEFAULT_DBM_AMBIENT_WIND_KMS = 400;

// ---------------------------------------------------------------------------
// Scene visual defaults
// ---------------------------------------------------------------------------

/** Earth minimum rendered radius in compressed-scale scene units. Never smaller. */
export const EARTH_MIN_SCENE_RADIUS = 0.015;

/** Sun rendered radius in compressed-scale scene units (fixed anchor, matches compressDistance). */
export const SUN_COMPRESSED_SCENE_RADIUS = 0.50;

/** Default camera distance from origin in true-scale scene units. */
export const DEFAULT_CAMERA_DISTANCE = AU_KM * 1.8;

// ---------------------------------------------------------------------------
// Scale transform presets
// ---------------------------------------------------------------------------

/**
 * Compressed scale: logarithmic mapping from true r_km to scene units.
 * Preserves Sun and Earth as distinct objects while fitting the 1 AU span
 * into a viewable volume.
 *
 * r_scene = compressFactor * log10(1 + r_km / linearZone)
 *
 * Parameters chosen so that:
 *   Sun surface  → ~0.52 scene units
 *   1 AU         → ~4.05 scene units
 *   L1 (~0.99 AU)→ ~4.02 scene units
 */
export const COMPRESS_FACTOR = 1.74;
export const COMPRESS_LINEAR_ZONE_KM = 740_000;
