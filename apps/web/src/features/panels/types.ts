export type IsoUtc = string;

export type SourceHealth = 'ok' | 'stale' | 'gap';
export type MetricSeverity = 'quiet' | 'elevated' | 'storm' | 'severe' | 'unknown';
export type MetricTrend = 'rising' | 'falling' | 'flat' | 'unknown';
export type ClockId = 'sun' | 'l1' | 'projection';

export interface SourceStatus {
  status: SourceHealth;
  last_success_at: IsoUtc | null;
  age_s: number | null;
}

export interface HelioSnapshot {
  schema_version: string;
  generated_at: IsoUtc;
  cadence_s: 60 | 300;
  clocks: {
    sun_imagery_at: IsoUtc | null;
    l1_measured_at: IsoUtc | null;
    model_run_at: IsoUtc | null;
  };
  sources: {
    swpc_plasma: SourceStatus;
    swpc_mag: SourceStatus;
    swpc_indices: SourceStatus;
    ovation: SourceStatus;
    donki: SourceStatus;
    goes_csm?: SourceStatus;
    sdo_imagery?: SourceStatus;
    helioviewer?: SourceStatus;
  };
  solar_wind: {
    measured_at: IsoUtc;
    spacecraft: 'DSCOVR' | 'ACE' | 'SOLAR-1' | 'IMAP';
    speed_kms: number | null;
    density_pcc: number | null;
    temperature_k: number | null;
    bt_nt: number | null;
    bx_gsm_nt: number | null;
    by_gsm_nt: number | null;
    bz_gsm_nt: number | null;
    series: {
      t_unix: number[];
      speed_kms: Array<number | null>;
      bz_gsm_nt: Array<number | null>;
      density_pcc: Array<number | null>;
    };
  };
  l1_to_earth: {
    spacecraft_distance_km: number;
    delay_s: number;
    delay_quality: 'measured' | 'degraded_fixed';
    arriving_now_measured_at: IsoUtc;
  };
  indices: {
    kp: TimedValue;
    kp_forecast?: Array<{ valid_at: IsoUtc; value: number }>;
    dst_nt: TimedValue;
    f107?: TimedValue;
    noaa_scales: {
      R: string | null;
      S: string | null;
      G: string | null;
    };
  };
  ovation: {
    observation_time: IsoUtc;
    forecast_time: IsoUtc;
    grid_r2_key: string;
    hemispheric_power_gw?: number | null;
  };
  alerts: Array<{ issued_at: IsoUtc; code: string; title: string }>;
  events_active: string[];
}

export interface TimedValue {
  value: number | null;
  measured_at: IsoUtc | null;
}

export interface SparklinePoint {
  t: number;
  value: number | null;
}

export interface ThresholdBand {
  label: string;
  min?: number;
  max?: number;
  severity: MetricSeverity;
  color: string;
}

export interface MetricPanelModel {
  key: 'bz' | 'bt' | 'speed' | 'density' | 'kp' | 'dst' | 'proton_flux';
  label: string;
  value: number | null;
  formattedValue: string;
  unit: string;
  measuredAt: IsoUtc | null;
  severity: MetricSeverity;
  trend: MetricTrend;
  sparkline: SparklinePoint[];
  thresholdBands: ThresholdBand[];
  prominence: 'hero' | 'normal';
  description: string;
  unavailableReason?: string;
}

export interface NoaaScaleBadge {
  scale: 'R' | 'S' | 'G';
  value: string | null;
  severity: MetricSeverity;
  label: string;
}

export interface ClockBadgeModel {
  id: ClockId;
  label: string;
  observedAt: IsoUtc | null;
  ageSeconds: number | null;
  status: SourceHealth;
  severity: MetricSeverity;
  description: string;
  sourceLabel: string;
  delaySeconds?: number;
  delayQuality?: HelioSnapshot['l1_to_earth']['delay_quality'];
}

export interface MetricStripModel {
  generatedAt: IsoUtc;
  spacecraft: HelioSnapshot['solar_wind']['spacecraft'];
  cadenceSeconds: number;
  metrics: MetricPanelModel[];
  noaaScales: NoaaScaleBadge[];
  clocks: ClockBadgeModel[];
  activeEventIds: string[];
  alerts: HelioSnapshot['alerts'];
}

export interface HelioEvent {
  schema_version: string;
  id: string;
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
  flare?: {
    class: string;
    xray_peak_wm2?: number | null;
  } | null;
  thumbnail?: {
    r2_key: string;
    captured_at: IsoUtc;
    wavelength: string;
    crop?: { x: number; y: number; w: number; h: number };
  } | null;
  earth_bound_score: number;
  links: Array<{ id: string; rel: 'caused_by' | 'causes' | 'merged_into' | 'merged_from' | 'associated' }>;
  predictions: EventPrediction[];
  outcome: EventOutcome | null;
  provenance: {
    catalog: 'DONKI' | 'SWPC' | 'HELIOVERSE';
    donki_activity_id?: string | null;
    first_seen_at: IsoUtc;
    as_of: IsoUtc;
  };
}

export interface KinematicsVersion {
  version: number;
  measured_at: IsoUtc;
  speed_kms: number;
  half_angle_deg: number;
  direction: { lon_deg: number; lat_deg: number };
  cme_type?: 'S' | 'C' | 'O' | 'R' | 'ER' | null;
  measurement_technique?: string | null;
  is_halo: boolean;
  is_most_accurate: boolean;
}

export interface EventPrediction {
  predicted_at: IsoUtc;
  model: string;
  inputs_as_of: IsoUtc;
  hit_probability: number;
  arrival?: {
    eta: IsoUtc;
    window_start: IsoUtc;
    window_end: IsoUtc;
    window_ci: number;
  } | null;
  arrival_speed_kms?: { value: number; sigma: number } | null;
  peak_kp?: { value: number; sigma: number } | null;
  min_dst_nt?: { value: number; sigma: number } | null;
  params?: Record<string, unknown>;
}

export interface EventOutcome {
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

export interface EventDetailRow {
  label: string;
  value: string;
  severity?: MetricSeverity;
}

export interface EventDetailModel {
  id: string;
  type: HelioEvent['type'];
  status: 'active' | 'resolved' | 'missed' | 'cataloged';
  title: string;
  subtitle: string;
  earthBoundScore: number;
  earthBoundSeverity: MetricSeverity;
  bestKinematics: KinematicsVersion | null;
  latestPrediction: EventPrediction | null;
  outcome: EventOutcome | null;
  arrivalErrorHours: number | null;
  thumbnail: HelioEvent['thumbnail'];
  rows: EventDetailRow[];
  links: HelioEvent['links'];
  provenance: HelioEvent['provenance'];
}
