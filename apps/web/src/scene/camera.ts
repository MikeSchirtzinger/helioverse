/**
 * scene/camera.ts — Camera state, orbit control logic, and scale transforms.
 *
 * Pure functions operating on CameraState and ScaleState records.
 * No import of three.js — these are the data layer that a three.js controller
 * (or any other renderer) reads and writes.
 */

import type { CameraState, HelioPoint, ScaleMode, ScaleState } from './types';
import {
  AU_KM,
  SUN_RADIUS_KM,
  EARTH_RADIUS_KM,
  EARTH_MIN_SCENE_RADIUS,
  SUN_COMPRESSED_SCENE_RADIUS,
  COMPRESS_FACTOR,
  COMPRESS_LINEAR_ZONE_KM,
} from './constants';

// ---------------------------------------------------------------------------
// Default camera state
// ---------------------------------------------------------------------------

/** Default camera target: 1 AU on the +x axis (Earth's approximate position). */
export const DEFAULT_TARGET: HelioPoint = {
  lon_deg: 0,
  lat_deg: 0,
  r_km: AU_KM,
};

/** Default camera azimuth (degrees) — oblique view showing Sun–Earth line. */
const DEFAULT_AZIMUTH = 45;
/** Default camera polar angle (degrees) — slightly above the ecliptic. */
const DEFAULT_POLAR = 30;
/** Default camera distance in scene units (compressed scale). */
const DEFAULT_SCENE_DISTANCE = 6;

export function createDefaultCameraState(): CameraState {
  return {
    azimuth_deg: DEFAULT_AZIMUTH,
    polar_deg: DEFAULT_POLAR,
    distance: DEFAULT_SCENE_DISTANCE,
    target: { ...DEFAULT_TARGET },
  };
}

// ---------------------------------------------------------------------------
// Orbit / zoom / pan (pure state transitions)
// ---------------------------------------------------------------------------

/** Return a new CameraState with updated azimuth. */
export function orbitAzimuth(state: CameraState, delta_deg: number): CameraState {
  let a = state.azimuth_deg + delta_deg;
  // Wrap to [0, 360).
  a = ((a % 360) + 360) % 360;
  return { ...state, azimuth_deg: a };
}

/** Return a new CameraState with updated polar angle (clamped to avoid gimbal lock). */
export function orbitPolar(state: CameraState, delta_deg: number): CameraState {
  let p = state.polar_deg + delta_deg;
  // Clamp to (-89, 89) to avoid flipping at the poles.
  p = Math.max(-89, Math.min(89, p));
  return { ...state, polar_deg: p };
}

/** Return a new CameraState with updated distance (zoom). Never goes below minDist. */
export function zoom(state: CameraState, factor: number, minDist = 0.1): CameraState {
  return { ...state, distance: Math.max(minDist, state.distance * factor) };
}

/** Return a new CameraState with target shifted by a pan offset in scene units. */
export function pan(state: CameraState, dx: number, dy: number): CameraState {
  // Pan in scene units — the renderer interprets this as screen-space
  // displacement mapped to the camera's local right/up axes.
  // Here we return the state unchanged because target is in heliographic coords;
  // the three.js controller will convert screen-space pan to heliographic drift.
  return state;
}

// ---------------------------------------------------------------------------
// Scale transforms (true ↔ compressed)
// ---------------------------------------------------------------------------

/**
 * Compressed-scale transform: logarithmic compression of heliocentric distance
 * to scene units. The Sun surface maps to ~SUN_COMPRESSED_SCENE_RADIUS and
 * 1 AU maps to ~4 scene units.
 *
 * Formula (pinned): r_scene = C · log₁₀(1 + r_km / L)
 *
 * where C = COMPRESS_FACTOR, L = COMPRESS_LINEAR_ZONE_KM.
 */
export function compressDistance(r_km: number): number {
  if (r_km <= 0) return 0;
  return COMPRESS_FACTOR * Math.log10(1 + r_km / COMPRESS_LINEAR_ZONE_KM);
}

/** Inverse of compressDistance. */
export function uncompressDistance(sceneUnits: number): number {
  if (sceneUnits <= 0) return 0;
  return COMPRESS_LINEAR_ZONE_KM * (Math.pow(10, sceneUnits / COMPRESS_FACTOR) - 1);
}

/**
 * Map a heliographic point to scene-space coordinates (cartesian in scene units)
 * using either true or compressed scale.
 *
 * Returns { x, y, z } in scene units.
 */
export function helioToSceneCartesian(
  p: HelioPoint,
  mode: ScaleMode,
): { x: number; y: number; z: number } {
  const r_scene = mode === 'true' ? p.r_km / AU_KM : compressDistance(p.r_km);
  const lonRad = (p.lon_deg * Math.PI) / 180;
  const latRad = (p.lat_deg * Math.PI) / 180;

  const cosLat = Math.cos(latRad);
  return {
    x: r_scene * cosLat * Math.cos(lonRad),
    y: r_scene * Math.sin(latRad),
    z: r_scene * cosLat * Math.sin(lonRad),
  };
}

/**
 * Compute the rendered radius of an object (Sun, Earth) in scene units.
 * Earth is never rendered smaller than EARTH_MIN_SCENE_RADIUS even in
 * compressed scale (spec §7.2: "Earth rendered at ≥ its real radius").
 */
export function objectSceneRadius(trueRadius_km: number, mode: ScaleMode): number {
  if (mode === 'true') {
    return trueRadius_km / AU_KM;
  }
  // Compressed: Sun uses a fixed visual anchor; Earth gets a floor.
  if (trueRadius_km >= SUN_RADIUS_KM * 0.5) {
    return SUN_COMPRESSED_SCENE_RADIUS;
  }
  const compressed = compressDistance(trueRadius_km) - compressDistance(0);
  return Math.max(compressed, EARTH_MIN_SCENE_RADIUS);
}

// ---------------------------------------------------------------------------
// Scale state factory
// ---------------------------------------------------------------------------

/**
 * Create a ScaleState for the given mode. The toSceneUnits / toTrueKm
 * closures are the authoritative transform for the entire scene.
 */
export function createScaleState(mode: ScaleMode): ScaleState {
  const toSceneUnits = (r_km: number) =>
    mode === 'true' ? r_km / AU_KM : compressDistance(r_km);

  const toTrueKm = (sceneUnits: number) =>
    mode === 'true' ? sceneUnits * AU_KM : uncompressDistance(sceneUnits);

  return { mode, toSceneUnits, toTrueKm };
}

/**
 * Toggle between scale modes. Returns the new ScaleState.
 */
export function toggleScale(current: ScaleMode): ScaleState {
  const next: ScaleMode = current === 'true' ? 'compressed' : 'true';
  return createScaleState(next);
}
