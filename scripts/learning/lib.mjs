import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REQUIRED_OUTCOMES = 10;
export const EVENT_SCHEMA = 'helioverse.prediction-event.v1';
export const OUTCOME_SCHEMA = 'helioverse.outcome.v1';
export const MODEL_SCHEMA = 'helioverse.residual-model.v1';

const HOUR_MS = 3_600_000;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function revisionOf(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16);
}

function linkedIds(raw) {
  return (raw?.linkedEvents ?? [])
    .map((event) => event?.activityID)
    .filter((id) => typeof id === 'string' && id.length > 0);
}

function bestAnalysis(raw) {
  const analyses = Array.isArray(raw?.cmeAnalyses) ? raw.cmeAnalyses : [];
  return analyses.find((analysis) => analysis?.isMostAccurate) ?? analyses.at(-1) ?? null;
}

function maxPredictedKp(enlil) {
  const values = [enlil?.kp_18, enlil?.kp_90, enlil?.kp_135, enlil?.kp_180]
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function normalizePrediction(raw) {
  const analysis = bestAnalysis(raw);
  const enlil = analysis?.enlilList?.[0] ?? null;
  const halfAngle = finiteOrNull(analysis?.halfAngle);
  const note = `${raw?.note ?? ''} ${analysis?.note ?? ''}`.toLowerCase();
  const isHalo = note.includes('halo') || (halfAngle != null && halfAngle >= 45);
  return {
    event_id: typeof raw?.activityID === 'string' ? raw.activityID : '',
    measurement: {
      source: 'NASA DONKI CMEAnalysis',
      start_iso: isoOrNull(raw?.startTime),
      time_21_5_iso: isoOrNull(analysis?.time21_5),
      speed_kms: finiteOrNull(analysis?.speed),
      half_angle_deg: halfAngle,
      source_lat_deg: finiteOrNull(analysis?.latitude),
      source_lon_deg: finiteOrNull(analysis?.longitude),
      is_halo: isHalo,
    },
    baseline: {
      model_id: 'wsa-enlil-dbm',
      predicted_arrival_iso: isoOrNull(enlil?.estimatedShockArrivalTime),
      predicted_duration_hours: finiteOrNull(enlil?.estimatedDuration),
      predicted_kp: maxPredictedKp(enlil),
      earth_impact_flag: enlil == null ? null : Boolean(enlil.isEarthGB),
    },
    exact_link_ids: linkedIds(raw),
  };
}

export function normalizeShock(raw) {
  return {
    id: typeof raw?.activityID === 'string' ? raw.activityID : '',
    observed_arrival_iso: isoOrNull(raw?.eventTime),
    location: typeof raw?.location === 'string' ? raw.location : null,
    instruments: (raw?.instruments ?? [])
      .map((instrument) => instrument?.displayName)
      .filter((name) => typeof name === 'string' && name.length > 0),
    exact_link_ids: linkedIds(raw),
  };
}

export function normalizeStorm(raw) {
  const kpRows = (raw?.allKpIndex ?? []).flatMap((row) => {
    if (!Number.isFinite(row?.kpIndex) || !isoOrNull(row?.observedTime)) return [];
    return [{ observed_iso: row.observedTime, kp: row.kpIndex, source: row?.source ?? null }];
  });
  return {
    id: typeof raw?.gstID === 'string' ? raw.gstID : '',
    start_iso: isoOrNull(raw?.startTime),
    observed_kp: kpRows.length > 0 ? Math.max(...kpRows.map((row) => row.kp)) : null,
    kp_rows: kpRows,
    exact_link_ids: linkedIds(raw),
  };
}

function intersects(left, right) {
  const set = new Set(left);
  return right.some((value) => set.has(value));
}

function exactShock(event, shocks) {
  const graph = [event.event_id, ...event.exact_link_ids];
  return shocks
    .filter((shock) => (shock.location ?? '').toLowerCase() === 'earth')
    .filter((shock) => intersects(graph, [shock.id, ...shock.exact_link_ids]))
    .sort((a, b) => Date.parse(a.observed_arrival_iso ?? '') - Date.parse(b.observed_arrival_iso ?? ''))[0] ?? null;
}

function exactStorm(event, shock, storms) {
  const graph = [event.event_id, ...event.exact_link_ids];
  if (shock) graph.push(shock.id, ...shock.exact_link_ids);
  return storms
    .filter((storm) => intersects(graph, [storm.id, ...storm.exact_link_ids]))
    .sort((a, b) => Date.parse(a.start_iso ?? '') - Date.parse(b.start_iso ?? ''))[0] ?? null;
}

export function buildLedgerRecords(rawCmes, rawShocks, rawStorms, recordedAt) {
  const predictions = rawCmes.map(normalizePrediction).filter((event) => event.event_id);
  const shocks = rawShocks.map(normalizeShock).filter((shock) => shock.id);
  const storms = rawStorms.map(normalizeStorm).filter((storm) => storm.id);

  const events = predictions.map((prediction) => {
    const revision = revisionOf(prediction);
    return { schema_version: EVENT_SCHEMA, ...prediction, revision, recorded_at: recordedAt };
  });

  const outcomes = predictions.flatMap((event) => {
    const shock = exactShock(event, shocks);
    const storm = exactStorm(event, shock, storms);
    if (!shock && !storm) return [];
    const payload = {
      event_id: event.event_id,
      link_method: 'donki-exact-graph',
      shock: shock ? {
        id: shock.id,
        observed_arrival_iso: shock.observed_arrival_iso,
        location: shock.location,
        instruments: shock.instruments,
      } : null,
      storm: storm ? {
        id: storm.id,
        start_iso: storm.start_iso,
        observed_kp: storm.observed_kp,
        kp_rows: storm.kp_rows,
      } : null,
    };
    return [{ schema_version: OUTCOME_SCHEMA, ...payload, revision: revisionOf(payload), recorded_at: recordedAt }];
  });

  return { events, outcomes };
}

export async function readJsonl(file) {
  try {
    const text = await readFile(file, 'utf8');
    return text.split('\n').filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendUniqueRevisions(file, records) {
  await mkdir(path.dirname(file), { recursive: true });
  const existing = await readJsonl(file);
  const revisions = new Set(existing.map((record) => record.revision));
  const additions = records.filter((record) => !revisions.has(record.revision));
  if (additions.length > 0) {
    await appendFile(file, additions.map((record) => JSON.stringify(record)).join('\n') + '\n');
  }
  return { additions: additions.length, total: existing.length + additions.length };
}

export function latestByEvent(records) {
  const latest = new Map();
  for (const record of records) latest.set(record.event_id, record);
  return latest;
}

export function ledgerSnapshot(eventRecords, outcomeRecords) {
  const events = latestByEvent(eventRecords);
  const outcomes = latestByEvent(outcomeRecords);
  const arrival = [...outcomes.values()].filter((outcome) => outcome.shock?.observed_arrival_iso).length;
  const kp = [...outcomes.values()].filter((outcome) => Number.isFinite(outcome.storm?.observed_kp)).length;
  const ledgerRevision = revisionOf({
    events: [...events.values()].map((record) => record.revision).sort(),
    outcomes: [...outcomes.values()].map((record) => record.revision).sort(),
  });
  return { events, outcomes, arrival, kp, ledgerRevision };
}

function joinedRows(snapshot, head) {
  const rows = [];
  for (const [eventId, outcome] of snapshot.outcomes) {
    const event = snapshot.events.get(eventId);
    if (!event) continue;
    const m = event.measurement;
    const b = event.baseline;
    const sourceLon = Number.isFinite(m.source_lon_deg) ? Math.abs(m.source_lon_deg) : null;
    const sourceLat = Number.isFinite(m.source_lat_deg) ? Math.abs(m.source_lat_deg) : null;
    const shared = [m.speed_kms, m.half_angle_deg, sourceLon, sourceLat, m.is_halo ? 1 : 0];
    if (!shared.every(Number.isFinite)) continue;
    if (head === 'arrival') {
      const predictedMs = Date.parse(b.predicted_arrival_iso ?? '');
      const observedMs = Date.parse(outcome.shock?.observed_arrival_iso ?? '');
      const startMs = Date.parse(m.start_iso ?? '');
      if (![predictedMs, observedMs, startMs].every(Number.isFinite)) continue;
      rows.push({
        eventId,
        outcomeId: outcome.shock.id,
        at: observedMs,
        x: [...shared, (predictedMs - startMs) / HOUR_MS],
        target: (observedMs - predictedMs) / HOUR_MS,
      });
    } else {
      const predicted = b.predicted_kp;
      const observed = outcome.storm?.observed_kp;
      const at = Date.parse(outcome.storm?.start_iso ?? '');
      if (![predicted, observed, at].every(Number.isFinite)) continue;
      rows.push({ eventId, outcomeId: outcome.storm.id, at, x: [...shared, predicted], target: observed - predicted });
    }
  }
  return rows.sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId));
}

function splitChronologically(rows) {
  const targetRows = Math.max(2, Math.ceil(rows.length * 0.2));
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.outcomeId) ?? { at: row.at, rows: [] };
    group.at = Math.max(group.at, row.at);
    group.rows.push(row);
    groups.set(row.outcomeId, group);
  }

  // A single observed shock or storm can be linked to several CMEs. Keep every
  // row from that physical outcome on one side of the split so the target does
  // not leak from training into the chronological backtest.
  const orderedGroups = [...groups.entries()].sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]));
  const holdoutOutcomeIds = new Set();
  let heldRows = 0;
  for (let index = orderedGroups.length - 1; index > 0 && heldRows < targetRows; index -= 1) {
    const [outcomeId, group] = orderedGroups[index];
    holdoutOutcomeIds.add(outcomeId);
    heldRows += group.rows.length;
  }
  return {
    train: rows.filter((row) => !holdoutOutcomeIds.has(row.outcomeId)),
    holdout: rows.filter((row) => holdoutOutcomeIds.has(row.outcomeId)),
  };
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('Residual fit is singular after regularization.');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= scale;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function fitRidge(rows, lambda = 1) {
  const dimensions = rows[0].x.length;
  const means = Array.from({ length: dimensions }, (_, index) => rows.reduce((sum, row) => sum + row.x[index], 0) / rows.length);
  const scales = means.map((mean, index) => {
    const variance = rows.reduce((sum, row) => sum + (row.x[index] - mean) ** 2, 0) / rows.length;
    return Math.sqrt(variance) || 1;
  });
  const design = rows.map((row) => [1, ...row.x.map((value, index) => (value - means[index]) / scales[index])]);
  const size = dimensions + 1;
  const xtx = Array.from({ length: size }, () => Array(size).fill(0));
  const xty = Array(size).fill(0);
  for (let r = 0; r < design.length; r += 1) {
    for (let i = 0; i < size; i += 1) {
      xty[i] += design[r][i] * rows[r].target;
      for (let j = 0; j < size; j += 1) xtx[i][j] += design[r][i] * design[r][j];
    }
  }
  for (let i = 1; i < size; i += 1) xtx[i][i] += lambda;
  return { means, scales, weights: solveLinearSystem(xtx, xty), lambda };
}

