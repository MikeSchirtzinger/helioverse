/**
 * scene/donki-feeds.ts — Live NASA DONKI CME Analysis (real measured kinematics).
 *
 * Goes through the `/donki` Vite proxy, which injects the api_key server-side
 * (see vite.config.ts) — the key never reaches the browser. Every response is
 * cached in-memory keyed by date range so scrubbing the clock or re-rendering
 * deduplicates requests. Successful feed responses expire on a bounded TTL so
 * a live, same-day monitoring session can receive revised DONKI analyses.
 * Failures degrade to `null` — nothing here is required to render the scene.
 *
 * PROVENANCE — important, do not blur these adjacent fields:
 *   MEASURED (DONKI coronagraph analysis): speed, apex latitude/longitude,
 *     angular half-width, and the 21.5 R_sun crossing time.
 *   MODELLED (WSA-Enlil): predicted shock arrival/duration, Earth-impact
 *     qualifiers, and predicted Kp. A non-null Earth shock-arrival time is the
 *     impact forecast; `isEarthGB` only qualifies that forecast as glancing.
 *   ESTIMATED (DONKI carries NO mass or density field — confirmed):
 *     mass and ion/proton count are derived from the measured angular width via
 *     a published empirical CME mass–width relation (Vourlidas et al. 2010/2011;
 *     CDAW LASCO catalog). These are order-of-magnitude estimates, labelled as
 *     such everywhere they surface.
 */

const DONKI_BASE = '/donki';

/** Proton rest mass (kg). */
const PROTON_MASS_KG = 1.6726219e-27;

/**
 * Honest summary of a WSA-Enlil run's forecast for Earth.
 *
 * `none` means a run exists but carries no Earth shock-arrival time, while
 * `unavailable` means there is no run to classify. Impact qualifiers never
 * create an impact forecast without an arrival time.
 */
export type EnlilEarthImpactClassification =
  | 'direct'
  | 'glancing'
  | 'minor'
  | 'none'
  | 'unavailable';

/** Possible Kp span across WSA-Enlil's available clock-angle scenarios. */
export interface EnlilKpRange {
  min: number;
  max: number;
}

/** Normalised DONKI CME with the selected most-accurate analysis flattened. */
export interface DonkiCme {
  activityID: string;
  startTime: string;
  startUnix: number;
  /** On-disk flare/AR source, e.g. "N13W10" (may be empty). */
  sourceLocation: string;
  activeRegion: number | null;
  // --- measured (most-accurate analysis) ---
  speed_kms: number | null;
  halfAngle_deg: number | null;
  /** Reconstructed apex latitude (deg, +N) — the true propagation direction. */
  apexLat_deg: number | null;
  /** Reconstructed apex longitude (deg, Stonyhurst, 0 = Sun–Earth line, +W). */
  apexLon_deg: number | null;
  /** DONKI speed class S/C/O/R/ER (a SPEED bin, not a halo flag). */
  speedClass: string | null;
  isHalo: boolean;
  time21_5: string | null;
  // --- WSA-Enlil prediction (selected run; see selectEnlilAnalysis) ---
  enlilShockIso: string | null;
  enlilDurationH: number | null;
  enlilModelCompletionIso: string | null;
  enlilRunLink: string | null;
  enlilCmeIds: string[];
  /** Whether the analysis carries a WSA-Enlil model run at all. */
  hasEnlilRun: boolean;
  /** Qualified WSA-Enlil Earth-impact forecast; prefer this over a boolean. */
  earthImpactClassification: EnlilEarthImpactClassification;
  /** Raw WSA-Enlil glancing-blow qualifier; it is not an impact flag. */
  isEarthGlancingBlow: boolean;
  /** Raw WSA-Enlil minor-impact qualifier; it is not an impact flag. */
  isEarthMinorImpact: boolean;
  /**
   * Compatibility flag: true when WSA-Enlil provides an Earth shock-arrival
   * time. Prefer `earthImpactClassification` when the qualification matters.
   */
  isEarthDirected: boolean;
  /** Possible Kp span across the run's available clock-angle scenarios. */
  predictedKpRange: EnlilKpRange | null;
  /** Compatibility value: the maximum of `predictedKpRange`. */
  predictedKp: number | null;
  /** Exact DONKI graph edges (CME↔FLR↔IPS↔GST) used for outcome matching. */
  linkedEventIds: string[];
  // --- DERIVED, not from DONKI (see file header) ---
  estMass_kg: number;
  estIons: number;
  link: string;
}

