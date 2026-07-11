/**
 * scene/swpc-feeds.ts — Live NOAA SWPC products (no key, CORS `*`).
 *
 * Used by the Earth-impact view when the scene clock is at/near "now" — real
 * Kp, real southward Bz, and the real OVATION aurora grid. SWPC only serves
 * the latest upstream state here. Every fetch degrades to `null` on failure;
 * callers must show an unavailable state rather than invent a replacement.
 */

import type { SwpcNow, AuroraGridPoint } from './canvas-contract';

// Re-export so callers can import SwpcNow from either module without change.
export type { SwpcNow } from './canvas-contract';

const SWPC = 'https://services.swpc.noaa.gov';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(`${SWPC}${path}`, { signal, mode: 'cors' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function utcIso(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
}

async function latestKp(signal?: AbortSignal): Promise<{ value: number | null; measuredAt: string | null }> {
  const rows = await getJson<Array<{ time_tag?: string; estimated_kp?: number }>>('/json/planetary_k_index_1m.json', signal);
  const sorted = [...(rows ?? [])].sort((a, b) => Date.parse(utcIso(b.time_tag) ?? '') - Date.parse(utcIso(a.time_tag) ?? ''));
  const latest = sorted.find((row) => typeof row.estimated_kp === 'number');
  return { value: latest?.estimated_kp ?? null, measuredAt: utcIso(latest?.time_tag) };
}

/** Parsed fields from the newest active RTSW magnetic row. */
interface MagFields {
  bx: number | null;
  by: number | null;
  bz_nt: number | null;
  bt: number | null;
  measured_at: string | null;
  source: string | null;
  quality: number | null;
}

/**
 * Latest active IMF vector from NOAA's replacement RTSW object feed.
 * SCN 26-21 removed the old /products/solar-wind array feeds on 2026-06-30.
 * Multiple spacecraft can share a timestamp, so filter `active` and sort.
 */
async function latestMag(signal?: AbortSignal): Promise<MagFields> {
  interface RtswMagRow {
    time_tag?: string;
    active?: boolean;
    source?: string;
    bx_gsm?: number | null;
    by_gsm?: number | null;
    bz_gsm?: number | null;
    bt?: number | null;
    overall_quality?: number | null;
  }
  const rows = await getJson<RtswMagRow[]>('/json/rtsw/rtsw_mag_1m.json', signal);
  const latest = [...(rows ?? [])]
    .filter((row) => row.active === true)
    .sort((a, b) => Date.parse(utcIso(b.time_tag) ?? '') - Date.parse(utcIso(a.time_tag) ?? ''))
    .find((row) => row.bz_gsm != null || row.bt != null);
  const finite = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  return {
    bx: finite(latest?.bx_gsm),
    by: finite(latest?.by_gsm),
    bz_nt: finite(latest?.bz_gsm),
    bt: finite(latest?.bt),
    measured_at: utcIso(latest?.time_tag),
    source: latest?.source ?? null,
    quality: finite(latest?.overall_quality),
  };
}

/** Parsed fields from the newest active RTSW wind row. */
interface PlasmaFields {
  density: number | null;
  speed_kms: number | null;
  temperature: number | null;
  measured_at: string | null;
  source: string | null;
  quality: number | null;
}

/**
 * Latest active plasma row from NOAA's replacement RTSW object feed.
 */
async function latestPlasma(signal?: AbortSignal): Promise<PlasmaFields> {
  interface RtswWindRow {
    time_tag?: string;
    active?: boolean;
    source?: string;
    proton_density?: number | null;
    proton_speed?: number | null;
    proton_temperature?: number | null;
    overall_quality?: number | null;
  }
  const rows = await getJson<RtswWindRow[]>('/json/rtsw/rtsw_wind_1m.json', signal);
  const latest = [...(rows ?? [])]
    .filter((row) => row.active === true)
    .sort((a, b) => Date.parse(utcIso(b.time_tag) ?? '') - Date.parse(utcIso(a.time_tag) ?? ''))
    .find((row) => row.proton_speed != null || row.proton_density != null);
  const finite = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  return {
    density: finite(latest?.proton_density),
    speed_kms: finite(latest?.proton_speed),
    temperature: finite(latest?.proton_temperature),
    measured_at: utcIso(latest?.time_tag),
    source: latest?.source ?? null,
    quality: finite(latest?.overall_quality),
  };
}

interface OvationGrid {
  'Observation Time'?: string;
  'Forecast Time'?: string;
  coordinates?: Array<[number, number, number]>; // [lon, lat, aurora_probability 0..100]
}

/** Parsed OVATION aurora output: edge-latitude scalar + full grid. */
interface AuroraData {
  edgeLatDeg: number | null;
  grid: AuroraGridPoint[] | null;
  observedAt: string | null;
  forecastAt: string | null;
}

/**
 * Fetch the OVATION aurora nowcast.
 * Returns:
 *   edgeLatDeg — northern-hemisphere equatorward edge (lowest lat ≥ threshold, or null)
 *   grid       — ALL coordinate points (both hemispheres); ~65,160 entries from the raw
 *                [lon, lat, probability] tuples; mapped to typed {lon, lat, prob} objects.
 *                null when the fetch failed or coordinates were absent.
 *
 * The full grid is retained so Phase 2 can render a DataTexture on the Earth globe.
 */
async function auroraData(signal?: AbortSignal, threshold = 10): Promise<AuroraData> {
  const response = await getJson<OvationGrid>('/json/ovation_aurora_latest.json', signal);
  if (!response?.coordinates) return { edgeLatDeg: null, grid: null, observedAt: null, forecastAt: null };

  let edge: number | null = null;
  // Build the typed grid while computing the edge in a single pass (no double iteration).
  const grid: AuroraGridPoint[] = response.coordinates.map(([lon, lat, prob]) => {
    // Track northern-hemisphere equatorward edge while mapping.
    if (lat > 0 && prob >= threshold) {
      if (edge === null || lat < edge) edge = lat;
    }
    return { lon, lat, prob };
  });

  return {
    edgeLatDeg: edge,
    grid,
    observedAt: utcIso(response['Observation Time']),
    forecastAt: utcIso(response['Forecast Time']),
  };
}

// ---------------------------------------------------------------------------
// Dst (Kyoto via SWPC proxy)
// ---------------------------------------------------------------------------

/**
 * Shape returned by services.swpc.noaa.gov/products/kyoto-dst.json.
 * VERIFIED response shape (browser, 2026-06-14): array of objects, NO header row.
 *   { "time_tag": "2026-06-07T09:00:00", "dst": -18 }
 * time_tag has no UTC offset suffix; treat as UTC (append Z for ISO compliance).
 */
interface KyotoDstRow {
  time_tag: string;
  dst: number | null;
}

interface DstResult {
  dst_nt: number | null;
  dst_measured_at: string | null;
}

/**
 * Fetch the latest provisional Kyoto Dst value from the SWPC endpoint.
 * CORS-open: fetched directly from services.swpc.noaa.gov (same as Kp/Bz).
 * Takes the LAST element of the array (no header row to skip).
 * Returns nulls on any failure.
 */
async function latestDst(signal?: AbortSignal): Promise<DstResult> {
  const rows = await getJson<KyotoDstRow[]>('/products/kyoto-dst.json', signal);
  if (!rows || rows.length === 0) return { dst_nt: null, dst_measured_at: null };

  const last = rows[rows.length - 1];
  if (!last) return { dst_nt: null, dst_measured_at: null };

  const dst = last.dst != null ? Number(last.dst) : Number.NaN;
  // time_tag arrives without a UTC offset; append Z so downstream ISO parsing is unambiguous.
  const timeTag = typeof last.time_tag === 'string'
    ? (last.time_tag.endsWith('Z') ? last.time_tag : `${last.time_tag}Z`)
    : null;

  return {
    dst_nt: Number.isFinite(dst) ? dst : null,
    dst_measured_at: timeTag,
  };
}

// ---------------------------------------------------------------------------
// Hp30 (GFZ Potsdam via /gfz proxy)
// ---------------------------------------------------------------------------

/**
 * Shape returned by kp.gfz.de/app/json/ for a single index query.
 * VERIFIED response shape (browser, 2026-06-14):
 *   { "Hp30": [3.667, 3.0, ..., 2.667],        // N numbers (exact key "Hp30")
 *     "datetime": ["2026-06-13T23:30:00Z", ...], // N ISO strings aligned to Hp30
 *     "meta": { ... } }
 * There is NO "status" array in the response body (status is only a query param).
 * Keys are case-sensitive: "Hp30" and "datetime" exactly as shown.
 */
interface GfzJsonResponse {
  datetime?: string[];
  Hp30?: (number | null)[];
  // meta and any other keys are ignored.
  [key: string]: unknown;
}

interface Hp30Result {
  hp30: number | null;
  hp30_measured_at: string | null;
}

/**
 * Fetch the latest GFZ Hp30 nowcast value via the /gfz Vite proxy.
 * Proxy target: https://kp.gfz.de, rewrite: /gfz → /app/json.
 * Query: last 24 hours, index=Hp30, status=nowcast.
 * Scans for the last non-null value pair (datetime + Hp30).
 * Returns nulls on any failure.
 */
async function latestHp30(signal?: AbortSignal): Promise<Hp30Result> {
  try {
    const now = new Date();
    const nowMinus24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // GFZ requires EXACTLY YYYY-MM-DDTHH:MM:SSZ (seconds precision, NO milliseconds).
    // Raw Date.toISOString() → "...38.842Z" (milliseconds) → GFZ returns HTTP 500.
    // Minute precision "...08:27Z" also returns 500. Only seconds precision returns 200.
    const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const start = fmt(nowMinus24h);
    const end = fmt(now);

    const url = `/gfz/?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&index=Hp30&status=nowcast`;
    const res = await fetch(url, { signal, mode: 'cors' });
    if (!res.ok) return { hp30: null, hp30_measured_at: null };

    const data = (await res.json()) as GfzJsonResponse;
    const datetimes = data.datetime;
    const values = data.Hp30;

    if (!Array.isArray(datetimes) || !Array.isArray(values) || datetimes.length === 0) {
      return { hp30: null, hp30_measured_at: null };
    }

    // Walk backwards to find the latest non-null value.
    for (let i = values.length - 1; i >= 0; i--) {
      const v = values[i];
      if (v != null && Number.isFinite(Number(v))) {
        return {
          hp30: Number(v),
          hp30_measured_at: datetimes[i] ?? null,
        };
      }
    }

    return { hp30: null, hp30_measured_at: null };
  } catch {
    return { hp30: null, hp30_measured_at: null };
  }
}

// ---------------------------------------------------------------------------
// Consolidated snapshot
// ---------------------------------------------------------------------------

/** Pull a consolidated "now" snapshot of real conditions. */
export async function fetchSwpcNow(signal?: AbortSignal): Promise<SwpcNow> {
  const [kp, mag, plasma, aurora, dst, hp30] = await Promise.all([
    latestKp(signal),
    latestMag(signal),
    latestPlasma(signal),
    auroraData(signal),
    latestDst(signal),
    latestHp30(signal),
  ]);

  return {
    // Existing fields — unchanged semantics, backward-compatible.
    kp: kp.value,
    bz_nt:            mag.bz_nt,
    speed_kms:        plasma.speed_kms,
    auroraEdgeLatDeg: aurora.edgeLatDeg,

    // New IMF fields.
    bx: mag.bx,
    by: mag.by,
    bt: mag.bt,

    // New plasma fields.
    density:     plasma.density,
    temperature: plasma.temperature,

    // Full OVATION grid (both hemispheres; ~65,160 {lon,lat,prob} points).
    auroraGrid: aurora.grid,

    // Reward / label feeds (ENG-1 extension).
    dst_nt:          dst.dst_nt,
    dst_measured_at: dst.dst_measured_at,
    hp30:            hp30.hp30,
    hp30_measured_at: hp30.hp30_measured_at,

    mag_measured_at: mag.measured_at,
    mag_source: mag.source,
    mag_quality: mag.quality,
    plasma_measured_at: plasma.measured_at,
    plasma_source: plasma.source,
    plasma_quality: plasma.quality,
    kp_measured_at: kp.measuredAt,
    ovation_observed_at: aurora.observedAt,
    ovation_forecast_at: aurora.forecastAt,
    feed_status: {
      mag: mag.measured_at ? 'ok' : 'unavailable',
      plasma: plasma.measured_at ? 'ok' : 'unavailable',
      kp: kp.measuredAt ? 'ok' : 'unavailable',
      ovation: aurora.grid ? 'ok' : 'unavailable',
      dst: dst.dst_measured_at ? 'ok' : 'unavailable',
      hp30: hp30.hp30_measured_at ? 'ok' : 'unavailable',
    },
  };
}
