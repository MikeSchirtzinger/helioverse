/**
 * scene/live-cmes.ts — Adapt LIVE NASA DONKI CME Analysis into renderable,
 * DBM-propagated scene CMEs. It makes the 3D scene show
 * the REAL coronal mass ejections currently in flight (now−7d), not the curated
 * June-2026 replay.
 *
 * PROVENANCE (do not blur — see donki-feeds.ts):
 *   MEASURED (DONKI coronagraph reconstruction): speed, apex direction,
 *     angular half-width, and 21.5 R_sun time.
 *   MODELLED (WSA-Enlil): Earth shock-arrival time, impact qualification, and
 *     predicted Kp scenarios.
 *   ESTIMATED (DONKI carries NO mass): mass / ion count, derived from the
 *     measured angular width — order-of-magnitude only, labelled everywhere.
 *
 * Every front then propagates on the SAME data-anchored Drag-Based Model the
 * replay uses (`cme-propagation.ts`): measured launch speed near the Sun, then
 * solar-wind drag fitted so the apex lands on the modelled arrival when present.
 * Earth relevance is settled two honest ways: a WSA-Enlil Earth shock ETA
 * (with glancing/minor qualifiers kept separate), and an independent geometric
 * cone test from the verified physics core (`coneContainsEarth`).
 */

import type { CanvasCme } from './canvas-contract';
import type { CmeEventData } from './types';
import type { TimeBarMilestone } from './CanvasTimeBar';
import { AU_KM, SUN_RADIUS_KM } from './constants';
import type { DonkiCme } from './donki-feeds';
import { cmeSpeedColorHex } from './cme-style';
import { cmeFrontRadiusKm, hasErupted } from './cme-propagation';
import { coneContainsEarth, physicsReady } from '@/core/physics';

/** Earth sits on the Sun–Earth line (Stonyhurst lon 0) at ~0° heliographic latitude. */
const EARTH_HELIO_LON_DEG = 0;
const EARTH_HELIO_LAT_DEG = 0;

/** Cap the number of fronts drawn at once so a busy week stays legible. */
const MAX_RENDERED = 4;
const DISPLAY_DOMAIN_AU = 1.2;

const HOUR_S = 3600;

const isoOf = (unix: number): string => new Date(unix * 1000).toISOString().replace('.000Z', 'Z');

/** A live CME promoted to a renderable scene front, with provenance metadata. */
export interface LiveCmeView {
  /** What the canvas renders + propagates. */
  canvas: CanvasCme;
  /** The raw DONKI record (for the detail panel). */
  donki: DonkiCme;
  /** Whether WSA-Enlil supplies an Earth shock-arrival time. */
  earthDirected: boolean;
  /** Independent geometric test: does the measured cone contain Earth? */
  coneHitsEarth: boolean;
  /** Enlil predicted shock arrival (ISO), or null. */
  arrivalIso: string | null;
  /** Enlil max predicted Kp, or null. */
  predictedKp: number | null;
  /** Ordering / primary-pick weight (higher = more Earth-relevant). */
  salience: number;
}

/** Everything the console shell needs to drive the scene + scrubber in live mode. */
export interface LiveScene {
  /** Every DONKI CME with enough measured kinematics for a 3D/modelled front. */
  views: LiveCmeView[];
  /** Salience-capped subset drawn concurrently so the 3D field stays legible. */
  renderedViews: LiveCmeView[];
  /** Convenience: `renderedViews.map(v => v.canvas)`. */
  cmes: CanvasCme[];
  /** The CME that drives the camera-follow target, or null. */
  primaryId: string | null;
  /** The primary CME's kinematics (camera follow and event timing). */
  primaryEvent: CmeEventData | null;
  /** Ledger event used to keep the timeline mounted when no front is in view. */
  timelineAnchorId: string;
  /** The timeline anchor's kinematics; independent of the rendered-front cap. */
  timelineAnchorEvent: CmeEventData;
  /** Every observed DONKI CME in the window, including incomplete analyses. */
  totalDetected: number;
  /** CMEs actually drawn (after the cap). */
  shown: number;
  windowStartIso: string;
  windowEndIso: string;
  /** Default master-clock position = wall-clock "now". */
  defaultClockIso: string;
  nowIso: string;
  milestones: TimeBarMilestone[];
}

