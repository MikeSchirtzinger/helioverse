/**
 * TypeScript types derived from contracts/schemas/event.schema.json
 * Wave-0 FROZEN — do not modify.
 */

import type { IsoUtc, EventId } from './snapshot';

export interface CmeDirection {
  lon_deg: number;
  lat_deg: number;
}

export interface KinematicsVersion {
  version: number;
  measured_at: IsoUtc;
  speed_kms: number;
  half_angle_deg: number;
  direction: CmeDirection;
  cme_type?: 'S' | 'C' | 'O' | 'R' | 'ER' | null;
  measurement_technique?: string | null;
  is_halo: boolean;
  is_most_accurate: boolean;
}

export interface ValueSigma {
  value: number;
  sigma: number;
}

export interface PredictionArrival {
  eta: IsoUtc;
  window_start: IsoUtc;
  window_end: IsoUtc;
  window_ci: number;
}

export interface Prediction {
  predicted_at: IsoUtc;
  model: string;
  inputs_as_of: IsoUtc;
  hit_probability: number;
  arrival?: PredictionArrival | null;
  arrival_speed_kms?: ValueSigma | null;
  peak_kp?: ValueSigma | null;
  min_dst_nt?: ValueSigma | null;
  params?: Record<string, unknown>;
}

export interface Outcome {
  resolved_at: IsoUtc;
  hit: boolean;
  shock_arrival_at?: IsoUtc | null;
  arrival_speed_kms?: number | null;
  peak_kp?: number | null;
  min_dst_nt?: number | null;
  min_dst_at?: IsoUtc | null;
  sources: string[];
  notes?: string | null;
}

export interface EventLink {
  id: EventId;
  rel: 'caused_by' | 'causes' | 'merged_into' | 'merged_from' | 'associated';
}

export interface FlareDetail {
  class: string;
  xray_peak_wm2?: number | null;
}

export interface EventThumbnail {
  r2_key: string;
  captured_at: IsoUtc;
  wavelength: string;
  crop?: { x: number; y: number; w: number; h: number };
}

export interface EventProvenance {
  catalog: 'DONKI' | 'SWPC' | 'HELIOVERSE';
  donki_activity_id?: string | null;
  first_seen_at: IsoUtc;
  as_of: IsoUtc;
}

export interface Event {
  schema_version: string;
  id: EventId;
  uuid: string;
  type: 'CME' | 'FLR' | 'IPS' | 'SEP' | 'GST' | 'FILAMENT';
  detected_at: IsoUtc;
  peak_at?: IsoUtc | null;
  liftoff_at?: IsoUtc | null;
  source_region?: {
    ar_number?: number | null;
    lon_deg: number;
    lat_deg: number;
    instrument?: string | null;
  } | null;
  kinematics: KinematicsVersion[];
  flare?: FlareDetail | null;
  thumbnail?: EventThumbnail | null;
  earth_bound_score: number;
  links: EventLink[];
  predictions: Prediction[];
  outcome: Outcome | null;
  provenance: EventProvenance;
}
