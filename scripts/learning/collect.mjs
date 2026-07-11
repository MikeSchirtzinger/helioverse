import path from 'node:path';
import process from 'node:process';
import { appendUniqueRevisions, buildLedgerRecords } from './lib.mjs';

function option(name, fallback = null) {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function sourceWindow() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return { start: option('start', ymd(start)), end: option('end', ymd(end)) };
}

async function fetchEndpoint(baseUrl, endpoint, start, end) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/${endpoint}`);
  url.searchParams.set('startDate', start);
  url.searchParams.set('endDate', end);
  if (url.hostname === 'api.nasa.gov') {
    const key = process.env.NASA_DONKI_KEY;
    if (!key) throw new Error('NASA_DONKI_KEY is required for direct DONKI collection.');
    url.searchParams.set('api_key', key);
  }
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Helioverse-learning/1' } });
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}.`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error(`${endpoint} returned a non-array payload.`);
  return body;
}

const root = path.resolve(import.meta.dirname, '../..');
const baseUrl = option('base-url', process.env.DONKI_BASE_URL ?? 'https://api.nasa.gov/DONKI');
const { start, end } = sourceWindow();
const recordedAt = new Date().toISOString();

const [cmes, shocks, storms] = await Promise.all([
  fetchEndpoint(baseUrl, 'CME', start, end),
  fetchEndpoint(baseUrl, 'IPS', start, end),
  fetchEndpoint(baseUrl, 'GST', start, end),
]);

const records = buildLedgerRecords(cmes, shocks, storms, recordedAt);
const eventResult = await appendUniqueRevisions(path.join(root, 'learning/ledger/v1/events.jsonl'), records.events);
const outcomeResult = await appendUniqueRevisions(path.join(root, 'learning/ledger/v1/outcomes.jsonl'), records.outcomes);

process.stdout.write(`Collected ${start}..${end}: ${eventResult.additions} event revisions, ${outcomeResult.additions} outcome revisions.\n`);
