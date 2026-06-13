import { buildTimelineModel, toIsoUtc } from './model';
import type { TimelineEvent, TimelineSnapshot } from './types';

const LIVE_AT = '2026-06-12T12:00:00Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function snapshotAt(dayOffsetFromLive: number, active: string[] = []): TimelineSnapshot {
  const generatedMs = Date.parse(LIVE_AT) + dayOffsetFromLive * DAY_MS;
  const generatedAt = toIsoUtc(generatedMs);
  const l1At = toIsoUtc(generatedMs - 8 * 60 * 1000);
  const sunAt = toIsoUtc(generatedMs - 17 * 60 * 1000);
  const modelAt = toIsoUtc(generatedMs - 35 * 60 * 1000);
  const stormWindow = dayOffsetFromLive >= -2;

  return {
    schema_version: '1.0.0',
    generated_at: generatedAt,
    cadence_s: 300,
    clocks: {
      sun_imagery_at: sunAt,
      l1_measured_at: l1At,
      model_run_at: modelAt,
    },
    l1_to_earth: {
      spacecraft_distance_km: 1_480_000,
      delay_s: stormWindow ? 2055.6 : 3894.7,
      delay_quality: 'measured',
      arriving_now_measured_at: toIsoUtc(generatedMs - (stormWindow ? 2_055_600 : 3_894_700)),
    },
    events_active: active,
  };
}

export const fixtureTimelineSnapshots: TimelineSnapshot[] = Array.from({ length: 31 }, (_, index) => {
  const offset = -30 + index;
  const active = offset >= -2 ? ['2026-06-10T08:15Z-CME-001'] : [];
  return snapshotAt(offset, active);
});

