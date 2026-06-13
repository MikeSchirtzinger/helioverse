/**
 * features/panels/ — W1-P8: Metric Panels
 *
 * Fixture-driven metric strip and event-detail panel models/components.
 * App.tsx wiring is intentionally left for Wave 2 integration.
 */

export { ClockBadges, EventDetailPanel, MetricCard, MetricStrip, Sparkline } from './components';
export { PanelsStory } from './story';
export { activeCmeEventFixture, degradedSnapshotFixture, resolvedCmeEventFixture, stormSnapshotFixture } from './fixtures';
export {
  createEventDetailModel,
  createMetricStripModel,
  createThreeClockBadges,
} from './model';
export { classifyByBands, classifyNoaaScale, metricThresholds, severityColors } from './thresholds';
export type {
  ClockBadgeModel,
  EventDetailModel,
  EventDetailRow,
  EventOutcome,
  EventPrediction,
  HelioEvent,
  HelioSnapshot,
  KinematicsVersion,
  MetricPanelModel,
  MetricSeverity,
  MetricStripModel,
  MetricTrend,
  NoaaScaleBadge,
  SourceStatus,
  SparklinePoint,
  ThresholdBand,
} from './types';

export const PANELS_READY = true;