interface RawEnlil {
  modelCompletionTime?: string | null;
  link?: string | null;
  cmeIDs?: string[] | null;
  estimatedShockArrivalTime?: string | null;
  estimatedDuration?: number | null;
  isEarthGB?: boolean | null;
  isEarthMinorImpact?: boolean | null;
  kp_18?: number | null;
  kp_90?: number | null;
  kp_135?: number | null;
  kp_180?: number | null;
}

interface RawAnalysis {
  isMostAccurate?: boolean;
  time21_5?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  halfAngle?: number | null;
  speed?: number | null;
  type?: string | null;
  note?: string | null;
  enlilList?: RawEnlil[] | null;
}

interface RawCme {
  activityID: string;
  startTime: string;
  sourceLocation?: string;
  activeRegionNum?: number | null;
  note?: string | null;
  link?: string;
  cmeAnalyses?: RawAnalysis[] | null;
  linkedEvents?: Array<{ activityID?: string }> | null;
}

// ---------------------------------------------------------------------------
// Honest estimators (NOT DONKI data)
// ---------------------------------------------------------------------------

/**
 * Estimate CME mass (kg) from the measured angular full-width. DONKI provides
 * no mass, so this is a log-linear fit to the published CME mass–width trend
 * (Vourlidas et al. 2010/2011; CDAW LASCO catalogue): narrow CMEs ~10^11 kg,
 * halo/partial-halo CMEs ~10^13 kg. Order-of-magnitude only.
 */
export function estimateCmeMassKg(halfAngle_deg: number | null, isHalo = false): number {
  const fullWidth = Math.max(10, (halfAngle_deg ?? 20) * 2) + (isHalo ? 30 : 0);
  // log10(M) linear in full width between the two literature anchors.
  const w0 = 20;
  const w1 = 120;
  const logM0 = Math.log10(4e11); // ~narrow CME
  const logM1 = Math.log10(1.5e13); // ~halo CME
  const t = (fullWidth - w0) / (w1 - w0);
  const logM = logM0 + t * (logM1 - logM0);
  return Math.min(3e13, Math.max(1e11, 10 ** logM));
}

/** Ion count (mostly protons) implied by an estimated CME mass. */
export function ionsFromMass(mass_kg: number): number {
  return mass_kg / PROTON_MASS_KG;
}

/**
 * Render-particle count for a CME's plasma cloud, scaled to the measured
 * angular width so a wide/halo CME visibly carries more plasma than a narrow
 * one. This is a *visualisation* mapping (point sprites), distinct from the
 * physical ion count above.
 */
export function cmeRenderParticleCount(halfAngle_deg: number | null, isHalo = false): number {
  const fullWidth = Math.max(20, (halfAngle_deg ?? 30) * 2);
  const base = 300 + fullWidth * 5.4 + (isHalo ? 160 : 0);
  return Math.round(Math.min(1200, Math.max(340, base)));
}

function kpRange(enlil: RawEnlil | undefined): EnlilKpRange | null {
  if (!enlil) return null;
  const values = [enlil.kp_18, enlil.kp_90, enlil.kp_135, enlil.kp_180].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
}

interface EnlilSelection {
  analysis: RawAnalysis;
  run: RawEnlil | undefined;
}

/**
 * Select an analysis/run pair without separating model output from the
 * measured CME geometry that produced it.
 *
 * DONKI can flag more than one analysis as most accurate. Across that complete
 * set, a parseable `modelCompletionTime` proves which WSA-Enlil run completed
 * latest. Ties resolve to the later source entry. If no candidate run has a
 * parseable completion clock, the final run in source order is only a stable
 * fallback — it is deliberately not described as the latest run. When DONKI
 * flags no analysis, the last submitted analysis preserves the prior fallback.
 */
