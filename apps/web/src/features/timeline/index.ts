/**
 * features/timeline/ — W1-P6: Timeline Scrubber
 *
 * Fixture-driven timeline module for 30-day history/scrub, live, and
 * projected future control. This package intentionally does not wire itself
 * into App.tsx; integration packages can import the component and data-model
 * helpers from here.
 */

export const TIMELINE_READY = true;

export type {
  BuildTimelineModelInput,
  EventType,
  IsoUtcString,
  TimelineAsOfFrame,
  TimelineEvent,
  TimelineEventChip,
  TimelineFocusPayload,
  TimelineKinematicsVersion,
  TimelineMode,
  TimelineModel,
  TimelineOutcome,
  TimelinePrediction,
  TimelineSnapshot,
  TimelineSnapshotClockSet,
  TimelineThumbnailRef,
  TimelineWindow,
} from './types';

export type { HindcastSafetyReport } from './model';

export {
  buildFocusPayload,
  buildTimelineModel,
  clamp,
  determineTimelineMode,
  eventDisplayTime,
  eventLabel,
  eventShortId,
  findAsOfSnapshot,
  getAsOfFrame,
  getAvailableKinematics,
  getPredictionForAsOf,
  parseIsoMillis,
  percentToTimeIso,
  selectKinematicsForAsOf,
  timeToPercent,
  toIsoUtc,
  validateHindcastSafety,
} from './model';

export { fixtureTimelineEvents, fixtureTimelineModel, fixtureTimelineSnapshots } from './fixtures';
export { TimelineScrubber } from './TimelineScrubber';
export type { TimelineScrubberProps } from './TimelineScrubber';
export { TimelineFixtureStory } from './TimelineFixtureStory';
export { runTimelineFixtureAssertions, timelineHarnessResult } from './harness';
export type { TimelineHarnessResult } from './harness';
