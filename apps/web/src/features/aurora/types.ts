/**
 * types.ts — Aurora feature-local types
 *
 * These types bridge the frozen contract Snapshot types to the
 * aurora-card/map domain. They are local to this feature directory only.
 */

import type { Verdict, Limiter } from "./go-look";

// ---------------------------------------------------------------
// User-settable location
// ---------------------------------------------------------------

export interface UserLocation {
  latDeg: number;
  lonDeg: number;
  /** Human-readable place name (optional, for display). */
  label?: string;
}

// ---------------------------------------------------------------
// Oval geometry — derived from OVATION + delay correction
// ---------------------------------------------------------------

/** A single point on the auroral oval boundary (geographic lat/lon). */
export interface OvalPoint {
  lonDeg: number;
  latDeg: number;
}

/** Viewline: the equatorward edge of visible aurora for a given probability threshold. */
export interface Viewline {
  /** Threshold probability this viewline corresponds to (e.g. 0.1 = 10%). */
  threshold: number;
  points: OvalPoint[];
}

// ---------------------------------------------------------------
// Tonight forecast — the card's data model
// ---------------------------------------------------------------

export interface TonightForecast {
  verdict: Verdict;
  /** The "go look" score 0..1. */
  score: number;
  confidence: number;
  probabilityPct: number;
  dominantLimiter: Limiter;
  /** Best viewing window (UTC). */
  timeWindow: {
    start: string; // ISO 8601
    end: string;
    /** Human-readable label, e.g. "10pm – 4am local". */
    label: string;
  };
  /** Equatorward viewing direction hint, e.g. "Look north" (northern hemisphere). */
  lookDirection: string;
  /** KP-derived description. */
  activityLabel: string;
}

// ---------------------------------------------------------------
// Aurora map state
// ---------------------------------------------------------------

export interface AuroraMapState {
  /** The auroral oval boundary points (equatorward edge). */
  ovalBoundary: OvalPoint[];
  /** The poleward oval boundary (inner edge). */
  ovalInnerBoundary: OvalPoint[];
  /** Viewline for the user's location threshold. */
  viewline: OvalPoint[];
  /** Terminator polygon (dark half of the globe). */
  terminatorPath: string; // SVG path d-string
  /** User pin location. */
  userLocation: UserLocation | null;
  /** Hemisphere being displayed. */
  hemisphere: "north" | "south";
  /** Max probability value in the oval for color scaling. */
  maxProbability: number;
  /** Hemispheric power in GW (from OVATION). */
  hemisphericPowerGw: number | null;
}

// ---------------------------------------------------------------
// Degraded state
// ---------------------------------------------------------------

export interface DegradedInfo {
  isDegraded: boolean;
  /** Reason for degradation (e.g. "Plasma feed stale — using fixed 30-min delay"). */
  reason: string | null;
}

// ---------------------------------------------------------------
// Time Window Helper
// ---------------------------------------------------------------

/**
 * Compute the best aurora viewing window for a location.
 *
 * Returns a local-night window: roughly sunset+1h to sunrise−1h, capped
 * to the snapshot validity. In v1 this is a simple heuristic; post-v1 it
 * will use the precise terminator from sky_state().
 */
export function computeTimeWindow(
  snapshotGeneratedAt: string,
  _userLatDeg: number,
): { start: string; end: string; label: string } {
  // Simple heuristic: "tonight" = the current UTC night
  // The snapshot gives us the generated time; we compute the local night
  // based on a fixed 18:00–06:00 local window for now.
  // Post-v1: use sky_state() from helio-core WASM for precise terminator times.

  // snapshotGeneratedAt is ISO-8601 (already ends with Z); parse directly
  const gen = new Date(snapshotGeneratedAt);
  // Round to current UTC date evening
  const evening = new Date(
    Date.UTC(
      gen.getUTCFullYear(),
      gen.getUTCMonth(),
      gen.getUTCDate(),
      18,
      0,
      0,
    ),
  );
  const morning = new Date(evening.getTime() + 12 * 60 * 60 * 1000); // 06:00 next day

  const startIso = evening.toISOString().replace(".000Z", "Z");
  const endIso = morning.toISOString().replace(".000Z", "Z");

  // Format human-readable label with proper 12-hour AM/PM
  const label = `${formatHourLabel(evening.getUTCHours())} – ${formatHourLabel(morning.getUTCHours())}`;

  return { start: startIso, end: endIso, label };
}

/**
 * Format an hour (0–23) as a 12-hour human-readable label.
 * 0 → midnight, 12 → noon, 18 → 6pm, 6 → 6am, etc.
 */
function formatHourLabel(h: number): string {
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  const h12 = h > 12 ? h - 12 : h;
  const ampm = h >= 12 ? "pm" : "am";
  return `${h12}${ampm}`;
}
