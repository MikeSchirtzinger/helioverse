import { buildFocusPayload, determineTimelineMode, getAsOfFrame, parseIsoMillis, toIsoUtc } from './model';
import { fixtureTimelineModel } from './fixtures';

export interface TimelineHarnessResult {
  ok: boolean;
  checks: string[];
}

function assertCheck(condition: boolean, message: string, checks: string[]): void {
  if (!condition) {
    throw new Error(`Timeline harness failed: ${message}`);
  }
  checks.push(message);
}

export function runTimelineFixtureAssertions(): TimelineHarnessResult {
  const checks: string[] = [];
  const { window } = fixtureTimelineModel;

  const historySpanDays = (parseIsoMillis(window.liveAtIso) - parseIsoMillis(window.historyStartIso)) / (24 * 60 * 60 * 1000);
  assertCheck(historySpanDays === 30, '30-day history window is present', checks);

  assertCheck(determineTimelineMode(toIsoUtc(parseIsoMillis(window.liveAtIso) - 6 * 60 * 60 * 1000), window) === 'history', 'past scrub selects history mode', checks);
  assertCheck(determineTimelineMode(window.liveAtIso, window) === 'live', 'live time selects live mode', checks);
  assertCheck(determineTimelineMode(toIsoUtc(parseIsoMillis(window.liveAtIso) + 6 * 60 * 60 * 1000), window) === 'project', 'future scrub selects project mode', checks);

  assertCheck(fixtureTimelineModel.chips.every((chip) => chip.thumbnail !== null), 'event chips expose thumbnail slots', checks);

  const earlyHindcast = buildFocusPayload(fixtureTimelineModel, '2026-06-10T08:15Z-CME-001', '2026-06-10T12:00:00Z');
  assertCheck(earlyHindcast.mode === 'history', 'click-to-focus payload preserves selected mode', checks);
  assertCheck(earlyHindcast.selectedKinematics?.version === 1, 'hindcast withholds later kinematics revisions', checks);
  assertCheck(earlyHindcast.leakageSafe, 'hindcast focus payload is leakage-safe', checks);

  const liveFocus = buildFocusPayload(fixtureTimelineModel, '2026-06-10T08:15Z-CME-001', window.liveAtIso);
  assertCheck(liveFocus.selectedKinematics?.version === 2, 'live focus uses latest as-of-safe kinematics', checks);
  assertCheck(liveFocus.activePrediction?.inputs_as_of === '2026-06-10T14:00:00Z', 'live focus uses latest safe prediction', checks);

  const projectFrame = getAsOfFrame(fixtureTimelineModel, toIsoUtc(parseIsoMillis(window.liveAtIso) + 12 * 60 * 60 * 1000));
  assertCheck(projectFrame.isProjection && projectFrame.inputsAsOfIso === window.liveAtIso, 'project mode uses live as-of frame', checks);

  return { ok: true, checks };
}

export const timelineHarnessResult = runTimelineFixtureAssertions();
