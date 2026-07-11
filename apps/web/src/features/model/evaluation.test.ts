import { describe, expect, it } from 'vitest';

import type { DonkiCme, DonkiGst, DonkiIps } from '@/scene/donki-feeds';
import { evaluatePredictions } from './evaluation';

const cme = (index: number, linkedEventIds: string[] = []): DonkiCme => ({
  activityID: `2024-05-10T00:00:00-CME-${String(index).padStart(3, '0')}`,
  startTime: '2024-05-10T00:00:00Z',
  startUnix: Date.parse('2024-05-10T00:00:00Z') / 1_000,
  sourceLocation: 'N10W10',
  activeRegion: 13664,
  speed_kms: 1_000,
  halfAngle_deg: 45,
  apexLat_deg: 10,
  apexLon_deg: 10,
  speedClass: 'C',
  isHalo: false,
  time21_5: '2024-05-10T02:00:00Z',
  enlilShockIso: '2024-05-11T02:00:00Z',
  enlilDurationH: 12,
  isEarthDirected: true,
  hasEnlilRun: true,
  predictedKp: 7,
  linkedEventIds,
  estMass_kg: 1e12,
  estIons: 1e39,
  link: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/CME',
});

const shock = (index: number, linkedEventIds: string[] = []): DonkiIps => ({
  id: `2024-05-11T00:00:00-IPS-${String(index).padStart(3, '0')}`,
  time: '2024-05-11T00:00:00Z',
  label: 'IPS shock at Earth',
  linkedEventIds,
  location: 'Earth',
  instruments: ['DSCOVR: PLASMAG'],
});

const storm = (index: number, linkedEventIds: string[] = []): DonkiGst => ({
  id: `2024-05-11T03:00:00-GST-${String(index).padStart(3, '0')}`,
  time: '2024-05-11T03:00:00Z',
  label: 'Geomagnetic storm Kp=8.0',
  linkedEventIds,
  observedKp: 8,
  allKpIndex: [{ observedTime: '2024-05-11T03:00:00Z', kpIndex: 8, source: 'GFZ' }],
});

describe('evaluatePredictions', () => {
  it('scores arrival and Kp errors only across exact DONKI graph links', () => {
    const event = cme(1);
    const observedShock = shock(1, [event.activityID]);
    const observedStorm = storm(1, [observedShock.id]);

    const result = evaluatePredictions([event], [observedShock], [observedStorm]);

    expect(result.arrivalN).toBe(1);
    expect(result.arrivalMaeHours).toBe(2);
    expect(result.arrivalBiasHours).toBe(2);
    expect(result.kpN).toBe(1);
    expect(result.kpMae).toBe(1);
    expect(result.kpBias).toBe(-1);
    expect(result.cases[0]).toMatchObject({
      cmeId: event.activityID,
      observedArrivalIso: observedShock.time,
      observedKp: 8,
    });
  });

  it('does not turn temporal coincidence into a labelled outcome', () => {
    const result = evaluatePredictions([cme(1)], [shock(1)], [storm(1)]);

    expect(result.arrivalN).toBe(0);
    expect(result.arrivalMaeHours).toBeNull();
    expect(result.kpN).toBe(0);
    expect(result.kpMae).toBeNull();
    expect(result.cases[0]?.observedArrivalIso).toBeNull();
    expect(result.cases[0]?.observedKp).toBeNull();
  });

  it('keeps residual calibration disabled until both heads have ten linked outcomes', () => {
    const events = Array.from({ length: 10 }, (_, index) => cme(index));
    const shocks = events.map((event, index) => shock(index, [event.activityID]));
    const storms = shocks.map((observedShock, index) => storm(index, [observedShock.id]));

    expect(evaluatePredictions(events.slice(0, 9), shocks, storms).calibrationReady).toBe(false);
    expect(evaluatePredictions(events, shocks, storms).calibrationReady).toBe(true);
  });
});
