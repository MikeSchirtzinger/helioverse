/**
 * integration/storm-scenario.ts — The June 3, 2026 AR 4455 triple-flare storm.
 *
 * A worked example the canvas replays from eruption past Earth toward Mars'
 * orbit. The measured CME-analysis fields and modelled WSA-Enlil outputs for
 * this event are pinned here so replay remains deterministic while live mode
 * uses the current DONKI feed.
 *
 * MEASURED (DONKI CME Analysis + FLR/IPS/GST, verified 2026-06):
 *   Flares from AR 4455 (#14455): M9.3 @01:36 (N13W10), M7.7 @07:00 (N14W13),
 *   X1.0 @11:28 (N14W16). Three CMEs:
 *     CME-1  2026-06-03T01:53Z  1220 km/s  apex N14 W19  half 32°
 *     CME-2  2026-06-03T07:23Z  1474 km/s  apex N52 W19  half 31°
 *     CME-3  2026-06-03T11:48Z  1433 km/s  apex N32 W19  half 37°
 *   Observed: interplanetary shock at L1 ~Jun5 04:23 (IPS), compound storm,
 *   NOAA GST peak Kp 6.33 (G2) @ Jun5 18:00.
 *
 * MODELLED (WSA-Enlil): CME-1 → Jun 5 01:13 / Kp≤7; CME-2 → Jun 6 15:00 /
 *   Kp≤4; CME-3 → Jun 5 07:45 / Kp≤6.
 *   (Earlier "cannibal merge" framing was dropped — Enlil has CME-1 arriving
 *   ~6 h BEFORE the faster CME-3, so they reach Earth as a compound, not a
 *   single overtaking front.)
 *
 * ESTIMATED (not in DONKI): mass and ion count, derived from the measured
 * angular width via the published CME mass–width relation — see
 * `estimateCmeMassKg`. Flagged `massEstimated` and surfaced as a caveat.
 */

import type { CmeEventData } from '@/scene/types';
import { SUN_RADIUS_KM } from '@/scene/constants';
import { estimateCmeMassKg, ionsFromMass } from '@/scene/donki-feeds';
import { cmeSpeedColorHex } from '@/scene/cme-style';

export type MilestoneKind = 'flare' | 'cme' | 'predicted' | 'actual' | 'storm' | 'aurora';
export type Confidence = 'high' | 'medium';

export interface StormMilestone {
  id: string;
  label: string;
  timeIso: string;
  kind: MilestoneKind;
  confidence: Confidence;
  detail: string;
}

export interface StormFlare {
  id: string;
  flareClass: string;
  peakIso: string;
  ar: string;
  blackout: string;
  confidence: Confidence;
  cmeId: string;
}

export interface CmeScience {
  /** Ejected mass (kg) — ESTIMATED from angular width (DONKI has no mass). */
  mass_kg: number;
  /** Ion count (mostly protons) implied by the estimated mass. */
  ions: number;
  /** True — mass/ions are estimates, not measured values. */
  massEstimated: true;
}

export interface StormCme extends CmeEventData {
  name: string;
  flareClass: string;
  flareId: string;
  /** DONKI activityID for live reconciliation (scene/donki-feeds.ts). */
  donkiId: string;
  /** RGB tint for the cloud / box / label. */
  color: number;
  /** Whether this CME's predicted/observed arrival drives the Earth storm. */
  isCannibal: boolean;
  /** CME ids this one overtakes and merges with (empty — see header). */
  absorbs: string[];
  predictedEtaIso: string | null;
  actualEtaIso: string | null;
  science: CmeScience;
  /** Confidence in the KINEMATICS (now 'high' — measured by DONKI). */
  confidence: Confidence;
}

/** Build the estimated-mass science block for a CME from its measured width. */
function science(halfAngle_deg: number, isHalo: boolean): CmeScience {
  const mass_kg = estimateCmeMassKg(halfAngle_deg, isHalo);
  return { mass_kg, ions: ionsFromMass(mass_kg), massEstimated: true };
}

export interface StormScenario {
  id: string;
  name: string;
  region: string;
  source: string;
  windowStartIso: string;
  windowEndIso: string;
  defaultClockIso: string;
  flares: StormFlare[];
  cmes: StormCme[];
  /** The dominant arrival-anchored CME — drives camera follow and replay magnetosphere proxy. */
  primaryCmeId: string;
  milestones: StormMilestone[];
  caveats: string[];
  outcome: {
    stormLevel: string;
    predictedLevel: string;
    peakKp: number;
    note: string;
  };
}

const iso = (s: string): number => Date.parse(s) / 1000;

/** Kinetic energy (J) of a CME from mass (kg) and speed (km/s). */
export function cmeKineticEnergyJ(mass_kg: number, speed_kms: number): number {
  const v = speed_kms * 1000;
  return 0.5 * mass_kg * v * v;
}

