/**
 * scene/donki-feeds.ts — Live NASA DONKI CME Analysis (real measured kinematics).
 *
 * Goes through the `/donki` Vite proxy, which injects the api_key server-side
 * (see vite.config.ts) — the key never reaches the browser. Every response is
 * cached in-memory keyed by date range so scrubbing the clock or re-rendering
 * never re-hits the API (we get 1000 calls/hour; the storm window is fixed, so
 * one fetch per session covers it). Failures degrade to `null` — nothing here
 * is required to render the scene.
 *
 * PROVENANCE — important, do not blur these adjacent fields:
 *   MEASURED (DONKI coronagraph analysis): speed, apex latitude/longitude,
 *     angular half-width, and the 21.5 R_sun crossing time.
 *   MODELLED (WSA-Enlil): predicted shock arrival/duration, Earth-impact flag,
 *     and predicted Kp.
 *   ESTIMATED (DONKI carries NO mass or density field — confirmed):
 *     mass and ion/proton count are derived from the measured angular width via
 *     a published empirical CME mass–width relation (Vourlidas et al. 2010/2011;
 *     CDAW LASCO catalog). These are order-of-magnitude estimates, labelled as
 *     such everywhere they surface.
 */

const DONKI_BASE = '/donki';

/** Proton rest mass (kg). */
const PROTON_MASS_KG = 1.6726219e-27;

/** Normalised DONKI CME with the most-accurate analysis flattened out. */
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
  // --- WSA-Enlil prediction (first run) ---
  enlilShockIso: string | null;
  enlilDurationH: number | null;
  /** Whether the analysis carries a WSA-Enlil model run at all. */
  hasEnlilRun: boolean;
  isEarthDirected: boolean;
  predictedKp: number | null;
  /** Exact DONKI graph edges (CME↔FLR↔IPS↔GST) used for outcome matching. */
  linkedEventIds: string[];
  // --- DERIVED, not from DONKI (see file header) ---
  estMass_kg: number;
  estIons: number;
  link: string;
}

interface RawEnlil {
  estimatedShockArrivalTime?: string | null;
  estimatedDuration?: number | null;
  isEarthGB?: boolean | null;
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

/** Pick the analysis DONKI flagged most-accurate (fallback: last submitted). */
function bestAnalysis(analyses: RawAnalysis[] | null | undefined): RawAnalysis | null {
  if (!analyses || analyses.length === 0) return null;
  return analyses.find((a) => a.isMostAccurate) ?? analyses[analyses.length - 1] ?? null;
}

function maxKp(enlil: RawEnlil | undefined): number | null {
  if (!enlil) return null;
  const values = [enlil.kp_18, enlil.kp_90, enlil.kp_135, enlil.kp_180].filter(
    (v): v is number => typeof v === 'number',
  );
  return values.length ? Math.max(...values) : null;
}

function normalizeCme(raw: RawCme): DonkiCme {
  const analysis = bestAnalysis(raw.cmeAnalyses);
  const enlil = analysis?.enlilList?.[0];
  const halfAngle = analysis?.halfAngle ?? null;
  const noteText = `${raw.note ?? ''} ${analysis?.note ?? ''}`.toLowerCase();
  const isHalo = noteText.includes('halo') || (halfAngle != null && halfAngle >= 45);
  const estMass = estimateCmeMassKg(halfAngle, isHalo);

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
    hasEnlilRun: enlil != null,
    isEarthDirected: Boolean(enlil?.isEarthGB),
    predictedKp: maxKp(enlil),
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

const cache = new Map<string, Promise<DonkiCme[] | null>>();

/**
 * Fetch + normalise DONKI CME Analysis for a date range (YYYY-MM-DD). Cached
 * per range for the session. Returns `null` on any failure (offline, proxy
 * missing in prod, non-2xx, malformed). Callers surface an unavailable state;
 * no fixture or baked event is substituted into live mode.
 *
 * Intentionally takes NO AbortSignal: this is a shared, cached resource, so the
 * network request must not be tied to any one consumer's lifecycle (a React
 * StrictMode double-mount would otherwise abort the in-flight request and pin a
 * null in the cache). Consumers guard their own setState instead.
 */
export function fetchCmeAnalyses(startDate: string, endDate: string): Promise<DonkiCme[] | null> {
  const key = `${startDate}|${endDate}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<DonkiCme[] | null> => {
    try {
      const res = await fetch(`${DONKI_BASE}/CME?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawCme[];
      if (!Array.isArray(raw)) return null;
      return raw.map(normalizeCme);
    } catch {
      return null;
    }
  })();

  // Drop the cache entry if it resolved to null (transient failure) so a later
  // call can retry; keep it once we have a real list.
  void promise.then((list) => {
    if (!list) cache.delete(key);
  });
  cache.set(key, promise);
  return promise;
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
  };
}

const flareCache = new Map<string, Promise<DonkiFlare[] | null>>();

/**
 * Fetch + normalize DONKI solar flares for a date range (YYYY-MM-DD).
 * Uses the existing /donki proxy (path-agnostic — /donki/FLR routes correctly).
 * Cached in-memory per range. null on any failure.
 */
export function fetchFlares(startDate: string, endDate: string): Promise<DonkiFlare[] | null> {
  const key = `flr|${startDate}|${endDate}`;
  const cached = flareCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<DonkiFlare[] | null> => {
    try {
      const res = await fetch(`${DONKI_BASE}/FLR?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawFlr[];
      if (!Array.isArray(raw)) return null;
      return raw.map(normalizeFlare);
    } catch {
      return null;
    }
  })();

  void promise.then((list) => { if (!list) flareCache.delete(key); });
  flareCache.set(key, promise);
  return promise;
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

const ipsCache = new Map<string, Promise<DonkiIps[] | null>>();

/**
 * Fetch + normalize DONKI interplanetary shocks for a date range (YYYY-MM-DD).
 * Uses the existing /donki proxy (path-agnostic — /donki/IPS routes correctly).
 * Cached in-memory per range. null on any failure.
 */
export function fetchIps(startDate: string, endDate: string): Promise<DonkiIps[] | null> {
  const key = `ips|${startDate}|${endDate}`;
  const cached = ipsCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<DonkiIps[] | null> => {
    try {
      const res = await fetch(`${DONKI_BASE}/IPS?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawIps[];
      if (!Array.isArray(raw)) return null;
      return raw.map(normalizeIps);
    } catch {
      return null;
    }
  })();

  void promise.then((list) => { if (!list) ipsCache.delete(key); });
  ipsCache.set(key, promise);
  return promise;
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

const gstCache = new Map<string, Promise<DonkiGst[] | null>>();

/**
 * Fetch + normalize DONKI geomagnetic storms for a date range (YYYY-MM-DD).
 * Uses the existing /donki proxy (path-agnostic — /donki/GST routes correctly).
 * Cached in-memory per range. null on any failure.
 */
export function fetchGst(startDate: string, endDate: string): Promise<DonkiGst[] | null> {
  const key = `gst|${startDate}|${endDate}`;
  const cached = gstCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<DonkiGst[] | null> => {
    try {
      const res = await fetch(`${DONKI_BASE}/GST?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawGst[];
      if (!Array.isArray(raw)) return null;
      return raw.map(normalizeGst);
    } catch {
      return null;
    }
  })();

  void promise.then((list) => { if (!list) gstCache.delete(key); });
  gstCache.set(key, promise);
  return promise;
}
