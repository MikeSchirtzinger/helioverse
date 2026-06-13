/**
 * features/aurora/ — W1-P5: Aurora Card + Map
 *
 * Owner: W1-P5-B (DeepSeek builder) / W1-P5-V (GPT validator)
 *
 * Scope:
 * - Fixture-driven "tonight" card with verdict badge
 * - Probability score bar + confidence display
 * - Time window when aurora is worth looking for
 * - Auroral oval render on polar projection (SVG)
 * - Viewline (equatorward visibility edge)
 * - User pin with pulsing animation
 * - Terminator/daylight shading
 * - Degraded-delay label when L1 plasma feed is stale
 *
 * Do NOT write to: apps/web/src/scene/* or other feature dirs.
 * Do NOT wire into App.tsx.
 */

// Snapshot types + fixtures (local mirror of @helioverse/contracts)
export type {
  Snapshot,
  SnapshotSources,
  SourceStatus,
  SolarWind,
  L1ToEarth,
  Indices,
  TimedValue,
  KpForecast,
  NoaaScales,
  OvationMeta,
  TrailingSeries,
  AlertItem,
} from "./snapshot-local";
export {
  snapshotQuiet,
  snapshotStorm,
  snapshotDegraded,
} from "./snapshot-local";

// Public components
export { AuroraPanel } from "./aurora-panel";
export type { AuroraPanelProps } from "./aurora-panel";

export { TonightCard } from "./tonight-card";
export type { TonightCardProps } from "./tonight-card";

export { AuroraMap } from "./aurora-map";
export type { AuroraMapProps } from "./aurora-map";

// Hooks
export { useAurora } from "./use-aurora";
export type { UseAuroraInputs, UseAuroraOutput } from "./use-aurora";

// Pinned contract implementations (TS re-implementations of WASM API surface)
export { goLook, darknessFactor } from "./go-look";
export type { GoLookInputs, GoLookScore, Verdict, Limiter } from "./go-look";
export {
  l1DelaySeconds,
  computeDelay,
  formatDelayHours,
  FIXED_FALLBACK_DELAY_S,
  OutOfRangeError,
} from "./delay-correction";
export type { DelayResult } from "./delay-correction";

// Local types
export type {
  UserLocation,
  TonightForecast,
  AuroraMapState,
  DegradedInfo,
  OvalPoint,
  Viewline,
} from "./types";
