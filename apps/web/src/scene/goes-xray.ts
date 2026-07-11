/**
 * scene/goes-xray.ts — Real GOES X-ray flux (NOAA SWPC), drives the Sun.
 *
 * The Sun's visual-halo brightness is bound to MEASURED soft X-ray
 * flux so the star looks as active as it actually is: a quiet window is dim, a
 * real M/X flare brightens it. No arbitrary pulsing.
 *
 * Feed (CORS-open, no proxy needed):
 *   https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json
 *   array of { time_tag, satellite, flux, energy }; `energy` is
 *   "0.1-0.8nm" (long band — the flare-class band) or "0.05-0.4nm" (short).
 *   Flare class: flux 1e-4 = X1, 1e-5 = M1, 1e-6 = C1, 1e-7 = B1, 1e-8 = A1.
 *
 * The feed only covers the LAST ~1 day. For older replay times (e.g. the June
 * 2026 storm) there is no sample → callers fall back to a NEUTRAL baseline and
 * say so honestly. We never fabricate activity for a time we have no data for.
 */

import { clamp } from './canvas-helpers';

const GOES_XRAY_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
/** The flare-class band ("long" channel). */
const LONG_BAND = '0.1-0.8nm';
/** Accept a sample within this many seconds of the queried time, else "no data". */
const MAX_GAP_S = 3 * 3600;

export interface GoesXraySample {
  /** Sample time (unix seconds). */
  unix: number;
  /** Long-band soft X-ray flux (W/m²). */
  flux: number;
}

interface RawGoesXray {
  time_tag?: string;
  satellite?: number;
  flux?: number;
  energy?: string;
}

let cache: Promise<GoesXraySample[] | null> | null = null;

/**
 * Fetch + parse the long-band GOES X-ray series (cached for the session).
 * Returns `null` on any failure (offline / non-2xx / malformed) so the Sun
 * falls back to its neutral baseline.
 */
export function fetchGoesXray(): Promise<GoesXraySample[] | null> {
  if (cache) return cache;
  const promise = (async (): Promise<GoesXraySample[] | null> => {
    try {
      const res = await fetch(GOES_XRAY_URL);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawGoesXray[];
      if (!Array.isArray(raw)) return null;
      const samples = raw
        .filter((r) => r.energy === LONG_BAND && typeof r.flux === 'number' && typeof r.time_tag === 'string')
        .map((r) => ({ unix: Math.floor(Date.parse(r.time_tag as string) / 1000), flux: r.flux as number }))
        .filter((s) => Number.isFinite(s.unix) && s.flux > 0)
        .sort((a, b) => a.unix - b.unix);
      return samples.length > 0 ? samples : null;
    } catch {
      return null;
    }
  })();
  // Drop a null result so a later mount can retry; keep a real series.
  void promise.then((list) => {
    if (!list) cache = null;
  });
  cache = promise;
  return promise;
}

export interface FlareClass {
  /** GOES letter class. */
  letter: 'A' | 'B' | 'C' | 'M' | 'X';
  /** Magnitude within the class (e.g. 5.3 for M5.3). */
  magnitude: number;
  /** Display label, e.g. "M5.3". */
  label: string;
}

const CLASS_BANDS: ReadonlyArray<readonly [FlareClass['letter'], number]> = [
  ['X', 1e-4],
  ['M', 1e-5],
  ['C', 1e-6],
  ['B', 1e-7],
  ['A', 1e-8],
];

/** Map a long-band flux (W/m²) to its GOES flare classification. */
export function fluxToFlareClass(flux: number): FlareClass {
  if (!(flux > 0)) return { letter: 'A', magnitude: 0, label: 'A0.0' };
  for (const [letter, base] of CLASS_BANDS) {
    if (flux >= base) {
      const magnitude = flux / base;
      return { letter, magnitude, label: `${letter}${magnitude.toFixed(1)}` };
    }
  }
  const magnitude = flux / 1e-8;
  return { letter: 'A', magnitude, label: `A${magnitude.toFixed(1)}` };
}

/** Nearest sample at-or-around `unix`, or null when the feed doesn't cover it. */
export function fluxAt(samples: GoesXraySample[], unix: number): GoesXraySample | null {
  if (samples.length === 0) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (unix < first.unix - MAX_GAP_S) return null; // older than the 1-day feed
  if (unix > last.unix + MAX_GAP_S) return null; // beyond the feed's latest sample

  // Binary search for the last sample with unix <= query.
  let lo = 0;
  let hi = samples.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.unix <= unix) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Consider the at-or-before sample and its successor; pick the closer one.
  const before = samples[idx]!;
  const after = samples[Math.min(idx + 1, samples.length - 1)]!;
  const nearest = Math.abs(after.unix - unix) < Math.abs(before.unix - unix) ? after : before;
  return Math.abs(nearest.unix - unix) <= MAX_GAP_S ? nearest : null;
}

/**
 * Flux (W/m²) → a 0..1.5 "activity" scalar on a log scale:
 *   ≤ C1 (1e-6) → 0   (quiet)
 *   M1 (1e-5)   → 0.5
 *   X1 (1e-4)   → 1.0
 *   X10 (1e-3)  → 1.5
 */
export function goesActivity(flux: number): number {
  if (!(flux > 0)) return 0;
  return clamp((Math.log10(flux) + 6) / 2, 0, 1.5);
}

export interface GoesSunState {
  /** True when a real sample covers the queried time. */
  hasData: boolean;
  /** 0 (quiet / no data) … 1.5 (large X-class). Drives visual-halo brightness. */
  activity: number;
  /** Long-band flux (W/m²) at the queried time, or null. */
  flux: number | null;
  /** Derived flare classification, or null when no data. */
  flareClass: FlareClass | null;
  /** ISO time of the sample used, or null. */
  measuredIso: string | null;
  /** Honest one-line provenance for the on-canvas badge. */
  note: string;
}

const NEUTRAL_NO_FEED: GoesSunState = {
  hasData: false,
  activity: 0,
  flux: null,
  flareClass: null,
  measuredIso: null,
  note: 'GOES X-ray feed unavailable — Sun at neutral baseline',
};

/**
 * Resolve the Sun-driving state at `unix` from the (possibly null) GOES series.
 * No data ⇒ neutral baseline with an honest note (never fabricated activity).
 */
export function goesSunState(samples: GoesXraySample[] | null, unix: number): GoesSunState {
  if (!samples) return NEUTRAL_NO_FEED;
  const sample = fluxAt(samples, unix);
  if (!sample) {
    return {
      hasData: false,
      activity: 0,
      flux: null,
      flareClass: null,
      measuredIso: null,
      note: 'No live GOES X-ray for this time — Sun at neutral baseline',
    };
  }
  const flareClass = fluxToFlareClass(sample.flux);
  const quiet = flareClass.letter === 'A' || flareClass.letter === 'B' || flareClass.letter === 'C';
  return {
    hasData: true,
    activity: goesActivity(sample.flux),
    flux: sample.flux,
    flareClass,
    measuredIso: new Date(sample.unix * 1000).toISOString().replace('.000Z', 'Z'),
    note: `GOES X-ray ${flareClass.label}${quiet ? ' · quiet Sun' : ' · flaring'}`,
  };
}
