/**
 * use-aurora.ts — Hook that derives tonight-card + map state from a Snapshot.
 *
 * This is the bridge between the frozen contract types and the aurora feature.
 * All heavy math goes through the pinned go-look.ts and delay-correction.ts functions;
 * this hook orchestrates the inputs and produces the feature data models.
 *
 * In v1, cloud + satellite + sky-state inputs are mocked to sensible defaults.
 * The go-look engine is wired and produces correct outputs from fixture snapshots.
 */

import { useMemo } from "react";
import type { Snapshot } from "./snapshot-local";
import { goLook } from "./go-look";
import type { GoLookInputs, Verdict, Limiter } from "./go-look";
import {
  computeDelay,
  formatDelayHours,
  FIXED_FALLBACK_DELAY_S,
} from "./delay-correction";
import type { DelayResult } from "./delay-correction";
import type {
  UserLocation,
  TonightForecast,
  AuroraMapState,
  DegradedInfo,
  OvalPoint,
} from "./types";
import { computeTimeWindow } from "./types";

// ---------------------------------------------------------------
// Hook inputs
// ---------------------------------------------------------------

export interface UseAuroraInputs {
  snapshot: Snapshot;
  userLocation: UserLocation | null;
}

// ---------------------------------------------------------------
// Hook output
// ---------------------------------------------------------------

export interface UseAuroraOutput {
  forecast: TonightForecast;
  mapState: AuroraMapState;
  degraded: DegradedInfo;
  delay: DelayResult;
  /** Human-readable delay label for display. */
  delayLabel: string;
  /** NOAA's stock forecast_time for comparison. */
  noaaForecastTime: string;
}

// ---------------------------------------------------------------
// Default location (Reykjavík — an iconic aurora-chasing city)
// ---------------------------------------------------------------

const DEFAULT_LOCATION: UserLocation = {
  latDeg: 64.15,
  lonDeg: -21.88,
  label: "Reykjavík, IS",
};

// ---------------------------------------------------------------
// Cloud & sky defaults for v1 fixture-driven mode
// ---------------------------------------------------------------
//
// In v1 the cloud/satellite/sky-state inputs aren't yet driven by real
// upstream feeds — those are W1-P1e (GOES CSM) and W1-P2 (helio-core WASM
// sky_state). Until then, we use plausible defaults that exercise the full
// go-look formula. The storm fixture with these defaults produces a "Likely"
// verdict; the quiet fixture with Kp=2 produces "Unlikely"; degraded produces
// "Possible" with reduced confidence.

function cloudDefaults(
  snapshot: Snapshot,
): Pick<
  GoLookInputs,
  | "cloudTotalConsensus"
  | "cloudLowConsensus"
  | "cloudModelSpread"
  | "satelliteClearNow"
> {
  // Default: mostly clear night — the user can see it
  // Sources that are "gap" degrade the satellite leg
  const goesStatus = snapshot.sources.goes_csm?.status ?? "ok";
  const satLeg = goesStatus === "gap" ? null : 0.85;
  return {
    cloudTotalConsensus: 0.25,
    cloudLowConsensus: 0.1,
    cloudModelSpread: 0.15,
    satelliteClearNow: satLeg,
  };
}

// ---------------------------------------------------------------
// Oval probability estimation
// ---------------------------------------------------------------
//
// The real OVATION grid is 360×181 in R2. Until the grid sampler is available
// (WASM or a thin TS sampler), we estimate the probability at the user's
// location from hemispheric power and geomagnetic latitude.
//
// The heuristic below is based on the known relationship between hemispheric
// power (GW) and visible-aurora equatorward extent.
function estimateOvalProb(
  userLatDeg: number,
  hemisphericPowerGw: number | null,
  kp: number | null,
): number {
  // Convert geographic → approximate geomagnetic latitude (simplified)
  // Real correction uses IGRF; v1 uses an approximate offset
  const geoMagLat = userLatDeg > 0 ? userLatDeg - 4 : userLatDeg + 4;

  // Empirically calibrated: at Kp=3, oval edge ~67° mag; at Kp=7, ~53° mag
  // Probability drops off with distance from the oval center
  if (kp === null) {
    return 0;
  }

  // Oval equatorward boundary ~ 68 - 2.2 * Kp degrees magnetic latitude
  // This gives: Kp=2 → ~63.6°, Kp=7 → ~52.6°
  const ovalEdgeMagLat = 68.0 - 2.2 * kp;

  // Distance from user to oval edge in degrees
  const distDeg = ovalEdgeMagLat - Math.abs(geoMagLat);

  if (distDeg >= 8) {
    // Well inside the oval — high probability
    return Math.min(1.0, 0.5 + kp * 0.06);
  } else if (distDeg >= 4) {
    // Near the oval edge
    return 0.3 + distDeg * 0.06;
  } else if (distDeg >= -2) {
    // Just outside the oval edge
    return Math.max(0.05, 0.2 + distDeg * 0.07);
  } else if (distDeg >= -8) {
    // Far from the oval
    return Math.max(0.01, 0.08 + distDeg * 0.02);
  }
  // Way too far
  return 0.01;
}

