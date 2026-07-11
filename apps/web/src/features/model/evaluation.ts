import type { DonkiCme, DonkiGst, DonkiIps } from '@/scene/donki-feeds';

export interface EvaluationCase {
  cmeId: string;
  predictedArrivalIso: string | null;
  observedArrivalIso: string | null;
  arrivalErrorHours: number | null;
  predictedKp: number | null;
  observedKp: number | null;
  kpError: number | null;
}

export interface EvaluationSummary {
  cases: EvaluationCase[];
  arrivalN: number;
  arrivalMaeHours: number | null;
  arrivalBiasHours: number | null;
  kpN: number;
  kpMae: number | null;
  kpBias: number | null;
  calibrationReady: boolean;
}

const intersects = (a: Iterable<string>, b: Iterable<string>): boolean => {
  const set = new Set(a);
  for (const value of b) if (set.has(value)) return true;
  return false;
};

function linkedShock(cme: DonkiCme, shocks: DonkiIps[]): DonkiIps | null {
  const cmeGraph = [cme.activityID, ...cme.linkedEventIds];
  return shocks
    .filter((shock) => (shock.location ?? '').toLowerCase() === 'earth')
    .filter((shock) => intersects(cmeGraph, [shock.id, ...(shock.linkedEventIds ?? [])]))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))[0] ?? null;
}

function linkedStorm(cme: DonkiCme, shock: DonkiIps | null, storms: DonkiGst[]): DonkiGst | null {
  const graph = new Set([cme.activityID, ...cme.linkedEventIds]);
  if (shock) {
    graph.add(shock.id);
    for (const id of shock.linkedEventIds ?? []) graph.add(id);
  }
  return storms
    .filter((storm) => intersects(graph, [storm.id, ...(storm.linkedEventIds ?? [])]))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))[0] ?? null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function evaluatePredictions(
  cmes: DonkiCme[] | null | undefined,
  shocks: DonkiIps[] | null | undefined,
  storms: DonkiGst[] | null | undefined,
): EvaluationSummary {
  const cases = (cmes ?? []).map((cme): EvaluationCase => {
    const shock = linkedShock(cme, shocks ?? []);
    const storm = linkedStorm(cme, shock, storms ?? []);
    const predictedArrivalMs = cme.enlilShockIso ? Date.parse(cme.enlilShockIso) : Number.NaN;
    const observedArrivalMs = shock?.time ? Date.parse(shock.time) : Number.NaN;
    const arrivalErrorHours = Number.isFinite(predictedArrivalMs) && Number.isFinite(observedArrivalMs)
      ? (predictedArrivalMs - observedArrivalMs) / 3_600_000
      : null;
    const kpError = cme.predictedKp != null && storm?.observedKp != null
      ? cme.predictedKp - storm.observedKp
      : null;

    return {
      cmeId: cme.activityID,
      predictedArrivalIso: cme.enlilShockIso,
      observedArrivalIso: shock?.time ?? null,
      arrivalErrorHours,
      predictedKp: cme.predictedKp,
      observedKp: storm?.observedKp ?? null,
      kpError,
    };
  });

  const arrivalErrors = cases.flatMap((item) => item.arrivalErrorHours == null ? [] : [item.arrivalErrorHours]);
  const kpErrors = cases.flatMap((item) => item.kpError == null ? [] : [item.kpError]);
  return {
    cases,
    arrivalN: arrivalErrors.length,
    arrivalMaeHours: mean(arrivalErrors.map(Math.abs)),
    arrivalBiasHours: mean(arrivalErrors),
    kpN: kpErrors.length,
    kpMae: mean(kpErrors.map(Math.abs)),
    kpBias: mean(kpErrors),
    // A tiny sample can make a correction look smart by accident. Keep the
    // residual learner disabled until both heads have ten linked outcomes.
    calibrationReady: arrivalErrors.length >= 10 && kpErrors.length >= 10,
  };
}