// WSA-Enlil predicted shock + observed interplanetary shock (DONKI), for the
// primary (X1.0) CME-3. CME-1 is predicted ~6 h earlier; see per-CME windows.
const PREDICTED_ETA = '2026-06-05T07:45:00Z'; // DONKI/Enlil shock arrival for CME-3
const ACTUAL_ETA = '2026-06-05T04:23:00Z'; // observed first L1 interplanetary shock (DONKI IPS)

// --- CME-1: M9.3 flare. Measured 1220 km/s, apex N14 W19, half 32°. ---
const cme1: StormCme = {
  id: '2026-06-03T01:53Z-CME-AR4455-1',
  donkiId: '2026-06-03T01:53:00-CME-001',
  name: 'CME-1',
  flareClass: 'M9.3',
  flareId: 'flr-m93',
  color: cmeSpeedColorHex(1220),
  isCannibal: false,
  absorbs: [],
  sourcePosition: { lon_deg: 19, lat_deg: 14, r_km: SUN_RADIUS_KM * 1.02 },
  speed_kms: 1220,
  halfAngle_deg: 32,
  isHalo: false,
  earthBoundScore: 0.7,
  liftoff_unix: iso('2026-06-03T01:53:00Z'),
  frontPosition: null,
  // Enlil shock Jun 5 01:13 (arrives first); duration ~23.8 h.
  arrivalWindow: { start: iso('2026-06-04T13:00:00Z'), eta: iso('2026-06-05T01:13:00Z'), end: iso('2026-06-05T13:00:00Z') },
  predictedEtaIso: '2026-06-05T01:13:00Z',
  actualEtaIso: '2026-06-05T04:23:00Z',
  enlilDurationH: 23.8,
  science: science(32, false),
  confidence: 'high',
};

// --- CME-2: M7.7 flare. Measured 1474 km/s, apex N52 W19 (high-N), half 31°. ---
const cme2: StormCme = {
  id: '2026-06-03T07:23Z-CME-AR4455-2',
  donkiId: '2026-06-03T07:23:00-CME-001',
  name: 'CME-2',
  flareClass: 'M7.7',
  flareId: 'flr-m77',
  color: cmeSpeedColorHex(1474),
  isCannibal: false,
  absorbs: [],
  sourcePosition: { lon_deg: 19, lat_deg: 52, r_km: SUN_RADIUS_KM * 1.02 },
  speed_kms: 1474,
  halfAngle_deg: 31,
  isHalo: true,
  earthBoundScore: 0.35,
  liftoff_unix: iso('2026-06-03T07:23:00Z'),
  frontPosition: null,
  // Enlil shock Jun 6 15:00 — aimed high-north, only a glancing Earth impact.
  arrivalWindow: { start: iso('2026-06-06T03:00:00Z'), eta: iso('2026-06-06T15:00:00Z'), end: iso('2026-06-07T03:00:00Z') },
  predictedEtaIso: '2026-06-06T15:00:00Z',
  actualEtaIso: null,
  enlilDurationH: null,
  science: science(31, true),
  confidence: 'high',
};

// --- CME-3: X1.0 flare, fast partial halo. Measured 1433 km/s, apex N32 W19. ---
const cme3: StormCme = {
  id: '2026-06-03T11:48Z-CME-AR4455-3',
  donkiId: '2026-06-03T11:48:00-CME-001',
  name: 'CME-3',
  flareClass: 'X1.0',
  flareId: 'flr-x10',
  color: cmeSpeedColorHex(1433),
  isCannibal: false,
  absorbs: [],
  sourcePosition: { lon_deg: 19, lat_deg: 32, r_km: SUN_RADIUS_KM * 1.02 },
  speed_kms: 1433,
  halfAngle_deg: 37,
  isHalo: true,
  earthBoundScore: 0.8,
  liftoff_unix: iso('2026-06-03T11:48:00Z'),
  frontPosition: null,
  // Enlil shock Jun 5 07:45 (duration ~27.8 h); observed compound shock Jun 5.
  arrivalWindow: { start: iso(PREDICTED_ETA), eta: iso(PREDICTED_ETA), end: iso('2026-06-05T19:00:00Z') },
  predictedEtaIso: PREDICTED_ETA,
  actualEtaIso: '2026-06-05T12:06:00Z',
  enlilDurationH: 27.8,
  science: science(37, true),
  confidence: 'high',
};