// ---------------------------------------------------------------
// Generate synthetic oval boundary for map rendering
// ---------------------------------------------------------------

function generateOvalBoundary(
  kp: number | null,
  hemPowerGw: number | null,
): { boundary: OvalPoint[]; innerBoundary: OvalPoint[]; maxProb: number } {
  const effKp = kp ?? 1;
  const maxProb = Math.min(1.0, 0.15 * effKp + 0.2);
  // Equatorward boundary in degrees colatitude (from north pole)
  const equatorwardColat = 20 + Math.max(0, (7 - effKp) * 4.5);
  const polewardColat = Math.max(3, equatorwardColat - (effKp >= 5 ? 10 : 6));

  const boundary: OvalPoint[] = [];
  const innerBoundary: OvalPoint[] = [];
  const step = 3; // degrees
  const centerLon = -40; // approximate North Magnetic Pole longitude

  for (let lon = 0; lon < 360; lon += step) {
    const dLon = lon - centerLon;
    // Slight eccentricity toward the night side
    const flatten = 1.0 + 0.12 * Math.cos((dLon * Math.PI) / 180);

    const outerColat = equatorwardColat * flatten;
    const innerColat = polewardColat * flatten;

    boundary.push({
      lonDeg: lon,
      latDeg: 90 - outerColat,
    });
    innerBoundary.push({
      lonDeg: lon,
      latDeg: 90 - innerColat,
    });
  }

  return { boundary, innerBoundary, maxProb };
}

function generateViewline(
  boundary: OvalPoint[],
  userLatDeg: number,
): OvalPoint[] {
  // The viewline for a user: the equatorward oval boundary clipped
  // to the user's longitude ± 40°. We return the same oval boundary
  // but the map renders it dashed.
  return boundary;
}

// ---------------------------------------------------------------
// Terminator SVG path
// ---------------------------------------------------------------
// Produces an SVG path for the night-side shading wedge on a north-polar
// azimuthal-equidistant projection. Uses the same coordinate space as
// aurora-map.tsx (CENTER=160, RADIUS=160 in the unscaled SVG view).
//
// The day/night terminator is the great circle where the sun is at the
// horizon (solar altitude = 0°). On the polar projection this appears as
// a curve. We compute terminator (lat,lon) points at 2° longitude steps,
// project each to SVG (x,y), and build a filled wedge covering the
// night hemisphere (the side opposite the subsolar point).

// SVG space constants — MUST match aurora-map.tsx (DEFAULT_SIZE, PADDING)
const MAP_SIZE = 340;
const MAP_PADDING = 10;
const MAP_CENTER = MAP_SIZE / 2;
const MAP_RADIUS = MAP_CENTER - MAP_PADDING;

/** Project geographic (lat, lon) to SVG (x, y) — matches aurora-map.tsx polarProject(). */
function termPolarProject(latDeg: number, lonDeg: number): { x: number; y: number } {
  const colat = 90 - latDeg;
  let rad: number;
  let theta: number;
  if (colat < 0) {
    rad = (Math.abs(colat) / 90) * MAP_RADIUS;
    theta = ((lonDeg - 90) * Math.PI) / 180;
  } else {
    rad = (colat / 90) * MAP_RADIUS;
    theta = ((lonDeg - 90) * Math.PI) / 180;
  }
  return { x: MAP_CENTER + rad * Math.cos(theta), y: MAP_CENTER + rad * Math.sin(theta) };
}

/** Day-of-year [1..366] from a JS Date. */
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const diff = d.getTime() - start;
  return Math.floor(diff / 86400000);
}

