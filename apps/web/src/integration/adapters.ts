import { snapshotStorm } from '@/features/aurora';
import type { Snapshot } from '@/features/aurora';
import type { HelioEvent, HelioSnapshot } from '@/features/panels';
import { buildFocusPayload, buildTimelineModel, type TimelineFocusPayload } from '@/features/timeline';
import type { TimelineEvent, TimelineModel, TimelineSnapshot } from '@/features/timeline';
import { sceneFromFixtures, type EventForScene, type SceneFromFixtures, type SnapshotForScene } from '@/scene';

import haloEventData from '../../../../contracts/fixtures/events/event-cme-halo.json';
import resolvedEventData from '../../../../contracts/fixtures/events/event-cme-resolved.json';

const activeHaloEvent = haloEventData as HelioEvent & TimelineEvent & EventForScene;
const resolvedCmeEvent = resolvedEventData as HelioEvent & TimelineEvent & EventForScene;
const fixtureSnapshot = snapshotStorm as Snapshot & HelioSnapshot & SnapshotForScene;

export interface DashboardReadiness {
  b3: {
    eventId: string;
    label: string;
    scorePct: number;
    predictedKp: number | null;
    arrivalWindow: string;
    ovalContext: string;
  };
  noaa: {
    oursDelayMinutes: number;
    noaaDelayMinutes: number;
    deltaMinutes: number;
    text: string;
  };
  clocks: Array<{ id: 'sun' | 'l1' | 'projection'; label: string; text: string; status: 'ready' | 'degraded' }>;
  scrubSafety: {
    frame: TimelineFocusPayload;
    text: string;
  };
}

export interface FixtureDashboardModel {
  snapshot: Snapshot & HelioSnapshot;
  events: HelioEvent[];
  activeEvent: HelioEvent;
  scene: SceneFromFixtures;
  timeline: TimelineModel;
  readiness: DashboardReadiness;
}

export function buildFixtureDashboardModel(): FixtureDashboardModel {
  const events = [activeHaloEvent, resolvedCmeEvent] as HelioEvent[];
  const activeEvent = events.find((event) => fixtureSnapshot.events_active.includes(event.id)) ?? activeHaloEvent;
  const scene = sceneFromFixtures(fixtureSnapshot, [activeEvent as EventForScene]);
  const timelineSnapshots = buildTimelineSnapshots(fixtureSnapshot, activeEvent, resolvedCmeEvent);
  const timeline = buildTimelineModel({
    snapshots: timelineSnapshots,
    events: [resolvedCmeEvent, activeHaloEvent] as TimelineEvent[],
    liveAtIso: fixtureSnapshot.generated_at,
    historyDays: 30,
    projectDays: 4,
  });
  const scrubFrame = buildFocusPayload(timeline, activeEvent.id, '2026-06-04T10:00:00Z');

  return {
    snapshot: fixtureSnapshot,
    events,
    activeEvent,
    scene,
    timeline,
    readiness: {
      b3: buildB3Readiness(activeEvent, fixtureSnapshot),
      noaa: buildNoaaReadiness(fixtureSnapshot),
      clocks: buildClockReadiness(fixtureSnapshot),
      scrubSafety: {
        frame: scrubFrame,
        text: scrubFrame.leakageSafe
          ? `Hindcast-safe: at ${formatUtc(scrubFrame.inputsAsOfIso)}, only ${scrubFrame.availableKinematics.length} kinematics revision(s) are visible and future DBM predictions stay withheld.`
          : 'Hindcast safety failed: a future revision would leak into this scrub frame.',
      },
    },
  };
}

function buildTimelineSnapshots(snapshot: Snapshot, active: HelioEvent, resolved: HelioEvent): TimelineSnapshot[] {
  const base = pickTimelineSnapshot(snapshot);
  return [
    {
      ...base,
      generated_at: '2026-05-20T15:30:00Z',
      clocks: {
        sun_imagery_at: '2026-05-20T15:12:00Z',
        l1_measured_at: '2026-05-20T15:26:00Z',
        model_run_at: '2026-05-20T15:10:00Z',
      },
      events_active: [resolved.id],
    },
    {
      ...base,
      generated_at: '2026-05-24T06:00:00Z',
      clocks: {
        sun_imagery_at: '2026-05-24T05:43:00Z',
        l1_measured_at: '2026-05-24T05:56:00Z',
        model_run_at: '2026-05-24T06:00:00Z',
      },
      events_active: [],
    },
    {
      ...base,
      generated_at: '2026-06-04T10:00:00Z',
      clocks: {
        sun_imagery_at: '2026-06-04T09:43:00Z',
        l1_measured_at: '2026-06-04T09:56:00Z',
        model_run_at: '2026-06-04T09:40:00Z',
      },
      events_active: [active.id],
    },
    base,
  ];
}

