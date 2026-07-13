import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DONKI_CACHE_TTL_MS,
  fetchCmeAnalyses,
  fetchFlares,
  fetchGst,
  fetchIps,
} from './donki-feeds';

interface EnlilFixture {
  modelCompletionTime?: string | null;
  link?: string | null;
  cmeIDs?: string[] | null;
  estimatedShockArrivalTime?: string | null;
  estimatedDuration?: number | null;
  isEarthGB?: boolean | null;
  isEarthMinorImpact?: boolean | null;
  kp_18?: number | null;
  kp_90?: number | null;
  kp_135?: number | null;
  kp_180?: number | null;
}

interface AnalysisFixture {
  isMostAccurate?: boolean;
  time21_5?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  halfAngle?: number | null;
  speed?: number | null;
  type?: string | null;
  note?: string | null;
  enlilList?: EnlilFixture[] | null;
}

let fixtureIndex = 0;

async function normalizeAnalyses(analyses: AnalysisFixture[]) {
  fixtureIndex += 1;
  const day = String(fixtureIndex).padStart(2, '0');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => [{
      activityID: `2099-01-${day}T00:00:00-CME-001`,
      startTime: `2099-01-${day}T00:00:00Z`,
      cmeAnalyses: analyses,
    }],
  } as Response);

  const result = await fetchCmeAnalyses(`2099-01-${day}`, `2099-01-${day}`);
  const cme = result?.[0];
  if (!cme) throw new Error('Expected one normalized CME fixture');
  return cme;
}