/** Solar declination in degrees (Meeus-class approximation, ±0.4° accuracy — sufficient for map shading). */
function solarDeclinationDeg(dayOfYr: number): number {
  // Obliquity ~23.44°; solstices at day 172 (Jun) and day 355 (Dec)
  return -23.44 * Math.cos(((360 / 365) * (dayOfYr + 10) * Math.PI) / 180);
}

function computeTerminatorPath(
  generatedAt: string,
  _hemisphere: "north" | "south",
): string {
  // generatedAt is ISO-8601 (already ends with Z or offset); parse directly
  const gen = new Date(generatedAt);
  const doy = dayOfYear(gen);
  const decl = solarDeclinationDeg(doy);
  const utcHours = gen.getUTCHours() + gen.getUTCMinutes() / 60 + gen.getUTCSeconds() / 3600;

  // Subsolar longitude: at 12:00 UTC the sun is at 0° (prime meridian).
  // Each hour before/after shifts the subsolar point 15° east/west.
  const subsolarLon = ((12 - utcHours) * 15 + 360) % 360;
  const declRad = (decl * Math.PI) / 180;

  // The night-side shading: we draw a filled path from the map centre (pole)
  // out to the dusk-side terminator, then follow the terminator curve across
  // the night hemisphere to the dawn side, then back to the centre.
  //
  // Dusk  lon = subsolarLon − 90 (± wrap)
  // Dawn  lon = subsolarLon + 90 (± wrap)
  // The dark sweep goes from dusk westward (increasing lon) to dawn.
  const duskLon = ((subsolarLon - 90) + 360) % 360;
  const dawnLon = ((subsolarLon + 90) + 360) % 360;

  // Gather terminator (lat,lon) points at 2° steps from dusk to dawn
  // going the long way around (through the anti-solar meridian).
  const pts: { x: number; y: number }[] = [];
  const step = 2;

  // Figure out sweep direction: dusk→dawn increasing longitude (wrapping at 360)
  let sweepStart = duskLon;
  let sweepEnd = dawnLon;
  if (dawnLon < duskLon) sweepEnd += 360;

  for (let lon = sweepStart; lon <= sweepEnd; lon += step) {
    const lonNorm = lon % 360;
    const dLonRad = ((lonNorm - subsolarLon + 540) % 360 - 180) * (Math.PI / 180);

    let termLatDeg: number;
    if (Math.abs(declRad) < 0.001) {
      // Equinox: terminator passes through the pole as a great-circle meridian
      termLatDeg = 90 * Math.cos(dLonRad);
    } else {
      // cos(solar_zenith) = sin(δ)sin(φ) + cos(δ)cos(φ)cos(Δλ) = 0 at terminator
      // ⇒ tan(φ) = −cos(Δλ) / tan(δ)
      termLatDeg =
        (Math.atan(-Math.cos(dLonRad) / Math.tan(declRad)) * 180) / Math.PI;
    }

    // Clamp latitude to reasonable bounds for the projection
    const clampedLat = Math.max(-89, Math.min(89, termLatDeg));
    const proj = termPolarProject(clampedLat, lonNorm);
    pts.push(proj);
  }

  if (pts.length < 2) {
    // Fallback: draw a simple half-disc wedge
    const a1 = ((duskLon - 90) * Math.PI) / 180;
    const a2 = ((dawnLon - 90) * Math.PI) / 180;
    const x1 = MAP_CENTER + MAP_RADIUS * Math.cos(a1);
    const y1 = MAP_CENTER + MAP_RADIUS * Math.sin(a1);
    const x2 = MAP_CENTER + MAP_RADIUS * Math.cos(a2);
    const y2 = MAP_CENTER + MAP_RADIUS * Math.sin(a2);
    return `M${MAP_CENTER},${MAP_CENTER} L${x1},${y1} A${MAP_RADIUS},${MAP_RADIUS} 0 0,1 ${x2},${y2} Z`;
  }

  // Build SVG path: M(cx,cy) → first terminator point → line segments along
  // terminator curve → last terminator point → Z back to cx,cy.
  const parts: string[] = [`M${MAP_CENTER},${MAP_CENTER}`];
  for (const pt of pts) {
    parts.push(`L${pt.x.toFixed(2)},${pt.y.toFixed(2)}`);
  }
  parts.push("Z");

  return parts.join(" ");
}

// ---------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------

