import type {
  BuildTimelineModelInput,
  IsoUtcString,
  TimelineAsOfFrame,
  TimelineEvent,
  TimelineEventChip,
  TimelineFocusPayload,
  TimelineKinematicsVersion,
  TimelineMode,
  TimelineModel,
  TimelinePrediction,
  TimelineSnapshot,
  TimelineWindow,
} from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseIsoMillis(iso: IsoUtcString): number {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return value;
}

export function toIsoUtc(ms: number): IsoUtcString {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function eventDisplayTime(event: TimelineEvent): IsoUtcString {
  return event.liftoff_at ?? event.peak_at ?? event.detected_at;
}

export function eventShortId(eventId: string): string {
  return eventId.split('Z-')[1] ?? eventId;
}

export function eventLabel(event: TimelineEvent): string {
  if (event.type === 'CME') {
    const newest = event.kinematics[event.kinematics.length - 1];
    const speed = newest ? `${Math.round(newest.speed_kms)} km/s` : 'unmeasured';
    return `${eventShortId(event.id)} · ${speed}`;
  }
  if (event.flare?.class) {
    return `${event.type} ${event.flare.class}`;
  }
  return eventShortId(event.id);
}

export function determineTimelineMode(viewTimeIso: IsoUtcString, window: TimelineWindow, liveToleranceMs = 90_000): TimelineMode {
  const viewMs = parseIsoMillis(viewTimeIso);
  const liveMs = parseIsoMillis(window.liveAtIso);
  if (viewMs > liveMs + liveToleranceMs) return 'project';
  if (Math.abs(viewMs - liveMs) <= liveToleranceMs) return 'live';
  return 'history';
}

export function buildTimelineModel(input: BuildTimelineModelInput): TimelineModel {
  if (input.snapshots.length === 0) {
    throw new Error('Timeline requires at least one as-of snapshot');
  }

  const snapshots = [...input.snapshots].sort((a, b) => parseIsoMillis(a.generated_at) - parseIsoMillis(b.generated_at));
  const events = [...input.events].sort((a, b) => parseIsoMillis(eventDisplayTime(a)) - parseIsoMillis(eventDisplayTime(b)));
  const liveSnapshot = snapshots[snapshots.length - 1];
  if (!liveSnapshot) {
    throw new Error('Timeline requires a live snapshot');
  }

  const historyDays = input.historyDays ?? 30;
  const projectDays = input.projectDays ?? 4;
  const liveAtIso = input.liveAtIso ?? liveSnapshot.generated_at;
  const liveMs = parseIsoMillis(liveAtIso);
  const historyStartIso = toIsoUtc(liveMs - historyDays * MS_PER_DAY);
  const projectEndIso = toIsoUtc(liveMs + projectDays * MS_PER_DAY);
  const window: TimelineWindow = { historyStartIso, liveAtIso, projectEndIso, historyDays, projectDays };

  const startMs = parseIsoMillis(window.historyStartIso);
  const endMs = parseIsoMillis(window.projectEndIso);
  const spanMs = endMs - startMs;

  const chips: TimelineEventChip[] = events
    .map((event) => {
      const timeIso = eventDisplayTime(event);
      const positionPct = ((parseIsoMillis(timeIso) - startMs) / spanMs) * 100;
      return {
        id: event.id,
        type: event.type,
        label: eventLabel(event),
        timeIso,
        positionPct: clamp(positionPct, 0, 100),
        thumbnail: event.thumbnail ?? null,
        earthBoundScore: event.earth_bound_score,
        isActive: liveSnapshot.events_active.includes(event.id),
        isResolved: event.outcome !== null,
      };
    })
    .filter((chip) => parseIsoMillis(chip.timeIso) >= startMs && parseIsoMillis(chip.timeIso) <= endMs);

  return { window, snapshots, events, chips, liveSnapshot };
}

export function findAsOfSnapshot(snapshots: TimelineSnapshot[], viewTimeIso: IsoUtcString): TimelineSnapshot {
  const viewMs = parseIsoMillis(viewTimeIso);
  let best = snapshots[0];
  for (const snapshot of snapshots) {
    if (parseIsoMillis(snapshot.generated_at) <= viewMs) {
      best = snapshot;
    }
  }
  return best ?? snapshots[snapshots.length - 1]!;
}

export function getAsOfFrame(model: TimelineModel, viewTimeIso: IsoUtcString): TimelineAsOfFrame {
  const mode = determineTimelineMode(viewTimeIso, model.window, model.liveSnapshot.cadence_s * 1000);
  const snapshot = mode === 'history' ? findAsOfSnapshot(model.snapshots, viewTimeIso) : model.liveSnapshot;
  const liveMs = parseIsoMillis(model.window.liveAtIso);
  const viewMs = parseIsoMillis(viewTimeIso);
  const inputsAsOfIso = snapshot.generated_at;

  return {
    mode,
    viewTimeIso,
    inputsAsOfIso,
    snapshotGeneratedAt: snapshot.generated_at,
    isHindcast: mode === 'history',
    isProjection: viewMs > liveMs,
    delayQuality: snapshot.l1_to_earth.delay_quality,
    clocks: snapshot.clocks,
  };
}

export function getAvailableKinematics(event: TimelineEvent, inputsAsOfIso: IsoUtcString): TimelineKinematicsVersion[] {
  const asOfMs = parseIsoMillis(inputsAsOfIso);
  return event.kinematics.filter((version) => parseIsoMillis(version.measured_at) <= asOfMs);
}

export function selectKinematicsForAsOf(event: TimelineEvent, inputsAsOfIso: IsoUtcString): TimelineKinematicsVersion | null {
  const versions = getAvailableKinematics(event, inputsAsOfIso);
  return versions[versions.length - 1] ?? null;
}

export function getPredictionForAsOf(event: TimelineEvent, inputsAsOfIso: IsoUtcString): TimelinePrediction | null {
  const asOfMs = parseIsoMillis(inputsAsOfIso);
  const safePredictions = event.predictions
    .filter((prediction) => {
      const predictedAtMs = parseIsoMillis(prediction.predicted_at);
      const inputsMs = parseIsoMillis(prediction.inputs_as_of);
      return predictedAtMs <= asOfMs && inputsMs <= predictedAtMs;
    })
    .sort((a, b) => parseIsoMillis(a.predicted_at) - parseIsoMillis(b.predicted_at));
  return safePredictions[safePredictions.length - 1] ?? null;
}

export interface HindcastSafetyReport {
  ok: boolean;
  reasons: string[];
}

export function validateHindcastSafety(event: TimelineEvent, inputsAsOfIso: IsoUtcString, prediction: TimelinePrediction | null): HindcastSafetyReport {
  const reasons: string[] = [];
  const asOfMs = parseIsoMillis(inputsAsOfIso);

  const selectedVersions = getAvailableKinematics(event, inputsAsOfIso);
  for (const version of selectedVersions) {
    if (parseIsoMillis(version.measured_at) > asOfMs) {
      reasons.push(`future kinematics v${version.version} leaked into as-of frame`);
    }
  }

  if (prediction) {
    const predictedAtMs = parseIsoMillis(prediction.predicted_at);
    const inputsMs = parseIsoMillis(prediction.inputs_as_of);
    if (inputsMs > predictedAtMs) {
      reasons.push('prediction.inputs_as_of is after predicted_at');
    }
    if (predictedAtMs > asOfMs) {
      reasons.push('prediction was produced after selected as-of frame');
    }
    const selected = selectKinematicsForAsOf(event, prediction.inputs_as_of);
    if (!selected && event.kinematics.length > 0) {
      reasons.push('prediction has no kinematics version available at inputs_as_of');
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export function buildFocusPayload(model: TimelineModel, eventId: string, viewTimeIso: IsoUtcString): TimelineFocusPayload {
  const event = model.events.find((candidate) => candidate.id === eventId);
  if (!event) {
    throw new Error(`Unknown timeline event: ${eventId}`);
  }
  const frame = getAsOfFrame(model, viewTimeIso);
  const availableKinematics = getAvailableKinematics(event, frame.inputsAsOfIso);
  const selectedKinematics = availableKinematics[availableKinematics.length - 1] ?? null;
  const activePrediction = getPredictionForAsOf(event, frame.inputsAsOfIso);
  const safety = validateHindcastSafety(event, frame.inputsAsOfIso, activePrediction);

  return {
    eventId,
    focusTimeIso: viewTimeIso,
    mode: frame.mode,
    inputsAsOfIso: frame.inputsAsOfIso,
    availableKinematics,
    selectedKinematics,
    activePrediction,
    leakageSafe: safety.ok,
  };
}

export function timeToPercent(timeIso: IsoUtcString, window: TimelineWindow): number {
  const startMs = parseIsoMillis(window.historyStartIso);
  const endMs = parseIsoMillis(window.projectEndIso);
  return clamp(((parseIsoMillis(timeIso) - startMs) / (endMs - startMs)) * 100, 0, 100);
}

export function percentToTimeIso(percent: number, window: TimelineWindow): IsoUtcString {
  const startMs = parseIsoMillis(window.historyStartIso);
  const endMs = parseIsoMillis(window.projectEndIso);
  const ms = startMs + (clamp(percent, 0, 100) / 100) * (endMs - startMs);
  return toIsoUtc(ms);
}
