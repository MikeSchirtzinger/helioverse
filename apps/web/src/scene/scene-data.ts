/**
 * scene/scene-data.ts — Scene object data generators.
 *
 * Pure functions that produce SunData, EarthData, L1Data descriptors
 * from epoch and minimal inputs. These descriptors are the "data" that
 * the W2 integration packages (W2-I1 particles-on-DBM, W2-I2 B3 tie-in)
 * consume to place three.js meshes.
 *
 * All positions are heliographic Stonyhurst.
 */

import type { SunData, EarthData, L1Data, HelioPoint, CmeEventData } from './types';
import {
  SUN_RADIUS_KM,
  EARTH_RADIUS_KM,
  AU_KM,
  L1_EARTH_DISTANCE_KM,
  SOLAR_SIDEREAL_ROTATION_S,
  DEFAULT_SOLAR_WIND_SPEED_KMS,
} from './constants';

// ---------------------------------------------------------------------------
// Sun
// ---------------------------------------------------------------------------

/** The Sun is always at the heliographic origin. */
const SUN_POSITION: HelioPoint = { lon_deg: 0, lat_deg: 0, r_km: 0 };

export function createSunData(activeWavelength: string | null = null): SunData {
  return {
    position: { ...SUN_POSITION },
    radius_km: SUN_RADIUS_KM,
    activeWavelength,
  };
}

// ---------------------------------------------------------------------------
// Earth (heliographic position at epoch)
// ---------------------------------------------------------------------------

/**
 * Approximate Earth heliographic longitude at a given unix epoch.
 *
 * Simplified: assumes circular orbit in the ecliptic plane (lat=0).
 * The Earth orbits counter-clockwise as seen from north with a period
 * of 365.25 days plus the ~13-day offset from solar rotation.
 *
 * This is a v1 approximation; the full WASM sky_state() in the contract
 * provides higher precision, but for the 3D scene skeleton a closed-form
 * circular approximation is sufficient (scene placement ~few-degree tolerance
 * is visually indistinguishable at 1 AU).
 *
 * Epoch reference: unix 0 = 1970-01-01.  Earth longitude 100° (approx)
 * at that epoch (empirical anchor within ~2°).
 */
const EPOCH_EARTH_LON_DEG = 100;
const EARTH_ORBITAL_PERIOD_S = 365.25 * 86400;
const EARTH_ORBITAL_RATE_DEG_PER_S = 360 / EARTH_ORBITAL_PERIOD_S;

/**
 * Earth heliographic position at the given unix epoch.
 * Earth is always in the ecliptic plane (lat = 0) at ~1 AU.
 * Longitude is Stonyhurst: 0 = Sun-Earth line, +west.
 *
 * So by definition, at any instant, Earth's Stonyhurst longitude is 0
 * (because Stonyhurst is Earth-centered). But for a view where the Sun
 * is at origin and we're looking at the heliosphere, we place Earth at
 * lon=0, r=1 AU, lat=0.
 */
export function createEarthData(epoch_unix: number): EarthData {
  // In Stonyhurst coordinates, Earth is ALWAYS at lon=0, lat=0, r≈1AU
  // because Stonyhurst longitude is defined by the Sun-Earth line.
  // The epoch is kept for computing the Earth's position relative to
  // evolving solar features (active regions rotate with the Sun).
  return {
    position: { lon_deg: 0, lat_deg: 0, r_km: AU_KM },
    radius_km: EARTH_RADIUS_KM,
    epoch_unix,
  };
}

/**
 * Return the Earth's nominal heliographic longitude at epoch for
 * solar-feature alignment (active regions, CME source longitudes).
 *
 * This is the solar *Carrington* longitude of the central meridian
 * as seen from Earth — needed to place solar features at the correct
 * rotational phase.
 */
export function earthCarringtonLongitude(epoch_unix: number): number {
  // Carrington rotation: synodic period
  const carringtonPeriodS = 27.2753 * 86400;
  // Reference: Carrington rotation #1 started 1853-11-09.
  // For v1 scene, a coarse alignment anchored to epoch is sufficient.
  const elapsed = epoch_unix - 0; // seconds since unix epoch
  return ((EPOCH_EARTH_LON_DEG + elapsed * (360 / carringtonPeriodS)) % 360 + 360) % 360;
}

// ---------------------------------------------------------------------------
// L1 spacecraft
// ---------------------------------------------------------------------------

/**
 * L1 position: on the Sun–Earth line, between them, ~1.5 Mkm from Earth.
 * In heliographic coords: lon=0, lat=0, r = AU_KM − L1_EARTH_DISTANCE_KM.
 */
export function createL1Data(spacecraft: string = 'DSCOVR'): L1Data {
  return {
    position: {
      lon_deg: 0,
      lat_deg: 0,
      r_km: AU_KM - L1_EARTH_DISTANCE_KM,
    },
    spacecraft,
    earthDistance_km: L1_EARTH_DISTANCE_KM,
  };
}

// ---------------------------------------------------------------------------
// CME event data factory (from contract fixture shapes)
// ---------------------------------------------------------------------------

/**
 * Create minimal CME event data from a liftoff descriptor.
 * The frontPosition starts at the source and is updated by the DBM
 * propagator (W1-P2 + W2-I1).
 */
export function createCmeEventData(params: {
  id: string;
  sourceLon_deg: number;
  sourceLat_deg: number;
  speed_kms: number;
  halfAngle_deg: number;
  isHalo: boolean;
  earthBoundScore: number;
  liftoff_unix: number;
}): CmeEventData {
  return {
    id: params.id,
    sourcePosition: {
      lon_deg: params.sourceLon_deg,
      lat_deg: params.sourceLat_deg,
      r_km: SUN_RADIUS_KM * 1.02, // just above surface
    },
    speed_kms: params.speed_kms,
    halfAngle_deg: params.halfAngle_deg,
    isHalo: params.isHalo,
    earthBoundScore: params.earthBoundScore,
    liftoff_unix: params.liftoff_unix,
    frontPosition: null,
    arrivalWindow: null,
  };
}

// ---------------------------------------------------------------------------
// Batch scene package (all objects at once for an epoch)
// ---------------------------------------------------------------------------

export interface SceneBundle {
  epoch_unix: number;
  sun: SunData;
  earth: EarthData;
  l1: L1Data;
  activeEvents: CmeEventData[];
}

/**
 * Create the full scene-data bundle for a given epoch.
 * This is the single entry point W2 integration packages call.
 */
export function createSceneBundle(
  epoch_unix: number,
  activeEvents: CmeEventData[] = [],
  activeWavelength: string | null = null,
  l1Spacecraft: string = 'DSCOVR',
): SceneBundle {
  return {
    epoch_unix,
    sun: createSunData(activeWavelength),
    earth: createEarthData(epoch_unix),
    l1: createL1Data(l1Spacecraft),
    activeEvents,
  };
}
