/**
 * @helioverse/contracts — Read-only TypeScript contract helpers
 *
 * DO NOT MODIFY DURING WAVE 1. These types are generated from the frozen
 * Wave-0 schemas and fixtures in contracts/. Any downstream package validates
 * against these, not against sibling implementations.
 *
 * Schema validation is done at the JSON Schema level (contracts/schemas/).
 * This package provides typed access to fixture data and schema shapes.
 */

// Re-export fixture data as typed objects
export { snapshotQuiet } from './fixtures/snapshot-quiet';
export { snapshotStorm } from './fixtures/snapshot-storm';
export { snapshotDegraded } from './fixtures/snapshot-degraded';
export { eventCmeHalo } from './fixtures/event-cme-halo';
export { eventCmeResolved } from './fixtures/event-cme-resolved';
export { eventFlr } from './fixtures/event-flr';

// Re-export types derived from schemas
export type {
  Snapshot,
  SnapshotClocks,
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
} from './types/snapshot';

export type {
  Event,
  KinematicsVersion,
  CmeDirection,
  Prediction,
  PredictionArrival,
  Outcome,
  EventLink,
  EventProvenance,
  FlareDetail,
  EventThumbnail,
  ValueSigma,
} from './types/event';

export type {
  AlertSubscription,
  PushSubscription,
  AlertLocation,
  AlertThresholds,
  AuroraTonightThreshold,
  BzTurnThreshold,
} from './types/alert-subscription';

// Contract constants
export { CONTRACT_VERSION, AU_KM, SUN_RADIUS_KM, FIXED_FALLBACK_DELAY_S } from './constants';
