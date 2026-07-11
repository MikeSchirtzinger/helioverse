/**
 * scene/coalescence.ts — Cannibal-CME merge projection (data-anchored).
 *
 * When two CMEs travel along similar trajectories, a faster trailing front can
 * overtake a slower leading one ("cannibal CME"). This module finds, purely
 * from the same Drag-Based Model the scene already propagates
 * (`cmeFrontRadiusKm`), the heliocentric radius + time at which each co-directional
 * pair's fronts cross. No new physics — it root-finds on the existing kinematics,
 * so the projection is honest: it only appears when the measured launch speeds +
 * arrival anchors actually imply an overtaking.
 */

import type { CmeEventData } from './types';
import { cmeFrontRadiusKm } from './cme-propagation';
import { AU_KM } from './constants';
import { clamp } from './canvas-helpers';

/** Max apex-direction separation (deg) for two CMEs to count as "co-directional". */
const CODIRECTION_DEG = 35;
/** Coarse scan step when bracketing the crossing (seconds). */
const STEP_S = 1800;
/** How far past the later liftoff to search for a crossing (seconds). */
const HORIZON_S = 6 * 86400;
/** Ignore crossings at/after this radius (front parks at the ~2.6 AU scene edge). */
const MAX_MERGE_AU = 1.8;

export interface MergePrediction {
  /** The earlier-launched (leading) CME id. */
  leadId: string;
  /** The later-launched / faster (trailing) CME id that overtakes. */
  chaseId: string;
  /** Heliocentric radius of the crossing (AU). */
  radiusAu: number;
  /** Unix time of the crossing. */
  unix: number;
  /** Hours after the earlier liftoff. */
  tPlusH: number;
  /** True when the merge happens inside 1 AU (before Earth) — the key case. */
  beforeEarth: boolean;
  /** Apex-direction separation of the pair (deg). */
  sepDeg: number;
}

/** Great-circle angle between two CME apex directions (deg). */
function angularSepDeg(a: CmeEventData, b: CmeEventData): number {
  const toRad = Math.PI / 180;
  const la = a.sourcePosition.lat_deg * toRad;
  const lb = b.sourcePosition.lat_deg * toRad;
  const dLon = (a.sourcePosition.lon_deg - b.sourcePosition.lon_deg) * toRad;
  const cos = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(dLon);
  return Math.acos(clamp(cos, -1, 1)) / toRad;
}

function liftoff(event: CmeEventData): number {
  return event.liftoff_unix || event.arrivalWindow?.start || 0;
}

/** Find the first front-radius crossing of a co-directional pair, or null. */
function crossingFor(a: CmeEventData, b: CmeEventData): MergePrediction | null {
  const sepDeg = angularSepDeg(a, b);
  if (sepDeg > CODIRECTION_DEG) return null;

  const start = Math.max(liftoff(a), liftoff(b)) + STEP_S;
  const diffAt = (t: number) => cmeFrontRadiusKm(a, t) - cmeFrontRadiusKm(b, t);

  let prev = diffAt(start);
  let prevT = start;
  for (let t = start + STEP_S; t <= start + HORIZON_S; t += STEP_S) {
    const d = diffAt(t);
    const signFlip = (prev < 0 && d > 0) || (prev > 0 && d < 0);
    if (signFlip) {
      // Bisect the bracket [prevT, t] for the crossing time.
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 40; k += 1) {
        const mid = (lo + hi) / 2;
        const dm = diffAt(mid);
        if ((prev < 0 && dm < 0) || (prev > 0 && dm > 0)) lo = mid;
        else hi = mid;
      }
      const cross = (lo + hi) / 2;
      const radiusAu = cmeFrontRadiusKm(a, cross) / AU_KM;
      if (radiusAu >= MAX_MERGE_AU) return null; // both parked at the scene edge — not a real merge

      // The leader is whoever is ahead just before the crossing.
      const aAhead = prev > 0;
      const lead = aAhead ? a : b;
      const chase = aAhead ? b : a;
      const earliest = Math.min(liftoff(a), liftoff(b));
      return {
        leadId: lead.id,
        chaseId: chase.id,
        radiusAu,
        unix: cross,
        tPlusH: (cross - earliest) / 3600,
        beforeEarth: radiusAu <= 1,
        sepDeg,
      };
    }
    prev = d;
    prevT = t;
  }
  return null;
}

/**
 * Predicted overtaking events among the given CMEs, nearest-Sun first. Empty
 * when no co-directional pair's fronts cross before the scene edge — e.g. the
 * June 2026 storm's CME-1 simply arrives ahead of CME-3, so they compound at L1
 * rather than merging, and nothing is (falsely) reported.
 */
export function predictMerges(events: CmeEventData[]): MergePrediction[] {
  const out: MergePrediction[] = [];
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const a = events[i]!;
      const b = events[j]!;
      const merge = crossingFor(a, b);
      if (merge) out.push(merge);
    }
  }
  return out.sort((x, y) => x.radiusAu - y.radiusAu);
}