function normalizeEnlil(enlil: EnlilFixture | EnlilFixture[] | null) {
  return normalizeAnalyses([{
    isMostAccurate: true,
    speed: 900,
    latitude: 0,
    longitude: 0,
    halfAngle: 45,
    enlilList: Array.isArray(enlil) ? enlil : enlil ? [enlil] : null,
  }]);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WSA-Enlil Earth-impact normalization', () => {
  it('classifies an Earth ETA as a direct forecast when isEarthGB is false', async () => {
    const cme = await normalizeEnlil({
      estimatedShockArrivalTime: '2099-01-03T12:00:00Z',
      isEarthGB: false,
      isEarthMinorImpact: false,
    });

    expect(cme.earthImpactClassification).toBe('direct');
    expect(cme.isEarthDirected).toBe(true);
    expect(cme.isEarthGlancingBlow).toBe(false);
    expect(cme.isEarthMinorImpact).toBe(false);
  });

  it('uses isEarthGB only to qualify an Earth ETA as glancing', async () => {
    const cme = await normalizeEnlil({
      estimatedShockArrivalTime: '2099-01-04T12:00:00Z',
      isEarthGB: true,
      isEarthMinorImpact: false,
    });

    expect(cme.earthImpactClassification).toBe('glancing');
    expect(cme.isEarthDirected).toBe(true);
    expect(cme.isEarthGlancingBlow).toBe(true);
  });

  it('captures and classifies the minor-impact qualifier', async () => {
    const cme = await normalizeEnlil({
      estimatedShockArrivalTime: '2099-01-05T12:00:00Z',
      isEarthGB: false,
      isEarthMinorImpact: true,
    });

    expect(cme.earthImpactClassification).toBe('minor');
    expect(cme.isEarthDirected).toBe(true);
    expect(cme.isEarthMinorImpact).toBe(true);
  });

  it('does not infer an Earth impact when a run has no Earth ETA', async () => {
    const cme = await normalizeEnlil({
      estimatedShockArrivalTime: null,
      isEarthGB: true,
      isEarthMinorImpact: true,
    });

    expect(cme.earthImpactClassification).toBe('none');
    expect(cme.isEarthDirected).toBe(false);
    expect(cme.isEarthGlancingBlow).toBe(true);
    expect(cme.isEarthMinorImpact).toBe(true);
  });

  it('distinguishes a missing WSA-Enlil run from a run forecasting no impact', async () => {
    const cme = await normalizeEnlil(null);

    expect(cme.earthImpactClassification).toBe('unavailable');
    expect(cme.hasEnlilRun).toBe(false);
    expect(cme.isEarthDirected).toBe(false);
  });

  it('selects the latest completed WSA-Enlil revision and captures its identity', async () => {
    const cme = await normalizeEnlil([
      {
        modelCompletionTime: '2099-01-06T01:00:00Z',
        link: 'https://example.test/enlil/older',
        cmeIDs: ['older-cme'],
        estimatedShockArrivalTime: '2099-01-08T01:00:00Z',
      },
      {
        modelCompletionTime: '2099-01-06T03:00:00Z',
        link: 'https://example.test/enlil/latest',
        cmeIDs: ['latest-cme', '', 'companion-cme'],
        estimatedShockArrivalTime: '2099-01-08T03:00:00Z',
      },
      {
        modelCompletionTime: 'not-a-clock',
        link: 'https://example.test/enlil/invalid-clock',
        cmeIDs: ['invalid-clock-cme'],
        estimatedShockArrivalTime: '2099-01-08T05:00:00Z',
      },
    ]);

    expect(cme.enlilShockIso).toBe('2099-01-08T03:00:00Z');
    expect(cme.enlilModelCompletionIso).toBe('2099-01-06T03:00:00Z');
    expect(cme.enlilRunLink).toBe('https://example.test/enlil/latest');
    expect(cme.enlilCmeIds).toEqual(['latest-cme', 'companion-cme']);
  });

  it('selects across every most-accurate analysis and keeps its measured fields together', async () => {
    const cme = await normalizeAnalyses([
      {
        isMostAccurate: true,
        speed: 720,
        latitude: -8,
        longitude: 12,
        halfAngle: 28,
        time21_5: '2099-01-06T02:00:00Z',
        enlilList: [{
          modelCompletionTime: '2099-01-06T04:00:00Z',
          estimatedShockArrivalTime: '2099-01-08T04:00:00Z',
        }],
      },
      {
        isMostAccurate: true,
        speed: 1_180,
        latitude: 5,
        longitude: -3,
        halfAngle: 46,
        time21_5: '2099-01-06T03:00:00Z',
        enlilList: [{
          modelCompletionTime: '2099-01-06T06:00:00Z',
          link: 'https://example.test/enlil/selected-analysis',
          estimatedShockArrivalTime: '2099-01-08T06:00:00Z',
        }],
      },
      {
        isMostAccurate: false,
        speed: 2_400,
        latitude: 40,
        longitude: 80,
        halfAngle: 60,
        enlilList: [{
          modelCompletionTime: '2099-01-06T08:00:00Z',
          estimatedShockArrivalTime: '2099-01-08T08:00:00Z',
        }],
      },
    ]);

    expect(cme.enlilModelCompletionIso).toBe('2099-01-06T06:00:00Z');
    expect(cme.enlilRunLink).toBe('https://example.test/enlil/selected-analysis');
    expect(cme.speed_kms).toBe(1_180);
    expect(cme.apexLat_deg).toBe(5);
    expect(cme.apexLon_deg).toBe(-3);
    expect(cme.halfAngle_deg).toBe(46);
    expect(cme.time21_5).toBe('2099-01-06T03:00:00Z');
  });

  it('falls back to the last run when no completion clock is valid', async () => {
    const cme = await normalizeEnlil([
      {
        modelCompletionTime: null,
        estimatedShockArrivalTime: '2099-01-09T01:00:00Z',
      },
      {
        modelCompletionTime: 'not-a-clock',
        estimatedShockArrivalTime: '2099-01-09T02:00:00Z',
      },
    ]);

    expect(cme.enlilShockIso).toBe('2099-01-09T02:00:00Z');
    expect(cme.enlilModelCompletionIso).toBe('not-a-clock');
  });

  it('uses stable source order across most-accurate analyses when no completion is provable', async () => {
    const cme = await normalizeAnalyses([
      {
        isMostAccurate: true,
        speed: 600,
        enlilList: [{
          modelCompletionTime: null,
          estimatedShockArrivalTime: '2099-01-09T01:00:00Z',
        }],
      },
      {
        isMostAccurate: true,
        speed: 980,
        enlilList: [{
          modelCompletionTime: 'not-a-clock',
          estimatedShockArrivalTime: '2099-01-09T02:00:00Z',
        }],
      },
    ]);

    expect(cme.enlilShockIso).toBe('2099-01-09T02:00:00Z');
    expect(cme.enlilModelCompletionIso).toBe('not-a-clock');
    expect(cme.speed_kms).toBe(980);
  });

  it('normalizes the possible-Kp scenario range and preserves max compatibility', async () => {
    const cme = await normalizeEnlil({
      estimatedShockArrivalTime: '2099-01-10T12:00:00Z',
      kp_18: null,
      kp_90: 3,
      kp_135: 5,
      kp_180: 4,
    });

    expect(cme.predictedKpRange).toEqual({ min: 3, max: 5 });
    expect(cme.predictedKp).toBe(5);
  });
});

