/**
 * snapshot-local.ts — Local Snapshot type and fixture imports
 *
 * This bridges the frozen Wave-0 contract schemas to the aurora feature
 * without depending on @helioverse/contracts at build time (the monorepo
 * link isn't resolved when type-checking in isolation).
 *
 * Types are derived from contracts/schemas/snapshot.schema.json.
 * Fixtures are imported directly from contracts/fixtures/.
 *
 * Wave-0 FROZEN — do not modify type shapes.
 */

// ---------------------------------------------------------------
// Types (mirror of packages/contracts/src/types/snapshot.ts)
// ---------------------------------------------------------------

export type IsoUtc = string;
export type EventId = string;

export interface SourceStatus {
  status: "ok" | "stale" | "gap";
  last_success_at: IsoUtc | null;
  age_s: number | null;
}

export interface SnapshotSources {
  swpc_plasma: SourceStatus;
  swpc_mag: SourceStatus;
  swpc_indices: SourceStatus;
  ovation: SourceStatus;
  donki: SourceStatus;
  goes_csm?: SourceStatus;
  sdo_imagery?: SourceStatus;
  helioviewer?: SourceStatus;
}

export interface TrailingSeries {
  t_unix: number[];
  speed_kms: (number | null)[];
  bz_gsm_nt: (number | null)[];
  density_pcc: (number | null)[];
}

export interface SolarWind {
  measured_at: IsoUtc;
  spacecraft: "DSCOVR" | "ACE" | "SOLAR-1" | "IMAP";
  speed_kms: number | null;
  density_pcc: number | null;
  temperature_k: number | null;
  bt_nt: number | null;
  bx_gsm_nt: number | null;
  by_gsm_nt: number | null;
  bz_gsm_nt: number | null;
  series: TrailingSeries;
}

export interface SnapshotClocks {
  sun_imagery_at: IsoUtc | null;
  l1_measured_at: IsoUtc | null;
  model_run_at: IsoUtc | null;
}

export interface L1ToEarth {
  spacecraft_distance_km: number;
  delay_s: number;
  delay_quality: "measured" | "degraded_fixed";
  arriving_now_measured_at: IsoUtc;
}

export interface TimedValue {
  value: number | null;
  measured_at: IsoUtc | null;
}

export interface KpForecast {
  valid_at: IsoUtc;
  value: number;
}

export interface NoaaScales {
  R: string | null;
  S: string | null;
  G: string | null;
}

export interface Indices {
  kp: TimedValue;
  kp_forecast?: KpForecast[];
  dst_nt: TimedValue;
  f107?: TimedValue;
  noaa_scales: NoaaScales;
}

export interface OvationMeta {
  observation_time: IsoUtc;
  forecast_time: IsoUtc;
  grid_r2_key: string;
  hemispheric_power_gw?: number | null;
}

export interface AlertItem {
  issued_at: IsoUtc;
  code: string;
  title: string;
}

export interface Snapshot {
  schema_version: string;
  generated_at: IsoUtc;
  cadence_s: 60 | 300;
  clocks: SnapshotClocks;
  sources: SnapshotSources;
  solar_wind: SolarWind;
  l1_to_earth: L1ToEarth;
  indices: Indices;
  ovation: OvationMeta;
  alerts: AlertItem[];
  events_active: EventId[];
}

// ---------------------------------------------------------------
// Fixture imports (direct JSON, typed via as-assertion)
// ---------------------------------------------------------------

import snapshotQuietData from "../../../../../contracts/fixtures/snapshot/snapshot-quiet.json";
import snapshotStormData from "../../../../../contracts/fixtures/snapshot/snapshot-storm.json";
import snapshotDegradedData from "../../../../../contracts/fixtures/snapshot/snapshot-degraded.json";

export const snapshotQuiet = snapshotQuietData as Snapshot;
export const snapshotStorm = snapshotStormData as Snapshot;
export const snapshotDegraded = snapshotDegradedData as Snapshot;
