import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLedgerRecords, ledgerSnapshot, trainResidualBundle } from './lib.mjs';

function rawCme(index, links = [], residualHours = index) {
  const start = new Date(Date.UTC(2026, 0, index + 1));
  const predicted = new Date(start.getTime() + (48 + index) * 3_600_000);
  return {
    activityID: `CME-${index}`,
    startTime: start.toISOString(),
    linkedEvents: links.map((activityID) => ({ activityID })),
    cmeAnalyses: [{
      isMostAccurate: true,
      speed: 500 + index * 30,
      halfAngle: 25 + index,
      latitude: index % 5,
      longitude: index * 2,
      time21_5: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
      enlilList: [{
        estimatedShockArrivalTime: predicted.toISOString(),
        estimatedDuration: 10,
        isEarthGB: true,
        kp_18: 3 + index * 0.2,
      }],
    }],
    _residualHours: residualHours,
  };
}

function rawShock(cme, linked = true) {
  const predicted = Date.parse(cme.cmeAnalyses[0].enlilList[0].estimatedShockArrivalTime);
  return {
    activityID: `IPS-${cme.activityID}`,
    eventTime: new Date(predicted + cme._residualHours * 3_600_000).toISOString(),
    location: 'Earth',
    instruments: [{ displayName: 'ACE: MAG' }],
    linkedEvents: linked ? [{ activityID: cme.activityID }] : [],
  };
}

function rawStorm(cme, shock, linked = true) {
  const predictedKp = cme.cmeAnalyses[0].enlilList[0].kp_18;
  return {
    gstID: `GST-${cme.activityID}`,
    startTime: shock.eventTime,
    linkedEvents: linked ? [{ activityID: shock.activityID }] : [],
    allKpIndex: [{ observedTime: shock.eventTime, kpIndex: predictedKp + cme._residualHours * 0.1, source: 'GFZ' }],
  };
}

test('ledger accepts exact DONKI graph links and rejects temporal coincidence', () => {
  const cme = rawCme(1);
  const linkedShock = rawShock(cme, true);
  const linkedStorm = rawStorm(cme, linkedShock, true);
  const exact = buildLedgerRecords([cme], [linkedShock], [linkedStorm], '2026-02-01T00:00:00.000Z');
  assert.equal(exact.outcomes.length, 1);
  assert.equal(exact.outcomes[0].shock.id, linkedShock.activityID);
  assert.equal(exact.outcomes[0].storm.id, linkedStorm.gstID);

  const coincidentShock = rawShock(cme, false);
  const coincidentStorm = rawStorm(cme, coincidentShock, false);
  const unlinked = buildLedgerRecords([cme], [coincidentShock], [coincidentStorm], '2026-02-01T00:00:00.000Z');
  assert.equal(unlinked.outcomes.length, 0);
});

test('trainer remains blocked below the 10/10 gate', () => {
  const cmes = Array.from({ length: 9 }, (_, index) => rawCme(index));
  const shocks = cmes.map((cme) => rawShock(cme));
  const storms = cmes.map((cme, index) => rawStorm(cme, shocks[index]));
  const records = buildLedgerRecords(cmes, shocks, storms, '2026-02-01T00:00:00.000Z');
  const result = trainResidualBundle(ledgerSnapshot(records.events, records.outcomes), '2026-02-01T00:00:00.000Z');
  assert.deepEqual(result.gate, { arrival: 9, kp: 9, required: 10, ready: false });
  assert.equal(result.candidate, null);
});

test('missing measurements block fitting instead of being coerced to zero', () => {
  const cmes = Array.from({ length: 10 }, (_, index) => rawCme(index));
  cmes[9].cmeAnalyses[0].longitude = null;
  const shocks = cmes.map((cme) => rawShock(cme));
  const storms = cmes.map((cme, index) => rawStorm(cme, shocks[index]));
  const records = buildLedgerRecords(cmes, shocks, storms, '2026-02-01T00:00:00.000Z');
  const result = trainResidualBundle(ledgerSnapshot(records.events, records.outcomes), '2026-02-01T00:00:00.000Z');

  assert.deepEqual(result.gate, { arrival: 10, kp: 10, required: 10, ready: true });
  assert.equal(result.candidate, null);
  assert.equal(result.blockedReason, 'insufficient_complete_feature_rows');
});

test('trainer holds out the newest rows and registers only a backtested challenger', () => {
  const cmes = Array.from({ length: 12 }, (_, index) => rawCme(index, [], 2 + index * 0.5));
  const shocks = cmes.map((cme) => rawShock(cme));
  const storms = cmes.map((cme, index) => rawStorm(cme, shocks[index]));
  const records = buildLedgerRecords(cmes, shocks, storms, '2026-02-01T00:00:00.000Z');
  const result = trainResidualBundle(ledgerSnapshot(records.events, records.outcomes), '2026-02-01T00:00:00.000Z');

  assert.equal(result.gate.ready, true);
  assert.ok(result.candidate);
  assert.equal(result.candidate.status, 'registered_challenger');
  assert.deepEqual(result.candidate.backtest.arrival.holdout_event_ids, ['CME-9', 'CME-10', 'CME-11']);
  assert.deepEqual(result.candidate.backtest.kp.holdout_event_ids, ['CME-9', 'CME-10', 'CME-11']);
  assert.ok(result.candidate.backtest.arrival.candidate_mae_hours < result.candidate.backtest.arrival.baseline_mae_hours);
  assert.ok(result.candidate.backtest.kp.candidate_mae < result.candidate.backtest.kp.baseline_mae);
});

test('held-out backtests never split one physical outcome across train and holdout', () => {
  const cmes = Array.from({ length: 12 }, (_, index) => rawCme(index, [], 2 + index * 0.5));
  const shocks = cmes.map((cme) => rawShock(cme));
  const storms = cmes.map((cme, index) => rawStorm(cme, shocks[index]));
  const records = buildLedgerRecords(cmes, shocks, storms, '2026-02-01T00:00:00.000Z');
  for (const index of [8, 9, 10]) {
    records.outcomes[index].shock.id = 'IPS-shared-late-outcome';
    records.outcomes[index].storm.id = 'GST-shared-late-outcome';
  }

  const result = trainResidualBundle(ledgerSnapshot(records.events, records.outcomes), '2026-02-01T00:00:00.000Z');
  assert.ok(result.candidate);
  assert.deepEqual(result.candidate.backtest.arrival.holdout_event_ids, ['CME-8', 'CME-9', 'CME-10', 'CME-11']);
  assert.deepEqual(result.candidate.backtest.kp.holdout_event_ids, ['CME-8', 'CME-9', 'CME-10', 'CME-11']);
  assert.equal(result.candidate.training.arrival_event_ids.includes('CME-8'), false);
  assert.equal(result.candidate.training.kp_event_ids.includes('CME-8'), false);
});