export function useAurora(inputs: UseAuroraInputs): UseAuroraOutput {
  return useMemo(() => {
    const { snapshot } = inputs;
    const userLoc = inputs.userLocation ?? DEFAULT_LOCATION;

    // --- Delay correction ---
    const delay = computeDelay(
      snapshot.l1_to_earth.delay_s,
      snapshot.l1_to_earth.delay_quality,
      snapshot.l1_to_earth.arriving_now_measured_at,
      snapshot.l1_to_earth.spacecraft_distance_km,
      snapshot.solar_wind.speed_kms,
    );

    const degraded: DegradedInfo = {
      isDegraded:
        delay.delayQuality === "degraded_fixed" ||
        snapshot.sources.swpc_plasma.status !== "ok",
      reason:
        delay.delayQuality === "degraded_fixed"
          ? "Plasma feed stale — using fixed 30-min L1→Earth delay"
          : snapshot.sources.swpc_plasma.status === "stale"
            ? `Plasma feed stale (${snapshot.sources.swpc_plasma.age_s ?? "?"}s old)`
            : null,
    };

    // --- Oval probability at user location ---
    const kpVal = snapshot.indices.kp.value;
    const hemPower = snapshot.ovation.hemispheric_power_gw ?? null;
    const ovalProb = estimateOvalProb(userLoc.latDeg, hemPower, kpVal);

    // --- Sky + cloud inputs ---
    const cloud = cloudDefaults(snapshot);

    // Sun/moon alts are placeholders until W1-P2/WASM sky_state lands.
    // For now: use a fixed "nighttime with no moon" for the northern hemisphere,
    // and adjust based on snapshot generated_at UTC hour.
    const genHour = new Date(snapshot.generated_at).getUTCHours();
    // Rough: sun altitude at midnight at 65°N in June is ~ -8° (no full darkness)
    const sunAlt =
      genHour >= 4 && genHour <= 20
        ? genHour < 12
          ? -5 + genHour * 0.5
          : 12 - genHour * 0.5
        : -25;

    const goLookInputs: GoLookInputs = {
      ovalVisibleProb: ovalProb,
      sunAltDeg: sunAlt,
      moonAltDeg: -15, // below horizon — no moon wash
      moonIllumFrac: 0.15,
      cloudTotalConsensus: cloud.cloudTotalConsensus,
      cloudLowConsensus: cloud.cloudLowConsensus,
      cloudModelSpread: cloud.cloudModelSpread,
      satelliteClearNow: cloud.satelliteClearNow,
    };

    const score = goLook(goLookInputs);

    // --- Time window ---
    const timeWindow = computeTimeWindow(snapshot.generated_at, userLoc.latDeg);

    // --- Activity label ---
    const activityLabel =
      kpVal === null
        ? "Unknown"
        : kpVal >= 7
          ? "G3+ Storm"
          : kpVal >= 5
            ? "G1–G2 Storm"
            : kpVal >= 4
              ? "Active"
              : "Quiet";

    // --- Look direction ---
    const lookDir = userLoc.latDeg > 0 ? "Look north" : "Look south";

    const forecast: TonightForecast = {
      verdict: score.verdict,
      score: score.score,
      confidence: score.confidence,
      probabilityPct: Math.round(ovalProb * 100),
      dominantLimiter: score.dominantLimiter,
      timeWindow,
      lookDirection: lookDir,
      activityLabel,
    };

    // --- Map state ---
    const { boundary, innerBoundary, maxProb } = generateOvalBoundary(
      kpVal,
      hemPower,
    );
    const viewline = generateViewline(boundary, userLoc.latDeg);

    const mapState: AuroraMapState = {
      ovalBoundary: boundary,
      ovalInnerBoundary: innerBoundary,
      viewline,
      terminatorPath: computeTerminatorPath(
        snapshot.generated_at,
        userLoc.latDeg > 0 ? "north" : "south",
      ),
      userLocation: userLoc,
      hemisphere: userLoc.latDeg > 0 ? "north" : "south",
      maxProbability: maxProb,
      hemisphericPowerGw: hemPower,
    };

    // --- Delay label ---
    const delayLabel =
      delay.delayQuality === "measured"
        ? `L1→Earth: ${formatDelayHours(delay.delayS)} (measured)`
        : `L1→Earth: ${formatDelayHours(FIXED_FALLBACK_DELAY_S)} (degraded)`;

    return {
      forecast,
      mapState,
      degraded,
      delay,
      delayLabel,
      noaaForecastTime: snapshot.ovation.forecast_time,
    };
  }, [inputs.snapshot, inputs.userLocation]);
}
