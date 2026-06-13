import { useState } from 'react';
import { TimelineScrubber } from './TimelineScrubber';
import { fixtureTimelineModel } from './fixtures';
import type { IsoUtcString, TimelineFocusPayload, TimelineMode } from './types';

function svgThumbDataUri(label: string): string {
  const safe = encodeURIComponent(label);
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><defs><radialGradient id='g' cx='50%25' cy='46%25'><stop offset='0%25' stop-color='%23fde68a'/><stop offset='45%25' stop-color='%23fb923c'/><stop offset='100%25' stop-color='%230f172a'/></radialGradient></defs><rect width='96' height='96' rx='18' fill='url(%23g)'/><circle cx='48' cy='48' r='18' fill='none' stroke='%23fff7ed' stroke-opacity='0.7' stroke-width='3'/><path d='M48 8 C66 27 68 45 88 58' stroke='%23bae6fd' stroke-opacity='0.8' stroke-width='5' fill='none'/><text x='48' y='84' text-anchor='middle' fill='white' font-family='Arial' font-size='10' font-weight='700'>${safe}</text></svg>`;
}

export function TimelineFixtureStory() {
  const [timeIso, setTimeIso] = useState<IsoUtcString>(fixtureTimelineModel.window.liveAtIso);
  const [mode, setMode] = useState<TimelineMode>('live');
  const [focus, setFocus] = useState<TimelineFocusPayload | null>(null);

  return (
    <main style={{ minHeight: '100vh', padding: 28, background: '#020617' }}>
      <TimelineScrubber
        model={fixtureTimelineModel}
        valueIso={timeIso}
        onTimeChange={(nextIso, nextMode) => {
          setTimeIso(nextIso);
          setMode(nextMode);
        }}
        onFocusEvent={setFocus}
        resolveThumbnailUrl={(r2Key) => svgThumbDataUri(r2Key.includes('FLR') ? 'FLR' : 'CME')}
      />

      <aside style={{ marginTop: 18, color: '#cbd5e1', fontFamily: 'ui-sans-serif, system-ui' }}>
        <h3 style={{ margin: '0 0 8px', color: '#f8fafc' }}>Fixture browser story state</h3>
        <pre style={{ margin: 0, padding: 14, borderRadius: 12, overflow: 'auto', background: 'rgba(15,23,42,0.92)', border: '1px solid rgba(148,163,184,0.25)' }}>
          {JSON.stringify(
            {
              timeIso,
              mode,
              focusedEvent: focus
                ? {
                    eventId: focus.eventId,
                    mode: focus.mode,
                    inputsAsOfIso: focus.inputsAsOfIso,
                    selectedKinematicsVersion: focus.selectedKinematics?.version ?? null,
                    predictionModel: focus.activePrediction?.model ?? null,
                    leakageSafe: focus.leakageSafe,
                  }
                : null,
            },
            null,
            2,
          )}
        </pre>
      </aside>
    </main>
  );
}
