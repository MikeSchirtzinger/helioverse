export type TimelineMode = 'history' | 'live' | 'project';
export type EventType = 'CME' | 'FLR' | 'IPS' | 'SEP' | 'GST' | 'FILAMENT';
export type IsoUtcString = string;

export interface TimelineSnapshotClockSet {
  sun_imagery_at: IsoUtcString | null;
  l1_measured_at: IsoUtcString | null;
  model_run_at: IsoUtcString | null;
}

export interface TimelineSnapshot {
  schema_version: string;
  generated_at: IsoUtcString;
  cadence_s: 60 | 300;
  clocks: TimelineSnapshotClockSet;
  l1_to_earth: {
    spacecraft_distance_km: number;
    delay_s: number;
    delay_quality: 'measured' | 'degraded_fixed';
    arriving_now_measured_at: IsoUtcString;
  };
  events_active: string[];
}

export interface TimelineThumbnailRef {
  r2_key: string;
  captured_at: IsoUtcString;
  wavelength: string;
  crop?: { x: number; y: number; w: number; h: number };
}

export interface TimelineKinematicsVersion {
  version: number;
  measured_at: IsoUtcString;
  speed_kms: number;
  half_angle_deg: number;
  direction: { lon_deg: number; lat_deg: number };
  cme_type?: 'S' | 'C' | 'O' | 'R' | 'ER' | null;
  measurement_technique?: string | null;
  is_halo: boolean;
  is_most_accurate: boolean;
}

export interface TimelinePrediction {
  predicted_at: IsoUtcString;
  model: string;
  inputs_as_of: IsoUtcString;
  hit_probability: number;
  arrival?: {
    eta: IsoUtcString;
    window_start: IsoUtcString;
    window_end: IsoUtcString;
    window_ci: number;
  } | null;
  arrival_speed_kms?: { value: number; sigma: number } | null;
  peak_kp?: { value: number; sigma: number } | null;
  min_dst_nt?: { value: number; sigma: number } | null;
  params?: Record<string, unknown>;
}

export interface TimelineOutcome {
  resolved_at: IsoUtcString;
  hit: boolean;
  shock_arrival_at?: IsoUtcString | null;
  arrival_speed_kms?: number | null;
  peak_kp?: number | null;
  min_dst_nt?: number | null;
  min_dst_at?: IsoUtcString | null;
  sources: string[];
  notes?: string | null;
}

export interface TimelineEvent {
  schema_version: string;
  id: string;
  uuid: string;
  type: EventType;
  detected_at: IsoUtcString;
  peak_at?: IsoUtcString | null;
  liftoff_at?: IsoUtcString | null;
  source_region?: {
    ar_number?: number | null;
    lon_deg: number;
    lat_deg: number;
    instrument?: string | null;
  } | null;
  kinematics: TimelineKinematicsVersion[];
  flare?: { class: string; xray_peak_wm2?: number | null } | null;
  thumbnail?: TimelineThumbnailRef | null;
  earth_bound_score: number;
  links: Array<{ id: string; rel: 'caused_by' | 'causes' | 'merged_into' | 'merged_from' | 'associated' }>;
  predictions: TimelinePrediction[];
  outcome: TimelineOutcome | null;
  provenance: {
    catalog: 'DONKI' | 'SWPC' | 'HELIOVERSE';
    donki_activity_id?: string | null;
    first_seen_at: IsoUtcString;
    as_of: IsoUtcString;
  };
}

export interface TimelineWindow {
  historyStartIso: IsoUtcString;
  liveAtIso: IsoUtcString;
  projectEndIso: IsoUtcString;
  historyDays: number;
  projectDays: number;
}

export interface TimelineAsOfFrame {
  mode: TimelineMode;
  viewTimeIso: IsoUtcString;
  inputsAsOfIso: IsoUtcString;
  snapshotGeneratedAt: IsoUtcString;
  isHindcast: boolean;
  isProjection: boolean;
  delayQuality: TimelineSnapshot['l1_to_earth']['delay_quality'];
  clocks: TimelineSnapshotClockSet;
}

export interface TimelineEventChip {
  id: string;
  type: EventType;
  label: string;
  timeIso: IsoUtcString;
  positionPct: number;
  thumbnail: TimelineThumbnailRef | null;
  earthBoundScore: number;
  isActive: boolean;
  isResolved: boolean;
}

export interface TimelineFocusPayload {
  eventId: string;
  focusTimeIso: IsoUtcString;
  mode: TimelineMode;
  inputsAsOfIso: IsoUtcString;
  availableKinematics: TimelineKinematicsVersion[];
  selectedKinematics: TimelineKinematicsVersion | null;
  activePrediction: TimelinePrediction | null;
  leakageSafe: boolean;
}

export interface TimelineModel {
  window: TimelineWindow;
  snapshots: TimelineSnapshot[];
  events: TimelineEvent[];
  chips: TimelineEventChip[];
  liveSnapshot: TimelineSnapshot;
}

export interface BuildTimelineModelInput {
  snapshots: TimelineSnapshot[];
  events: TimelineEvent[];
  liveAtIso?: IsoUtcString;
  historyDays?: number;
  projectDays?: number;
}