function selectEnlilAnalysis(
  analyses: RawAnalysis[] | null | undefined,
): EnlilSelection | null {
  if (!analyses?.length) return null;

  const fallbackAnalysis = analyses[analyses.length - 1];
  if (!fallbackAnalysis) return null;
  const mostAccurate = analyses.filter((analysis) => analysis.isMostAccurate === true);
  const candidates: RawAnalysis[] = mostAccurate.length
    ? mostAccurate
    : [fallbackAnalysis];

  let latest: EnlilSelection | null = null;
  let latestUnix = -Infinity;
  let fallback: EnlilSelection | null = null;

  for (const analysis of candidates) {
    for (const run of analysis.enlilList ?? []) {
      fallback = { analysis, run };
      const completionUnix = run.modelCompletionTime == null
        ? Number.NaN
        : Date.parse(run.modelCompletionTime);
      if (Number.isFinite(completionUnix) && completionUnix >= latestUnix) {
        latest = { analysis, run };
        latestUnix = completionUnix;
      }
    }
  }

  return latest ?? fallback ?? {
    analysis: candidates[candidates.length - 1] ?? fallbackAnalysis,
    run: undefined,
  };
}

function earthImpactClassification(enlil: RawEnlil | undefined): EnlilEarthImpactClassification {
  if (!enlil) return 'unavailable';
  if (enlil.estimatedShockArrivalTime == null) return 'none';
  // Keep both raw qualifiers below. If DONKI ever supplies both, surface the
  // explicit minor-impact qualification in the single summary classification.
  if (enlil.isEarthMinorImpact === true) return 'minor';
  if (enlil.isEarthGB === true) return 'glancing';
  return 'direct';
}

function normalizeCme(raw: RawCme): DonkiCme {
  const selection = selectEnlilAnalysis(raw.cmeAnalyses);
  const analysis = selection?.analysis ?? null;
  const enlil = selection?.run;
  const halfAngle = analysis?.halfAngle ?? null;
  const noteText = `${raw.note ?? ''} ${analysis?.note ?? ''}`.toLowerCase();
  const isHalo = noteText.includes('halo') || (halfAngle != null && halfAngle >= 45);
  const estMass = estimateCmeMassKg(halfAngle, isHalo);
  const earthImpact = earthImpactClassification(enlil);
  const predictedKpRange = kpRange(enlil);

  return {
    activityID: raw.activityID,
    startTime: raw.startTime,
    startUnix: Math.floor(Date.parse(raw.startTime) / 1000),
    sourceLocation: raw.sourceLocation ?? '',
    activeRegion: raw.activeRegionNum ?? null,
    speed_kms: analysis?.speed ?? null,
    halfAngle_deg: halfAngle,
    apexLat_deg: analysis?.latitude ?? null,
    apexLon_deg: analysis?.longitude ?? null,
    speedClass: analysis?.type ?? null,
    isHalo,
    time21_5: analysis?.time21_5 ?? null,
    enlilShockIso: enlil?.estimatedShockArrivalTime ?? null,
    enlilDurationH: enlil?.estimatedDuration ?? null,
    enlilModelCompletionIso: enlil?.modelCompletionTime ?? null,
    enlilRunLink: enlil?.link ?? null,
    enlilCmeIds: (enlil?.cmeIDs ?? []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
    hasEnlilRun: enlil != null,
    earthImpactClassification: earthImpact,
    isEarthGlancingBlow: enlil?.isEarthGB === true,
    isEarthMinorImpact: enlil?.isEarthMinorImpact === true,
    isEarthDirected: enlil?.estimatedShockArrivalTime != null,
    predictedKpRange,
    predictedKp: predictedKpRange?.max ?? null,
    linkedEventIds: (raw.linkedEvents ?? [])
      .map((event) => event.activityID)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
    estMass_kg: estMass,
    estIons: ionsFromMass(estMass),
    link: raw.link ?? '',
  };
}

// ---------------------------------------------------------------------------
// Fetch (cached)
// ---------------------------------------------------------------------------

/**
 * Live DONKI records can be revised after first publication. Five minutes
 * matches the fastest consumer poll and keeps a monitoring tab current while
 * remaining far below DONKI's documented 1,000 requests/hour allowance.
 */
export const DONKI_CACHE_TTL_MS = 5 * 60 * 1000;

interface TimedCacheEntry<T> {
  promise: Promise<T | null>;
  pending: boolean;
  expiresAtMs: number;
}

type TimedPromiseCache<T> = Map<string, TimedCacheEntry<T>>;

/**
 * Share every in-flight request, including one that takes longer than the TTL.
 * Only successful real responses are retained; a null/error is immediately
 * evicted so the next poll can retry. The TTL begins when the response settles.
 */
function fetchWithTimedCache<T>(
  cache: TimedPromiseCache<T>,
  key: string,
  load: () => Promise<T | null>,
): Promise<T | null> {
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && (cached.pending || now < cached.expiresAtMs)) return cached.promise;

  const promise = load();
  const entry: TimedCacheEntry<T> = {
    promise,
    pending: true,
    expiresAtMs: Number.POSITIVE_INFINITY,
  };

  void promise.then((value) => {
    // A superseded request must not mutate the active cache entry.
    if (cache.get(key) !== entry) return;
    if (value == null) {
      cache.delete(key);
      return;
    }
    entry.pending = false;
    entry.expiresAtMs = Date.now() + DONKI_CACHE_TTL_MS;
  });
  cache.set(key, entry);
  return promise;
}

