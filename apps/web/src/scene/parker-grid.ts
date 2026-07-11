/**
 * scene/parker-grid.ts — Parker spiral field-line computation.
 *
 * Pure functions: no DOM, no three.js, statically inspectable.
 * The Parker spiral describes how the solar-wind plasma wraps into
 * an Archimedean spiral as the Sun rotates:
 *
 *   φ(r) = φ₀ − (Ω / v_sw) · (r − r₀)
 *
 * where Ω is the solar rotation rate, v_sw the solar-wind speed,
 * and all angles are heliographic (Stonyhurst).
 */

import type { HelioPoint, ParkerGridData } from './types';
import {
  SUN_RADIUS_KM,
  AU_KM,
  SOLAR_SYNODIC_ROTATION_S,
  DEFAULT_SOLAR_WIND_SPEED_KMS,
} from './constants';

// ---------------------------------------------------------------------------
// Single spiral
// ---------------------------------------------------------------------------

/**
 * Compute one Parker spiral field line.
 *
 * @param startLon_deg   - heliographic longitude of the footpoint at r₀ (degrees).
 * @param startLat_deg   - heliographic latitude of the footpoint (degrees).
 * @param r0_km          - starting radial distance (typically Sun surface).
 * @param rEnd_km        - ending radial distance (typically past 1 AU).
 * @param speed_kms      - solar-wind bulk speed (km/s).
 * @param rotationPeriod_s - solar rotation period (seconds).
 * @param nSteps         - number of polyline vertices.
 * @returns array of HelioPoint vertices forming the spiral.
 */
export function computeParkerSpiral(
  startLon_deg: number,
  startLat_deg: number,
  r0_km: number,
  rEnd_km: number,
  speed_kms: number,
  rotationPeriod_s: number,
  nSteps: number,
): HelioPoint[] {
  if (nSteps < 2) nSteps = 2;
  if (speed_kms <= 0) speed_kms = DEFAULT_SOLAR_WIND_SPEED_KMS;

  const omega = (2 * Math.PI) / rotationPeriod_s; // rad/s
  const coeff = omega / speed_kms; // rad/km

  const points: HelioPoint[] = [];
  const dr = (rEnd_km - r0_km) / (nSteps - 1);

  for (let i = 0; i < nSteps; i++) {
    const r = r0_km + i * dr;
    // Parker spiral: longitude winds backward relative to rotation direction.
    // φ = φ₀ − (Ω/v)(r − r₀). Negative sign because the Sun rotates east→west
    // but the spiral trails behind the rotating footpoint in the inertial frame.
    const deltaLonRad = -coeff * (r - r0_km);
    const deltaLonDeg = (deltaLonRad * 180) / Math.PI;
    const lon = startLon_deg + deltaLonDeg;

    points.push({ lon_deg: lon, lat_deg: startLat_deg, r_km: r });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Full Parker grid (multiple spirals)
// ---------------------------------------------------------------------------

/**
 * Default spiral parameters for the scene grid.
 */
export const PARKER_DEFAULTS = {
  /** Number of footpoint longitudes (evenly spaced around 360°). */
  spiralCount: 36,
  /** Latitude bands (deg). */
  latitudes_deg: [0, 15, -15, 30, -30, 45, -45],
  /** Steps per spiral. */
  steps: 180,
  /** Start from just above Sun surface. */
  r0_km: SUN_RADIUS_KM * 1.05,
  /** Extend past 1 AU to show the spiral beyond Earth. */
  rEnd_km: AU_KM * 1.3,
} as const;

/**
 * Compute the full Parker grid: multiple spirals at evenly-spaced footpoint
 * longitudes for each latitude band.
 *
 * Returns a ParkerGridData descriptor with all polyline vertex arrays.
 */
export function computeParkerGrid(
  speed_kms: number = DEFAULT_SOLAR_WIND_SPEED_KMS,
  rotationPeriod_s: number = SOLAR_SYNODIC_ROTATION_S,
): ParkerGridData {
  const { spiralCount, latitudes_deg, steps, r0_km, rEnd_km } = PARKER_DEFAULTS;

  const spirals: HelioPoint[][] = [];

  for (const lat of latitudes_deg) {
    for (let s = 0; s < spiralCount; s++) {
      const lon = (360 / spiralCount) * s;
      spirals.push(
        computeParkerSpiral(lon, lat, r0_km, rEnd_km, speed_kms, rotationPeriod_s, steps),
      );
    }
  }

  return { spirals, speed_kms, rotation_period_s: rotationPeriod_s };
}

// ---------------------------------------------------------------------------
// Parker offset used for Earth-bound geometry
// ---------------------------------------------------------------------------

/**
 * Compute the Parker-spiral angular offset at a given heliocentric distance.
 * This is the difference between the radial direction and the actual flow
 * direction caused by solar rotation.
 *
 *   offset_deg = arctan(r · Ω / v_sw)   (the "garden-hose" angle)
 *
 * In heliographic coordinates, this offset is applied as a westward shift
 * to the CME apex longitude when checking Earth containment (cone_contains_earth).
 *
 * @param r_km          - heliocentric distance (km).
 * @param speed_kms     - solar-wind speed (km/s).
 * @param rotationPeriod_s - solar rotation period (seconds).
 * @returns Parker offset in degrees.
 */
export function parkerOffsetDeg(
  r_km: number,
  speed_kms: number,
  rotationPeriod_s: number = SOLAR_SYNODIC_ROTATION_S,
): number {
  if (speed_kms <= 0) return 0;
  const omega = (2 * Math.PI) / rotationPeriod_s;
  return (Math.atan((r_km * omega) / speed_kms) * 180) / Math.PI;
}

/**
 * Parker offset at 1 AU for a given speed — the most common query.
 */
export function parkerOffsetAt1AU(speed_kms: number): number {
  return parkerOffsetDeg(AU_KM, speed_kms);
}