/**
 * Geometric Earth-hit test using the verified physics core. Falls back to
 * `false` only if the core somehow isn't ready (the app awaits it before the
 * first render, so in practice it always is) — never a second TS reimplementation.
 */
function coneHitsEarth(apexLonDeg: number, apexLatDeg: number, halfAngleDeg: number): boolean {
  if (!physicsReady()) return false;
  return coneContainsEarth(
    apexLonDeg,
    apexLatDeg,
    halfAngleDeg,
    EARTH_HELIO_LON_DEG,
    EARTH_HELIO_LAT_DEG,
    0,
  );
}

/** Build model anchors from the Enlil shock ETA + duration, or null. */
function arrivalWindow(cme: DonkiCme): { start: number; eta: number; end: number } | null {
  if (!cme.enlilShockIso) return null;
  const eta = Math.floor(Date.parse(cme.enlilShockIso) / 1000);
  if (!Number.isFinite(eta)) return null;
  const durS = cme.enlilDurationH != null && cme.enlilDurationH > 0
    ? cme.enlilDurationH * HOUR_S
    : 0;
  return { start: eta, eta, end: eta + durS };
}

/** Earth-relevance score 0..1 from the modelled Enlil flag + geometry + predicted Kp. */
function earthBoundScore(earthDirected: boolean, coneHits: boolean, predictedKp: number | null): number {
  let s = earthDirected ? 0.75 : coneHits ? 0.45 : 0.12;
  if (predictedKp != null) s += Math.min(0.2, (predictedKp / 9) * 0.2);
  return Math.max(0, Math.min(1, s));
}

/** Short label that rides the travelling front. */
function cmeLabel(speed: number, earthDirected: boolean): string {
  return `${Math.round(speed)} km/s${earthDirected ? ' →Earth' : ''}`;
}

/**
 * Fields required before an observed DONKI record may become a 3D/modelled
 * front. The observation itself remains valid and belongs in the live ledger
 * even when one of these reconstruction fields is unavailable.
 */
export function cmeKinematicsIssues(cme: DonkiCme): string[] {
  const issues: string[] = [];
  if (!Number.isFinite(cme.startUnix)) issues.push('launch time');
  if (cme.speed_kms == null || cme.speed_kms <= 0) issues.push('speed');
  if (cme.halfAngle_deg == null || cme.halfAngle_deg <= 0) issues.push('angular width');
  if (cme.apexLon_deg == null) issues.push('apex longitude');
  if (cme.apexLat_deg == null) issues.push('apex latitude');
  return issues;
}

/** Label sourced only from fields present in the DONKI observation/model run. */
export function liveCmeObservationLabel(cme: DonkiCme): string {
  const speed = cme.speed_kms != null && cme.speed_kms > 0
    ? `${Math.round(cme.speed_kms)} km/s`
    : 'CME observed';
  return `${speed}${cme.isEarthDirected ? ' →Earth' : ''}`;
}

/**
 * Convert one DONKI CME into a renderable view, or null when it lacks the
 * kinematics needed to place + propagate a front (no speed, or no direction).
 */
