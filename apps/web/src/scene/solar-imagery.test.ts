import { describe, expect, it } from 'vitest';
import {
  hasSolarSignalPixels,
  normalizeHelioviewerDate,
  solarImageCandidates,
} from './solar-imagery';

describe('Helioviewer frame selection', () => {
  it('keeps the requested channel time first and rolls back in bounded steps', () => {
    expect(solarImageCandidates('2026-07-11T07:48:43Z')).toEqual([
      '2026-07-11T07:48:00Z',
      '2026-07-11T07:33:00Z',
      '2026-07-11T07:18:00Z',
      '2026-07-11T07:03:00Z',
      '2026-07-11T06:48:00Z',
      '2026-07-11T06:33:00Z',
      '2026-07-11T06:18:00Z',
      '2026-07-11T05:48:00Z',
      '2026-07-11T03:48:00Z',
      '2026-07-11T01:48:00Z',
    ]);
  });

  it('normalizes the timestamp returned by getClosestImage', () => {
    expect(normalizeHelioviewerDate('2026-07-11 06:47:53')).toBe('2026-07-11T06:47:53Z');
    expect(normalizeHelioviewerDate('not-a-date')).toBeNull();
  });
});

describe('Helioviewer pixel quality gate', () => {
  it('rejects HTTP-200 frames whose decoded pixels are effectively black', () => {
    expect(hasSolarSignalPixels(new Uint8ClampedArray(48 * 48 * 4))).toBe(false);
  });

  it('accepts a frame with a real bright solar disk', () => {
    const pixels = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 40; i += 1) {
      pixels[i * 4] = 180;
      pixels[i * 4 + 1] = 92;
      pixels[i * 4 + 2] = 34;
      pixels[i * 4 + 3] = 255;
    }
    expect(hasSolarSignalPixels(pixels)).toBe(true);
  });
});
