import path from 'node:path';
import process from 'node:process';
import { EVENT_SCHEMA, OUTCOME_SCHEMA, ledgerSnapshot, readJson, readJsonl } from './lib.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const [events, outcomes, registry, status] = await Promise.all([
  readJsonl(path.join(root, 'learning/ledger/v1/events.jsonl')),
  readJsonl(path.join(root, 'learning/ledger/v1/outcomes.jsonl')),
  readJson(path.join(root, 'learning/registry/registry.json')),
  readJson(path.join(root, 'apps/web/public/learning/status.json')),
]);

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

if (events.some((record) => record.schema_version !== EVENT_SCHEMA || !record.event_id || !record.revision)) fail('Invalid event ledger record.');
if (outcomes.some((record) => record.schema_version !== OUTCOME_SCHEMA || record.link_method !== 'donki-exact-graph')) fail('Invalid outcome ledger record.');
if (new Set(events.map((record) => record.revision)).size !== events.length) fail('Duplicate event revisions found.');
if (new Set(outcomes.map((record) => record.revision)).size !== outcomes.length) fail('Duplicate outcome revisions found.');
if (registry.production?.model_id !== 'wsa-enlil-dbm' || registry.production?.status !== 'active') fail('Production baseline registry entry changed unexpectedly.');

const snapshot = ledgerSnapshot(events, outcomes);
if (status.ledger_revision !== snapshot.ledgerRevision) fail('Public learning status is not synchronized with the ledger.');
if (status.gate?.arrival !== snapshot.arrival || status.gate?.kp !== snapshot.kp) fail('Public gate counts do not match exact-link ledger outcomes.');
if (!process.exitCode) process.stdout.write(`Learning ledger verified: ${snapshot.arrival} arrival, ${snapshot.kp} Kp, production ${registry.production.model_id}.\n`);