export function donkiCmeToView(cme: DonkiCme): LiveCmeView | null {
  if (cmeKinematicsIssues(cme).length > 0) return null;

  // Narrowed by cmeKinematicsIssues above.
  if (cme.speed_kms == null || cme.halfAngle_deg == null || cme.apexLon_deg == null || cme.apexLat_deg == null) {
    return null;
  }

  const halfAngle = cme.halfAngle_deg;
  const coneHits = coneHitsEarth(cme.apexLon_deg, cme.apexLat_deg, halfAngle);
  const earthDirected = cme.isEarthDirected;

  const event: CmeEventData = {
    id: cme.activityID,
    sourcePosition: { lon_deg: cme.apexLon_deg, lat_deg: cme.apexLat_deg, r_km: SUN_RADIUS_KM * 1.02 },
    speed_kms: cme.speed_kms,
    halfAngle_deg: halfAngle,
    isHalo: cme.isHalo,
    earthBoundScore: earthBoundScore(earthDirected, coneHits, cme.predictedKp),
    // Estimated mass from DONKI's angular width (DONKI has no mass) — drives the
    // CME's baseline render size so a heavy event looks big at launch.
    mass_kg: cme.estMass_kg,
    liftoff_unix: cme.startUnix,
    time21_5_unix: cme.time21_5 ? Math.floor(Date.parse(cme.time21_5) / 1000) : null,
    frontPosition: null,
    arrivalWindow: arrivalWindow(cme),
    // PROVENANCE: WSA-Enlil predicted Kp (modelled); null when no run exists.
    predictedKp: cme.predictedKp,
  };

  const canvas: CanvasCme = {
    event,
    label: cmeLabel(cme.speed_kms, earthDirected),
    color: cmeSpeedColorHex(cme.speed_kms),
  };

  // Salience: Enlil-Earth-directed dominates, then cone hits, then speed,
  // predicted Kp, and recency (newer events float up under the cap).
  const salience =
    (earthDirected ? 1000 : coneHits ? 400 : 0) +
    cme.speed_kms * 0.3 +
    (cme.predictedKp ?? 0) * 60 +
    cme.startUnix / 1e7;

  return {
    canvas,
    donki: cme,
    earthDirected,
    coneHitsEarth: coneHits,
    arrivalIso: cme.enlilShockIso,
    predictedKp: cme.predictedKp,
    salience,
  };
}

/** Pick the camera-follow CME: soonest future Earth arrival, else most salient. */
function pickPrimary(views: LiveCmeView[], nowUnix: number): LiveCmeView | null {
  if (views.length === 0) return null;
  const futureArrivals = views
    .filter((v) => v.earthDirected && v.canvas.event.arrivalWindow && v.canvas.event.arrivalWindow.eta >= nowUnix)
    .sort((a, b) => a.canvas.event.arrivalWindow!.eta - b.canvas.event.arrivalWindow!.eta);
  if (futureArrivals[0]) return futureArrivals[0];
  return [...views].sort((a, b) => b.salience - a.salience)[0] ?? null;
}

/**
 * Build the live observation ledger independently of 3D renderability.
 *
 * PROVENANCE: launch rows come directly from NASA DONKI CME records. Earth
 * arrival rows come directly from the record's WSA-Enlil model output. Missing
 * geometry is stated explicitly; it is never replaced with invented values.
 */
export function buildLiveCmeMilestones(observations: readonly DonkiCme[]): TimeBarMilestone[] {
  const out: TimeBarMilestone[] = [];
  for (const cme of observations) {
    const launchMs = Date.parse(cme.startTime);
    if (!Number.isFinite(launchMs)) continue;
    const issues = cmeKinematicsIssues(cme);
    const speed = cme.speed_kms != null && cme.speed_kms > 0
      ? `${Math.round(cme.speed_kms)} km/s CME`
      : 'CME observed';
    const modelSummary = !cme.hasEnlilRun
      ? 'No WSA-Enlil run is available.'
      : cme.isEarthDirected
        ? 'WSA-Enlil supplies an Earth shock forecast.'
        : 'WSA-Enlil supplies no Earth shock ETA.';
    out.push({
      id: `${cme.activityID}-cme`,
      eventId: cme.activityID,
      label: liveCmeObservationLabel(cme),
      timeIso: new Date(launchMs).toISOString().replace('.000Z', 'Z'),
      kind: 'cme',
      detail: `${speed}${cme.activeRegion ? ` from AR ${cme.activeRegion}` : ''}. ${modelSummary}${issues.length ? ` 3D front withheld: DONKI has not supplied ${issues.join(', ')}.` : ''}`,
    });

    if (cme.enlilShockIso && Number.isFinite(Date.parse(cme.enlilShockIso))) {
      const kpRange = cme.predictedKpRange;
      const possibleKp = kpRange
        ? ` · possible Kp ${kpRange.min === kpRange.max ? kpRange.max : `${kpRange.min}–${kpRange.max}`} across model scenarios`
        : '';
      out.push({
        id: `${cme.activityID}-eta`,
        eventId: cme.activityID,
        label: cme.earthImpactClassification === 'glancing'
          ? 'Glancing Earth ETA'
          : cme.earthImpactClassification === 'minor'
            ? 'Minor-impact ETA'
            : 'Earth ETA',
        timeIso: cme.enlilShockIso,
        kind: 'predicted',
        detail: `WSA-Enlil modelled shock arrival${possibleKp}.`,
      });
    }
  }
  return out.sort((a, b) => Date.parse(a.timeIso) - Date.parse(b.timeIso));
}