export const JUNE_2026_STORM: StormScenario = {
  id: 'june-2026-ar4455',
  name: 'AR 4455 triple-flare storm',
  region: 'NOAA AR 4455',
  source: 'NASA DONKI CME Analysis · WSA-Enlil · NOAA SWPC GST (2026-06-03 → 06-07)',
  // Window runs past the Jun 5 Earth arrival out to Jun 7 so the fronts visibly
  // cross Earth's orbit and continue to Mars' orbit (1.52 AU) on the scrubber.
  windowStartIso: '2026-06-03T00:00:00Z',
  windowEndIso: '2026-06-07T12:00:00Z',
  defaultClockIso: '2026-06-03T11:30:00Z',
  primaryCmeId: cme3.id,
  flares: [
    { id: 'flr-m93', flareClass: 'M9.3', peakIso: '2026-06-03T01:36:00Z', ar: 'AR 4455', blackout: 'R2 (East Asia / Pacific)', confidence: 'high', cmeId: cme1.id },
    { id: 'flr-m77', flareClass: 'M7.7', peakIso: '2026-06-03T07:00:00Z', ar: 'AR 4455', blackout: 'R2 (Europe / Africa)', confidence: 'high', cmeId: cme2.id },
    { id: 'flr-x10', flareClass: 'X1.0', peakIso: '2026-06-03T11:28:00Z', ar: 'AR 4455', blackout: 'R3 strong (Europe / Asia)', confidence: 'high', cmeId: cme3.id },
  ],
  cmes: [cme1, cme2, cme3],
  milestones: [
    { id: 'flr-m93', label: 'M9.3 flare → CME-1', timeIso: '2026-06-03T01:36:00Z', kind: 'flare', confidence: 'high', detail: 'AR 4455 — M9.3, R2 blackout. Launches CME-1 (measured 1220 km/s, apex N14).' },
    { id: 'flr-m77', label: 'M7.7 flare → CME-2', timeIso: '2026-06-03T07:00:00Z', kind: 'flare', confidence: 'high', detail: 'AR 4455 — M7.7, R2. Launches CME-2 (1474 km/s) aimed high-north (apex N52) — only glances Earth.' },
    { id: 'flr-x10', label: 'X1.0 flare → CME-3', timeIso: '2026-06-03T11:28:00Z', kind: 'flare', confidence: 'high', detail: 'AR 4455 — X1.0, R3 strong. Launches the fast partial-halo CME-3 (1433 km/s, apex N32).' },
    { id: 'predicted-1', label: 'CME-1 predicted arrival', timeIso: '2026-06-05T01:13:00Z', kind: 'predicted', confidence: 'high', detail: 'WSA-Enlil shock for CME-1 — arrives first, ~6 h ahead of CME-3. Predicted Kp up to 7 (G3).' },
    { id: 'actual', label: 'Shock hits L1', timeIso: ACTUAL_ETA, kind: 'actual', confidence: 'high', detail: 'Observed interplanetary shock at L1 (DONKI IPS), Jun 5 04:23 — start of the compound storm.' },
    { id: 'predicted-3', label: 'CME-3 predicted arrival', timeIso: PREDICTED_ETA, kind: 'predicted', confidence: 'high', detail: 'WSA-Enlil shock for the X1.0 CME-3 (07:45). The two Earth-bound CMEs compound at L1.' },
    { id: 'storm-peak', label: 'G2 storm peak (Kp 6.33)', timeIso: '2026-06-05T18:00:00Z', kind: 'storm', confidence: 'high', detail: 'NOAA GST: observed peak Kp 6.33 (G2 Moderate) — under the G3 watch from Enlil.' },
    { id: 'mars-orbit', label: 'Fronts cross Mars’ orbit', timeIso: '2026-06-06T13:00:00Z', kind: 'cme', confidence: 'medium', detail: 'The ejecta keep moving past Earth; CME-1/CME-3 reach Mars’ orbital distance (1.52 AU) on Jun 6.' },
  ],
  caveats: [
    'CME speeds (1220 / 1474 / 1433 km/s), apex directions and angular widths are MEASURED in NASA DONKI CME Analysis. Arrival times and predicted Kp are MODELLED by WSA-Enlil.',
    'CME mass and ion count are ESTIMATED from the measured angular width (DONKI carries no mass); they are order-of-magnitude only and labelled as estimates wherever shown.',
    'Trajectories use each CME’s reconstructed apex. The interplanetary legs are modelled because nothing continuously images a CME from Sun to Earth. Historical aurora probability is withheld because NOAA exposes a latest-only OVATION grid.',
  ],
  outcome: {
    stormLevel: 'G2 (Moderate)',
    predictedLevel: 'G3 watch (Enlil Kp≤7)',
    peakKp: 6.33,
    note: 'Observed peak Kp 6.33 (G2) vs an Enlil-predicted Kp up to 7 (G3) — the predicted-vs-observed gap an aurora-prediction loop would learn from.',
  },
};

/** The dominant arrival-anchored CME. */
export function primaryCme(scenario: StormScenario = JUNE_2026_STORM): StormCme {
  return scenario.cmes.find((cme) => cme.id === scenario.primaryCmeId) ?? scenario.cmes[scenario.cmes.length - 1]!;
}