function predict(model, x) {
  return model.weights[0] + x.reduce((sum, value, index) => sum + model.weights[index + 1] * ((value - model.means[index]) / model.scales[index]), 0);
}

function mae(values) {
  return values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
}

function fitHead(rows, featureNames) {
  const { train, holdout } = splitChronologically(rows);
  const model = fitRidge(train);
  const baselineMae = mae(holdout.map((row) => row.target));
  const candidateMae = mae(holdout.map((row) => row.target - predict(model, row.x)));
  return {
    model: { ...model, features: featureNames },
    train_event_ids: train.map((row) => row.eventId),
    train_outcome_ids: [...new Set(train.map((row) => row.outcomeId))],
    holdout_event_ids: holdout.map((row) => row.eventId),
    holdout_outcome_ids: [...new Set(holdout.map((row) => row.outcomeId))],
    baseline_mae: baselineMae,
    candidate_mae: candidateMae,
    improvement: baselineMae - candidateMae,
  };
}

export function trainResidualBundle(snapshot, createdAt) {
  const arrivalRows = joinedRows(snapshot, 'arrival');
  const kpRows = joinedRows(snapshot, 'kp');
  const gate = {
    arrival: snapshot.arrival,
    kp: snapshot.kp,
    required: REQUIRED_OUTCOMES,
    ready: snapshot.arrival >= REQUIRED_OUTCOMES && snapshot.kp >= REQUIRED_OUTCOMES,
  };
  if (!gate.ready) return { gate, candidate: null };

  // Exact-link counts are the public 10/10 gate. Fitting additionally requires
  // ten complete feature rows per head; missing measurements are never coerced
  // to zero or filled with a synthetic fallback.
  if (arrivalRows.length < REQUIRED_OUTCOMES || kpRows.length < REQUIRED_OUTCOMES) {
    return { gate, candidate: null, blockedReason: 'insufficient_complete_feature_rows' };
  }

  // The 10/10 sample gate counts exact-linked CME outcomes. Independently,
  // backtesting needs at least two distinct physical shocks/storms so a group
  // can be held out without reusing the same target during fitting.
  const arrivalGroups = new Set(arrivalRows.map((row) => row.outcomeId)).size;
  const kpGroups = new Set(kpRows.map((row) => row.outcomeId)).size;
  if (arrivalGroups < 2 || kpGroups < 2) {
    return { gate, candidate: null, blockedReason: 'insufficient_independent_outcome_groups' };
  }

  const commonFeatures = ['speed_kms', 'half_angle_deg', 'abs_source_lon_deg', 'abs_source_lat_deg', 'is_halo'];
  const arrival = fitHead(arrivalRows, [...commonFeatures, 'predicted_transit_hours']);
  const kp = fitHead(kpRows, [...commonFeatures, 'predicted_kp']);
  const passed = arrival.improvement > 0 && kp.improvement > 0;
  const payload = {
    ledger_revision: snapshot.ledgerRevision,
    gate,
    heads: { arrival: arrival.model, kp: kp.model },
    backtest: {
      split: 'latest-20-percent-chronological-grouped-by-physical-outcome',
      arrival: {
        baseline_mae_hours: arrival.baseline_mae,
        candidate_mae_hours: arrival.candidate_mae,
        improvement_hours: arrival.improvement,
        holdout_event_ids: arrival.holdout_event_ids,
        holdout_outcome_ids: arrival.holdout_outcome_ids,
      },
      kp: {
        baseline_mae: kp.baseline_mae,
        candidate_mae: kp.candidate_mae,
        improvement: kp.improvement,
        holdout_event_ids: kp.holdout_event_ids,
        holdout_outcome_ids: kp.holdout_outcome_ids,
      },
      passed,
    },
    training: {
      arrival_event_ids: arrival.train_event_ids,
      arrival_outcome_ids: arrival.train_outcome_ids,
      kp_event_ids: kp.train_event_ids,
      kp_outcome_ids: kp.train_outcome_ids,
    },
  };
  const modelId = `residual-${revisionOf(payload)}`;
  return {
    gate,
    candidate: {
      schema_version: MODEL_SCHEMA,
      model_id: modelId,
      created_at: createdAt,
      status: passed ? 'registered_challenger' : 'rejected_backtest',
      training: payload.training,
      backtest: payload.backtest,
      heads: payload.heads,
    },
  };
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