/**
 * Build the full live scene from a DONKI CME list and the current wall-clock.
 * Returns null when nothing in the window can be rendered (quiet Sun / fetch
 * failure). Callers keep the live scene empty; replay is always explicit.
 *
 * @param list           Normalised DONKI CMEs for the window.
 * @param nowUnix        Wall-clock "now" (unix s) — the default clock position.
 * @param windowStartUnix Earliest time the query covers (unix s) — clamps the scrubber.
 */
export function buildLiveScene(list: DonkiCme[], nowUnix: number, windowStartUnix: number): LiveScene | null {
  const all = list
    .map(donkiCmeToView)
    .filter((v): v is LiveCmeView => v !== null);
  if (all.length === 0) return null;

  const views = [...all].sort((a, b) => b.salience - a.salience);
  const totalDetected = list.length;
  // The observation ledger retains every DONKI record. The 3D layer is an
  // Earth-weather operational view, so it draws only sufficiently reconstructed
  // fronts physically in flight between launch and 1.2 AU at wall-clock now.
  // Departed events do not linger as a decorative ring around the system edge.
  const renderedViews = views
    .filter((view) => hasErupted(view.canvas.event, nowUnix))
    .filter((view) => cmeFrontRadiusKm(view.canvas.event, nowUnix) / AU_KM <= DISPLAY_DOMAIN_AU)
    .slice(0, MAX_RENDERED);

  const liftoffs = list
    .map((cme) => cme.startUnix)
    .filter((time): time is number => Number.isFinite(time));
  const etas = list
    .map((cme) => cme.enlilShockIso == null ? Number.NaN : Date.parse(cme.enlilShockIso) / 1000)
    .filter((time): time is number => Number.isFinite(time));

  const earliestLiftoff = Math.min(...liftoffs);
  const latestEta = etas.length ? Math.max(...etas) : Math.max(...liftoffs) + 3 * 86400;
  const windowStart = Math.min(earliestLiftoff - 6 * HOUR_S, windowStartUnix);
  const windowEnd = Math.max(latestEta + 12 * HOUR_S, nowUnix + 12 * HOUR_S);

  const primary = pickPrimary(renderedViews, nowUnix);
  // `primary` remains a camera target and therefore only comes from fronts in
  // the display domain. The timeline is a full-window ledger, so give it an
  // independent real-event anchor even when every front has already departed.
  const timelineAnchor = pickPrimary(views, nowUnix);
  if (!timelineAnchor) return null;

  return {
    views,
    renderedViews,
    cmes: renderedViews.map((v) => v.canvas),
    primaryId: primary?.canvas.event.id ?? null,
    primaryEvent: primary?.canvas.event ?? null,
    timelineAnchorId: timelineAnchor.canvas.event.id,
    timelineAnchorEvent: timelineAnchor.canvas.event,
    totalDetected,
    shown: renderedViews.length,
    windowStartIso: isoOf(windowStart),
    windowEndIso: isoOf(windowEnd),
    defaultClockIso: isoOf(nowUnix),
    nowIso: isoOf(nowUnix),
    // The monitor timeline is an observation ledger, not just a legend for the
    // fronts that have enough kinematics to draw.
    milestones: buildLiveCmeMilestones(list),
  };
}

/** Kinetic energy (J) from estimated mass (kg) and measured speed (km/s). */
export function liveCmeKineticEnergyJ(massKg: number, speedKms: number): number {
  const v = speedKms * 1000;
  return 0.5 * massKg * v * v;
}