function pickTimelineSnapshot(snapshot: Snapshot): TimelineSnapshot {
  return {
    schema_version: snapshot.schema_version,
    generated_at: snapshot.generated_at,
    cadence_s: snapshot.cadence_s,
    clocks: snapshot.clocks,
    l1_to_earth: snapshot.l1_to_earth,
    events_active: snapshot.events_active,
  };
}

function buildB3Readiness(event: HelioEvent, snapshot: Snapshot): DashboardReadiness['b3'] {
  const prediction = event.predictions.at(-1) ?? null;
  const predictedKp = prediction?.peak_kp?.value ?? null;
  return {
    eventId: event.id,
    label: `${event.type} ${event.flare?.class ?? 'fixture event'}`,
    scorePct: Math.round(event.earth_bound_score * 100),
    predictedKp,
    arrivalWindow: prediction?.arrival
      ? `${formatUtc(prediction.arrival.window_start)} → ${formatUtc(prediction.arrival.window_end)}`
      : 'No active arrival window',
    ovalContext: `OVATION power ${snapshot.ovation.hemispheric_power_gw?.toFixed(1) ?? 'n/a'} GW with Bz ${snapshot.solar_wind.bz_gsm_nt?.toFixed(1) ?? 'n/a'} nT: scene Earth footprint and aurora oval are coupled to the same active event.`,
  };
}

function buildNoaaReadiness(snapshot: Snapshot): DashboardReadiness['noaa'] {
  const oursDelayMinutes = snapshot.l1_to_earth.delay_s / 60;
  const noaaDelayMinutes = 30;
  const deltaMinutes = oursDelayMinutes - noaaDelayMinutes;
  return {
    oursDelayMinutes,
    noaaDelayMinutes,
    deltaMinutes,
    text: `Fixture-only comparison ready: our oval uses the measured ${oursDelayMinutes.toFixed(1)} min L1→Earth delay; NOAA baseline remains fixed at ${noaaDelayMinutes} min (${formatSigned(deltaMinutes)} min timing delta).`,
  };
}

function buildClockReadiness(snapshot: Snapshot): DashboardReadiness['clocks'] {
  const generatedAt = Date.parse(snapshot.generated_at);
  return [
    {
      id: 'sun',
      label: 'Sun clock',
      text: snapshot.clocks.sun_imagery_at ? `${formatAge(generatedAt, snapshot.clocks.sun_imagery_at)} old cached imagery` : 'imagery unavailable',
      status: snapshot.sources.sdo_imagery?.status === 'ok' ? 'ready' : 'degraded',
    },
    {
      id: 'l1',
      label: 'L1 clock',
      text: snapshot.clocks.l1_measured_at ? `${formatAge(generatedAt, snapshot.clocks.l1_measured_at)} old ${snapshot.solar_wind.spacecraft} plasma/mag; delay ${snapshot.l1_to_earth.delay_quality}` : 'L1 unavailable',
      status: snapshot.l1_to_earth.delay_quality === 'measured' ? 'ready' : 'degraded',
    },
    {
      id: 'projection',
      label: 'Projection clock',
      text: snapshot.clocks.model_run_at ? `${formatAge(generatedAt, snapshot.clocks.model_run_at)} old DONKI/DBM as-of` : 'model unavailable',
      status: snapshot.sources.donki.status === 'ok' ? 'ready' : 'degraded',
    },
  ];
}

export function findDashboardEvent(model: FixtureDashboardModel, eventId: string): HelioEvent {
  return model.events.find((event) => event.id === eventId) ?? model.activeEvent;
}

export function formatUtc(iso: string): string {
  return iso.replace('T', ' ').replace(/:00Z$/, 'Z');
}

function formatAge(nowMs: number, iso: string): string {
  const ageMinutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (ageMinutes < 90) return `${ageMinutes}m`;
  return `${(ageMinutes / 60).toFixed(1)}h`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}
