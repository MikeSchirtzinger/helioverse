import path from 'node:path';
import process from 'node:process';
import { ledgerSnapshot, readJson, readJsonl, trainResidualBundle, writeJson } from './lib.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const eventFile = path.join(root, 'learning/ledger/v1/events.jsonl');
const outcomeFile = path.join(root, 'learning/ledger/v1/outcomes.jsonl');
const registryFile = path.join(root, 'learning/registry/registry.json');
const publicStatusFile = path.join(root, 'apps/web/public/learning/status.json');
const createdAt = new Date().toISOString();

const [eventRecords, outcomeRecords, registry] = await Promise.all([
  readJsonl(eventFile),
  readJsonl(outcomeFile),
  readJson(registryFile),
]);
const snapshot = ledgerSnapshot(eventRecords, outcomeRecords);
const result = trainResidualBundle(snapshot, createdAt);

let residualState = 'not_trained';
let modelId = null;
if (result.candidate) {
  modelId = result.candidate.model_id;
  residualState = result.candidate.status;
  if (!registry.models.some((model) => model.model_id === modelId)) registry.models.push(result.candidate);
}

const run = {
  schema_version: 'helioverse.training-run.v1',
  run_at: createdAt,
  ledger_revision: snapshot.ledgerRevision,
  gate: result.gate,
  outcome: result.candidate?.status ?? result.blockedReason ?? 'blocked_by_data_gate',
  model_id: modelId,
  production_model_id: registry.production.model_id,
};
registry.last_run = run;

const runName = `${createdAt.replace(/[:.]/g, '-')}-${snapshot.ledgerRevision}.json`;
await Promise.all([
  writeJson(path.join(root, 'learning/runs', runName), run),
  writeJson(registryFile, registry),
  writeJson(publicStatusFile, {
    schema_version: 'helioverse.learning-status.v1',
    generated_at: createdAt,
    ledger_revision: snapshot.ledgerRevision,
    ledger: { events: snapshot.events.size, outcomes: snapshot.outcomes.size },
    gate: result.gate,
    residual: { state: residualState, model_id: modelId, reason: result.blockedReason ?? null },
    production: { model_id: registry.production.model_id, label: 'WSA–ENLIL + DBM' },
  }),
]);

if (!result.gate.ready) {
  process.stdout.write(`Training blocked: ${result.gate.arrival}/${result.gate.required} arrival and ${result.gate.kp}/${result.gate.required} Kp outcomes.\n`);
} else if (!result.candidate) {
  process.stdout.write(`Training blocked: ${result.blockedReason}. Production remains ${registry.production.model_id}.\n`);
} else {
  process.stdout.write(`Backtest ${result.candidate.status}: ${modelId}. Production remains ${registry.production.model_id}.\n`);
}
