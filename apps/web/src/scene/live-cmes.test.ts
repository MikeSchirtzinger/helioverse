import { describe, expect, it } from 'vitest';
import type { DonkiCme } from './donki-feeds';
import { buildLiveScene } from './live-cmes';

const DAY_S = 86_400;

function cme(index: number, startUnix: number): DonkiCme {
  return {
    activityID: `2026-07-10T00:00:00-CME-${String(index).padStart(3, '0')}`,
    startTime: new Date(startUnix * 1000).toISOString(),
    startUnix,
    sourceLocation: 'N00W00',
    activeRegion: null,
    speed_kms: 700 + index,
    halfAngle_deg: 30,
    apexLat_deg: 0,
    apexLon_deg: index,
    speedClass: 'C',
    isHalo: false,
    time21_5: null,
    enlilShockIso: null,
    enlilDurationH: null,
    hasEnlilRun: false,
    isEarthDirected: index % 2 === 0,
    predictedKp: null,
    linkedEventIds: [],
    estMass_kg: 1e12,
    estIons: 6e38,
    link: 'https://api.nasa.gov/DONKI/CME',
  };
}

describe('live CME display domain', () => {
  it('keeps the full ledger but caps the operational 3D layer at four in-flight fronts', () => {
    const now = Date.parse('2026-07-11T12:00:00Z') / 1000;
    const recent = Array.from({ length: 7 }, (_, index) => cme(index, now - (index + 1) * 3600));
    const departed = cme(99, now - 7 * DAY_S);
    const scene = buildLiveScene([...recent, departed], now, now - 7 * DAY_S);

    expect(scene).not.toBeNull();
    expect(scene?.totalDetected).toBe(8);
    expect(scene?.shown).toBe(4);
    expect(scene?.renderedViews.some((view) => view.canvas.event.id === departed.activityID)).toBe(false);
  });
});