describe('DONKI flare normalization', () => {
  it('preserves measured flare fields and the real DONKI source link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{
        flrID: '2099-02-01T01:02:00-FLR-001',
        beginTime: '2099-02-01T01:00:00Z',
        peakTime: '2099-02-01T01:02:00Z',
        endTime: '2099-02-01T01:08:00Z',
        classType: 'X1.2',
        sourceLocation: 'N18E01',
        activeRegionNum: 9999,
        link: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/FLR/99999/-1',
      }],
    } as Response);

    const result = await fetchFlares('2099-02-01', '2099-02-01');

    expect(result).toEqual([expect.objectContaining({
      id: '2099-02-01T01:02:00-FLR-001',
      classType: 'X1.2',
      beginTime: '2099-02-01T01:00:00Z',
      peakTime: '2099-02-01T01:02:00Z',
      endTime: '2099-02-01T01:08:00Z',
      sourceLocation: 'N18E01',
      activeRegionNum: 9999,
      link: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/FLR/99999/-1',
    })]);
  });
});

describe('DONKI monitoring cache', () => {
  it('deduplicates a pending request even when it outlives the response TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-03-01T00:00:00Z'));

    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => (
      new Promise<Response>((resolve) => { resolveFetch = resolve; })
    ));

    const first = fetchCmeAnalyses('2099-03-01', '2099-03-01');
    vi.setSystemTime(Date.now() + DONKI_CACHE_TTL_MS * 2);
    const concurrent = fetchCmeAnalyses('2099-03-01', '2099-03-01');

    expect(concurrent).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    if (!resolveFetch) throw new Error('Expected a pending fetch resolver');
    resolveFetch({ ok: true, json: async () => [] } as Response);
    await first;
  });

  it.each([
    ['CME', fetchCmeAnalyses, '02'],
    ['FLR', fetchFlares, '03'],
    ['IPS', fetchIps, '04'],
    ['GST', fetchGst, '05'],
  ] as const)('reuses %s data within five minutes and refreshes it at expiry', async (
    _feed,
    fetcher,
    day,
  ) => {
    vi.useFakeTimers();
    const startedAt = new Date(`2099-03-${day}T12:00:00Z`).getTime();
    const date = `2099-03-${day}`;
    vi.setSystemTime(startedAt);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    const first = fetcher(date, date);
    await first;
    await Promise.resolve();

    vi.setSystemTime(startedAt + DONKI_CACHE_TTL_MS - 1);
    const cached = fetcher(date, date);
    expect(cached).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(startedAt + DONKI_CACHE_TTL_MS);
    const refreshed = fetcher(date, date);
    expect(refreshed).not.toBe(first);
    await refreshed;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