const cache: TimedPromiseCache<DonkiCme[]> = new Map();

/**
 * Fetch + normalise DONKI CME Analysis for a date range (YYYY-MM-DD). Pending
 * requests are shared, and successful responses are reused for five minutes.
 * Returns `null` on any failure (offline, proxy missing in prod, non-2xx,
 * malformed). Callers surface an unavailable state; no fixture or baked event
 * is substituted into live mode.
 *
 * Intentionally takes NO AbortSignal: this is a shared, cached resource, so the
 * network request must not be tied to any one consumer's lifecycle (a React
 * StrictMode double-mount would otherwise abort the in-flight request and pin a
 * null in the cache). Consumers guard their own setState instead.
 */
export function fetchCmeAnalyses(startDate: string, endDate: string): Promise<DonkiCme[] | null> {
  const key = `${startDate}|${endDate}`;
  return fetchWithTimedCache(cache, key, async (): Promise<DonkiCme[] | null> => {
    try {
      const res = await fetch(`${DONKI_BASE}/CME?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawCme[];
      if (!Array.isArray(raw)) return null;
      return raw.map(normalizeCme);
    } catch {
      return null;
    }
  });
}

/** Coronagraph window that brackets the AR 4455 triple-flare storm. */
export const STORM_DONKI_WINDOW = { startDate: '2026-06-02', endDate: '2026-06-05' } as const;

/** Convenience: the storm window, cached. */
export function fetchStormCmes(): Promise<DonkiCme[] | null> {
  return fetchCmeAnalyses(STORM_DONKI_WINDOW.startDate, STORM_DONKI_WINDOW.endDate);
}

// ---------------------------------------------------------------------------
// Shared minimal shape for reward/label event types (ENG-1 extension)
// ---------------------------------------------------------------------------

/**
 * Minimal shared shape required by ENG-2.
 * Every reward-event type satisfies this base; callers can test/filter on `id`.
 */
interface DonkiEventBase {
  /** DONKI activityID: `YYYY-MM-DDTHH:MM:SS-TYPE-###`. */
  id: string;
  /** Primary event time (ISO UTC string). */
  time: string;
  /** Human-readable one-line label (e.g. "X1.2 flare at N18E01"). */
  label: string;
  /** IDs from the `linkedEvents` array — enables FLR→IPS→GST chain reconstruction. */
  linkedEventIds?: string[];
}

// ---------------------------------------------------------------------------
// FLR — Solar Flare
// ---------------------------------------------------------------------------

/**
 * Normalized DONKI solar-flare event.
 * Source: /donki/FLR (proxy path-agnostic, same /donki prefix as CME).
 *
 * REAL (from DONKI/GOES):
 *   classType, beginTime, peakTime, endTime, sourceLocation, activeRegionNum.
 * NOTHING estimated here — all fields map directly to DONKI response fields.
 */
export interface DonkiFlare extends DonkiEventBase {
  /** GOES X-ray classification string, e.g. "X1.0", "M5.3". */
  classType: string | null;
  /** Flare onset (GOES X-ray rises above class threshold). */
  beginTime: string | null;
  /** Peak X-ray flux time. */
  peakTime: string | null;
  /** Flux return to pre-flare baseline. */
  endTime: string | null;
  /** Heliographic coordinates of flare source, e.g. "N18E01". */
  sourceLocation: string | null;
  /** NOAA active region number. null when not associated to a numbered region. */
  activeRegionNum: number | null;
  /** NASA DONKI record URL supplied by the API. */
  link: string | null;
}

interface RawFlr {
  flrID?: string;
  beginTime?: string | null;
  peakTime?: string | null;
  endTime?: string | null;
  classType?: string | null;
  sourceLocation?: string | null;
  activeRegionNum?: number | null;
  linkedEvents?: Array<{ activityID?: string }> | null;
  link?: string;
}

function normalizeFlare(raw: RawFlr): DonkiFlare {
  const id = raw.flrID ?? '';
  const classType = raw.classType ?? null;
  const time = raw.peakTime ?? raw.beginTime ?? '';
  const loc = raw.sourceLocation ?? '';
  const label = classType ? `${classType} flare${loc ? ` at ${loc}` : ''}` : `Flare${loc ? ` at ${loc}` : ''}`;

  return {
    id,
    time,
    label,
    linkedEventIds: (raw.linkedEvents ?? [])
      .map((e) => e.activityID)
      .filter((s): s is string => typeof s === 'string'),
    classType,
    beginTime: raw.beginTime ?? null,
    peakTime: raw.peakTime ?? null,
    endTime: raw.endTime ?? null,
    sourceLocation: loc || null,
    activeRegionNum: raw.activeRegionNum ?? null,
    link: raw.link ?? null,
  };
}

const flareCache: TimedPromiseCache<DonkiFlare[]> = new Map();

/**
 * Fetch + normalize DONKI solar flares for a date range (YYYY-MM-DD).
 * Uses the existing /donki proxy (path-agnostic — /donki/FLR routes correctly).
 * In-flight requests are shared; real responses expire after five minutes.
 * Returns null on any failure.
 */
export function fetchFlares(startDate: string, endDate: string): Promise<DonkiFlare[] | null> {
  const key = `flr|${startDate}|${endDate}`;
  return fetchWithTimedCache(flareCache, key, async (): Promise<DonkiFlare[] | null> => {
    try {
      const res = await fetch(`${DONKI_BASE}/FLR?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawFlr[];
      if (!Array.isArray(raw)) return null;
      return raw.map(normalizeFlare);
    } catch {
      return null;
    }
  });
}

// ---------------------------------------------------------------------------
// IPS — Interplanetary Shock
// ---------------------------------------------------------------------------

/**
 * Normalized DONKI interplanetary-shock event.
 * Source: /donki/IPS (same /donki proxy).
 *
 * REAL (from DONKI/DSCOVR/ACE):
 *   eventTime, location, instruments — all measured by in-situ instruments.
 * NOTHING estimated here.
 */
export interface DonkiIps extends DonkiEventBase {
  /**
   * Detection point: "Earth", "STEREO A", "STEREO B", "MESSENGER", "Mars", etc.
   * "Earth" and "L1" both mean L1 / bow-shock — DONKI uses "Earth".
   */
  location: string | null;
  /** Instrument names that detected the shock, e.g. ["ACE: MAG", "DSCOVR: PLASMAG"]. */
  instruments: string[];
}

interface RawIps {
  activityID?: string;
  location?: string | null;
  eventTime?: string | null;
  instruments?: Array<{ displayName?: string }> | null;
  linkedEvents?: Array<{ activityID?: string }> | null;
  link?: string;
}

function normalizeIps(raw: RawIps): DonkiIps {
  const id = raw.activityID ?? '';
  const location = raw.location ?? null;
  const time = raw.eventTime ?? '';
  const label = `IPS shock at ${location ?? 'unknown'}`;
  const instruments = (raw.instruments ?? [])
    .map((i) => i.displayName ?? '')
    .filter(Boolean);

  return {
    id,
    time,
    label,
    linkedEventIds: (raw.linkedEvents ?? [])
      .map((e) => e.activityID)
      .filter((s): s is string => typeof s === 'string'),
    location,
    instruments,
  };
}

const ipsCache: TimedPromiseCache<DonkiIps[]> = new Map();

/**
 * Fetch + normalize DONKI interplanetary shocks for a date range (YYYY-MM-DD).
 * Uses the existing /donki proxy (path-agnostic — /donki/IPS routes correctly).
 * In-flight requests are shared; real responses expire after five minutes.
 * Returns null on any failure.
 */
export function fetchIps(startDate: string, endDate: string): Promise<DonkiIps[] | null> {
  const key = `ips|${startDate}|${endDate}`;
  return fetchWithTimedCache(ipsCache, key, async (): Promise<DonkiIps[] | null> => {
    try {
      const res = await fetch(`${DONKI_BASE}/IPS?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawIps[];
      if (!Array.isArray(raw)) return null;
      return raw.map(normalizeIps);
    } catch {
      return null;
    }
  });
}

// ---------------------------------------------------------------------------
// GST — Geomagnetic Storm
// ---------------------------------------------------------------------------

/** One 3-hour Kp entry from the allKpIndex array inside a DONKI GST event. */
export interface DonkiGstKpEntry {
  observedTime: string;
  kpIndex: number;
  source: string;
}

/**
 * Normalized DONKI geomagnetic-storm event.
 * Source: /donki/GST (same /donki proxy).
 *
 * REAL (from DONKI / NOAA/GFZ Kp feed):
 *   startTime, allKpIndex array, observedKp — these are observed 3-hr Kp values.
 * NOTHING estimated here.
 */
export interface DonkiGst extends DonkiEventBase {
  /**
   * Maximum observed Kp from the allKpIndex sub-array.
   * Derived by scanning allKpIndex; null if array is empty or missing.
   */
  observedKp: number | null;
  /** Every 3-hr Kp entry in the storm record (for fine-grained replay). */
  allKpIndex: DonkiGstKpEntry[];
}

interface RawGstKpEntry {
  observedTime?: string | null;
  kpIndex?: number | null;
  source?: string | null;
}

interface RawGst {
  gstID?: string;
  startTime?: string | null;
  allKpIndex?: RawGstKpEntry[] | null;
  linkedEvents?: Array<{ activityID?: string }> | null;
  link?: string;
}

function normalizeGst(raw: RawGst): DonkiGst {
  const id = raw.gstID ?? '';
  const time = raw.startTime ?? '';

  const kpEntries: DonkiGstKpEntry[] = (raw.allKpIndex ?? []).flatMap((e) => {
    if (typeof e.kpIndex !== 'number' || typeof e.observedTime !== 'string') return [];
    return [{ observedTime: e.observedTime, kpIndex: e.kpIndex, source: e.source ?? '' }];
  });

  const observedKp = kpEntries.length > 0
    ? Math.max(...kpEntries.map((e) => e.kpIndex))
    : null;

  const label = observedKp != null
    ? `Geomagnetic storm Kp=${observedKp.toFixed(1)}`
    : 'Geomagnetic storm';

  return {
    id,
    time,
    label,
    linkedEventIds: (raw.linkedEvents ?? [])
      .map((e) => e.activityID)
      .filter((s): s is string => typeof s === 'string'),
    observedKp,
    allKpIndex: kpEntries,
  };
}

const gstCache: TimedPromiseCache<DonkiGst[]> = new Map();

/**
 * Fetch + normalize DONKI geomagnetic storms for a date range (YYYY-MM-DD).
 * Uses the existing /donki proxy (path-agnostic — /donki/GST routes correctly).
 * In-flight requests are shared; real responses expire after five minutes.
 * Returns null on any failure.
 */
export function fetchGst(startDate: string, endDate: string): Promise<DonkiGst[] | null> {
  const key = `gst|${startDate}|${endDate}`;
  return fetchWithTimedCache(gstCache, key, async (): Promise<DonkiGst[] | null> => {
    try {
      const res = await fetch(`${DONKI_BASE}/GST?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawGst[];
      if (!Array.isArray(raw)) return null;
      return raw.map(normalizeGst);
    } catch {
      return null;
    }
  });
}