export const fixtureTimelineEvents: TimelineEvent[] = [
  {
    schema_version: '1.0.0',
    id: '2026-05-25T16:40Z-CME-001',
    uuid: '14fb0ef7-6f7d-4d31-ae94-f2dfeb4dc312',
    type: 'CME',
    detected_at: '2026-05-25T17:05:00Z',
    peak_at: null,
    liftoff_at: '2026-05-25T16:40:00Z',
    source_region: { ar_number: 14112, lon_deg: -8, lat_deg: 11, instrument: 'SOHO/LASCO' },
    kinematics: [
      {
        version: 1,
        measured_at: '2026-05-25T17:30:00Z',
        speed_kms: 690,
        half_angle_deg: 42,
        direction: { lon_deg: -4, lat_deg: 8 },
        cme_type: 'C',
        measurement_technique: 'LE',
        is_halo: false,
        is_most_accurate: false,
      },
      {
        version: 2,
        measured_at: '2026-05-25T21:00:00Z',
        speed_kms: 742,
        half_angle_deg: 48,
        direction: { lon_deg: -2, lat_deg: 7 },
        cme_type: 'C',
        measurement_technique: 'SWPC_CAT',
        is_halo: false,
        is_most_accurate: true,
      },
    ],
    flare: null,
    thumbnail: {
      r2_key: 'v1/thumbs/2026-05-25T1640Z-CME-001.jpg',
      captured_at: '2026-05-25T16:42:00Z',
      wavelength: 'LASCO-C2',
      crop: { x: 210, y: 190, w: 96, h: 96 },
    },
    earth_bound_score: 0.72,
    links: [{ id: '2026-05-25T15:58Z-FLR-001', rel: 'caused_by' }],
    predictions: [
      {
        predicted_at: '2026-05-25T21:05:00Z',
        model: 'dbm-v1.0-fixture',
        inputs_as_of: '2026-05-25T21:00:00Z',
        hit_probability: 0.74,
        arrival: {
          eta: '2026-05-27T13:10:00Z',
          window_start: '2026-05-27T04:00:00Z',
          window_end: '2026-05-27T23:00:00Z',
          window_ci: 0.8,
        },
        arrival_speed_kms: { value: 610, sigma: 80 },
        peak_kp: { value: 5.7, sigma: 0.8 },
        min_dst_nt: { value: -82, sigma: 22 },
        params: { gamma: 0.0000002, ambient_wind_kms: 410 },
      },
    ],
    outcome: {
      resolved_at: '2026-05-28T12:00:00Z',
      hit: true,
      shock_arrival_at: '2026-05-27T16:22:00Z',
      arrival_speed_kms: 588,
      peak_kp: 6,
      min_dst_nt: -91,
      min_dst_at: '2026-05-27T22:30:00Z',
      sources: ['DONKI:IPS', 'swpc-kp', 'kyoto-dst'],
      notes: 'Fixture resolved event for timeline prediction-vs-actual display.',
    },
    provenance: {
      catalog: 'DONKI',
      donki_activity_id: '2026-05-25T16:40-CME-001',
      first_seen_at: '2026-05-25T17:05:00Z',
      as_of: '2026-05-28T12:00:00Z',
    },
  },
  {
    schema_version: '1.0.0',
    id: '2026-06-10T07:52Z-FLR-001',
    uuid: 'ad04f1b7-2707-44ff-bd5f-afc3c6394d12',
    type: 'FLR',
    detected_at: '2026-06-10T07:52:00Z',
    peak_at: '2026-06-10T08:03:00Z',
    liftoff_at: null,
    source_region: { ar_number: 14144, lon_deg: 3, lat_deg: -14, instrument: 'GOES XRS' },
    kinematics: [],
    flare: { class: 'X1.8', xray_peak_wm2: 0.00018 },
    thumbnail: {
      r2_key: 'v1/thumbs/2026-06-10T0752Z-FLR-001.jpg',
      captured_at: '2026-06-10T08:03:00Z',
      wavelength: '0304',
      crop: { x: 438, y: 398, w: 96, h: 96 },
    },
    earth_bound_score: 0.0,
    links: [{ id: '2026-06-10T08:15Z-CME-001', rel: 'causes' }],
    predictions: [],
    outcome: null,
    provenance: {
      catalog: 'DONKI',
      donki_activity_id: '2026-06-10T07:52-FLR-001',
      first_seen_at: '2026-06-10T08:08:00Z',
      as_of: '2026-06-10T08:08:00Z',
    },
  },
  {
    schema_version: '1.0.0',
    id: '2026-06-10T08:15Z-CME-001',
    uuid: 'e5583cc1-37f1-4d36-a69c-480a91db9ac0',
    type: 'CME',
    detected_at: '2026-06-10T08:38:00Z',
    peak_at: null,
    liftoff_at: '2026-06-10T08:15:00Z',
    source_region: { ar_number: 14144, lon_deg: 2, lat_deg: -13, instrument: 'SOHO/LASCO' },
    kinematics: [
      {
        version: 1,
        measured_at: '2026-06-10T09:00:00Z',
        speed_kms: 980,
        half_angle_deg: 65,
        direction: { lon_deg: 8, lat_deg: -10 },
        cme_type: 'R',
        measurement_technique: 'LE',
        is_halo: true,
        is_most_accurate: false,
      },
      {
        version: 2,
        measured_at: '2026-06-10T14:00:00Z',
        speed_kms: 1120,
        half_angle_deg: 74,
        direction: { lon_deg: 4, lat_deg: -8 },
        cme_type: 'ER',
        measurement_technique: 'SWPC_CAT',
        is_halo: true,
        is_most_accurate: true,
      },
    ],
    flare: { class: 'X1.8', xray_peak_wm2: 0.00018 },
    thumbnail: {
      r2_key: 'v1/thumbs/2026-06-10T0815Z-CME-001.jpg',
      captured_at: '2026-06-10T08:18:00Z',
      wavelength: 'LASCO-C2',
      crop: { x: 390, y: 360, w: 96, h: 96 },
    },
    earth_bound_score: 0.91,
    links: [{ id: '2026-06-10T07:52Z-FLR-001', rel: 'caused_by' }],
    predictions: [
      {
        predicted_at: '2026-06-10T09:05:00Z',
        model: 'dbm-v1.0-fixture',
        inputs_as_of: '2026-06-10T09:00:00Z',
        hit_probability: 0.83,
        arrival: {
          eta: '2026-06-12T06:45:00Z',
          window_start: '2026-06-11T20:45:00Z',
          window_end: '2026-06-12T16:45:00Z',
          window_ci: 0.8,
        },
        arrival_speed_kms: { value: 760, sigma: 120 },
        peak_kp: { value: 6.4, sigma: 1.1 },
        min_dst_nt: { value: -118, sigma: 38 },
        params: { gamma: 0.0000002, ambient_wind_kms: 430 },
      },
      {
        predicted_at: '2026-06-10T14:05:00Z',
        model: 'dbm-v1.0-fixture',
        inputs_as_of: '2026-06-10T14:00:00Z',
        hit_probability: 0.91,
        arrival: {
          eta: '2026-06-12T04:45:00Z',
          window_start: '2026-06-11T18:45:00Z',
          window_end: '2026-06-12T14:45:00Z',
          window_ci: 0.8,
        },
        arrival_speed_kms: { value: 820, sigma: 100 },
        peak_kp: { value: 7.1, sigma: 0.9 },
        min_dst_nt: { value: -145, sigma: 32 },
        params: { gamma: 0.0000002, ambient_wind_kms: 430 },
      },
    ],
    outcome: null,
    provenance: {
      catalog: 'DONKI',
      donki_activity_id: '2026-06-10T08:15-CME-001',
      first_seen_at: '2026-06-10T08:38:00Z',
      as_of: '2026-06-10T14:00:00Z',
    },
  },
];

export const fixtureTimelineModel = buildTimelineModel({
  snapshots: fixtureTimelineSnapshots,
  events: fixtureTimelineEvents,
  liveAtIso: LIVE_AT,
  historyDays: 30,
  projectDays: 4,
});
