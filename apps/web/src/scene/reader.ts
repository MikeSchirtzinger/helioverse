/**
 * scene/reader.ts — Read contract fixture shapes into scene-data types.
 *
 * Bridge from the contract schemas (snapshot.schema.json, event.schema.json)
 * to the scene-domain types defined in types.ts. This allows the scene
 * skeleton to ingest historical/fixture data for storybook and tests
 * without depending on the live poller (W1-P1) or the WASM crate (W1-P2).
 *
 * All functions are pure — they map JSON → typed records.
 */

import type {
  EarthData,
  L1Data,
  SunData,
  CmeEventData,
  ParkerGridData,
} from './types';
import {
  SUN_RADIUS_KM,
  AU_KM,
  L1_EARTH_DISTANCE_KM,
  EARTH_RADIUS_KM,
} from './constants';

// ---------------------------------------------------------------------------
// Snapshot-inspired types (subset of snapshot.schema.json relevant to scene)
// ---------------------------------------------------------------------------

/** Subset of the combined snapshot that the scene skeleton reads. */
export interface SnapshotForScene {
  generated_at: string;
  clocks: {
    sun_imagery_at: string | null;
    l1_measured_at: string | null;
  };
  solar_wind: {
    measured_at: string;
    spacecraft: string;
    speed_kms: number | null;
    density_pcc: number | null;
    bz_gsm_nt: number | null;
  };
  l1_to_earth: {
    spacecraft_distance_km: number;
    delay_s: number;
    delay_quality: 'measured' | 'degraded_fixed';
    arriving_now_measured_at: string;
  };
  events_active: string[];
}

/** Subset of the Event schema for scene ingestion. */
export interface EventForScene {
  id: string;
  type: string;
  liftoff_at: string | null;
  source_region: {
    lon_deg: number;
    lat_deg: number;
  } | null;
  kinematics: Array<{
    version: number;
    speed_kms: number;
    half_angle_deg: number;
    direction: { lon_deg: number; lat_deg: number };
    is_halo: boolean;
    is_most_accurate: boolean;
  }>;
  earth_bound_score: number;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/** Parse ISO-8601 UTC to unix seconds. Returns 0 on failure. */
export function isoToUnix(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  return ms / 1000;
}

/** Snapshot → epoch unix seconds. */
export function snapshotEpoch(snapshot: SnapshotForScene): number {
  return isoToUnix(snapshot.generated_at);
}

// ---------------------------------------------------------------------------
// Fixture → scene-data mappers
// ---------------------------------------------------------------------------

/**
 * Derive EarthData from a snapshot. Earth is always at Stonyhurst (0, 0, 1 AU).
 */
export function earthFromSnapshot(snapshot: SnapshotForScene): EarthData {
  return {
    position: { lon_deg: 0, lat_deg: 0, r_km: AU_KM },
    radius_km: EARTH_RADIUS_KM,
    epoch_unix: snapshotEpoch(snapshot),
  };
}

/**
 * Derive L1Data from a snapshot.
 */
export function l1FromSnapshot(snapshot: SnapshotForScene): L1Data {
  const r_km = AU_KM - snapshot.l1_to_earth.spacecraft_distance_km;
  return {
    position: { lon_deg: 0, lat_deg: 0, r_km },
    spacecraft: snapshot.solar_wind.spacecraft,
    earthDistance_km: snapshot.l1_to_earth.spacecraft_distance_km,
  };
}

/**
 * Sun is constant — just note the active wavelength if known.
 */
export function sunFromSnapshot(_snapshot: SnapshotForScene): SunData {
  return {
    position: { lon_deg: 0, lat_deg: 0, r_km: 0 },
    radius_km: SUN_RADIUS_KM,
    activeWavelength: null, // populated by imagery pipeline (W1-P4)
  };
}

/**
 * Create CmeEventData from a contract Event JSON shape.
 * Uses the most-accurate kinematics version.
 */
export function cmeFromEvent(event: EventForScene): CmeEventData | null {
  if (event.type !== 'CME') return null;

  // Find the most-accurate kinematics version
  const best =
    event.kinematics.find((k) => k.is_most_accurate) ??
    event.kinematics[event.kinematics.length - 1];

  if (!best) return null;

  const sourceLon = event.source_region?.lon_deg ?? best.direction.lon_deg;
  const sourceLat = event.source_region?.lat_deg ?? best.direction.lat_deg;

  return {
    id: event.id,
    sourcePosition: {
      lon_deg: sourceLon,
      lat_deg: sourceLat,
      r_km: SUN_RADIUS_KM * 1.02,
    },
    speed_kms: best.speed_kms,
    halfAngle_deg: best.half_angle_deg,
    isHalo: best.is_halo,
    earthBoundScore: event.earth_bound_score,
    liftoff_unix: isoToUnix(event.liftoff_at),
    frontPosition: null,
    arrivalWindow: null,
  };
}

// ---------------------------------------------------------------------------
// Batch: snapshot + events → full scene bundle
// ---------------------------------------------------------------------------

export interface SceneFromFixtures {
  epoch_unix: number;
  sun: SunData;
  earth: EarthData;
  l1: L1Data;
  activeEvents: CmeEventData[];
  parkerGridDefaults: {
    speed_kms: number;
    isDegraded: boolean;
  };
}

/**
 * Combine a snapshot and an event list into the scene-ready data bundle.
 * This is the single entry point for story/test fixture loading.
 *
 * @param snapshot    - a contract snapshot JSON object (or subset).
 * @param events      - array of contract Event JSON objects (or subset).
 * @param activeWavelength - optional SDO wavelength label.
 */
export function sceneFromFixtures(
  snapshot: SnapshotForScene,
  events: EventForScene[],
): SceneFromFixtures {
  const sun = sunFromSnapshot(snapshot);
  const earth = earthFromSnapshot(snapshot);
  const l1 = l1FromSnapshot(snapshot);
  const activeEvents: CmeEventData[] = [];

  for (const ev of events) {
    const cme = cmeFromEvent(ev);
    if (cme) activeEvents.push(cme);
  }

  return {
    epoch_unix: snapshotEpoch(snapshot),
    sun,
    earth,
    l1,
    activeEvents,
    parkerGridDefaults: {
      speed_kms: snapshot.solar_wind.speed_kms ?? 400,
      isDegraded: snapshot.l1_to_earth.delay_quality === 'degraded_fixed',
    },
  };
}
