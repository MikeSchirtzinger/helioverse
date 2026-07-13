import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  coneContainsEarth,
  darknessFactor,
  dbmArrival,
  dbmStep,
  dstStep,
  goLook,
  initPhysics,
  kpToG,
  l1DelaySeconds,
  newellCoupling,
  skyState,
} from './physics';

interface GoldenCase {
  name: string;
  inputs: Record<string, unknown>;
  expect: Record<string, unknown>;
}

interface GoldenFixture {
  vectors: Array<{
    function: string;
    cases: GoldenCase[];
  }>;
}

async function loadFixture(name: string): Promise<GoldenFixture> {
  const fixtureUrl = new URL(`../../../../contracts/fixtures/vectors/${name}`, import.meta.url);
  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as GoldenFixture;
}

function casesFor(fixture: GoldenFixture, functionName: string): GoldenCase[] {
  const vector = fixture.vectors.find((candidate) => candidate.function === functionName);
  if (!vector) {
    throw new Error(`golden fixture is missing ${functionName}`);
  }
  return vector.cases;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number') {
    throw new Error(`golden fixture field ${field} must be a number`);
  }
  return value;
}

function booleanField(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') {
    throw new Error(`golden fixture field ${field} must be a boolean`);
  }
  return value;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`golden fixture field ${field} must be a string`);
  }
  return value;
}

function optionalNumberField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'number') {
    throw new Error(`golden fixture field ${field} must be a number or null`);
  }
  return value;
}

function expectRelative(actual: number, expected: number, tolerance = 1e-9): void {
  const scale = Math.max(Math.abs(expected), 1);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * scale);
}

beforeAll(async () => {
  const wasmUrl = new URL('../wasm/helio-core/helio_core_bg.wasm', import.meta.url);
  await initPhysics(await readFile(wasmUrl));
});

describe('compiled helio-core WASM golden vectors', () => {
  it('propagates L1 delay availability through the WASM boundary', async () => {
    const fixture = await loadFixture('delay-correction.json');
    for (const testCase of casesFor(fixture, 'l1_delay_seconds')) {
      const actual = l1DelaySeconds(
        numberField(testCase.inputs, 'spacecraft_earth_distance_km'),
        numberField(testCase.inputs, 'measured_speed_kms'),
      );
      if ('error' in testCase.expect) {
        expect(actual, testCase.name).toBeNull();
      } else {
        expect(actual, testCase.name).not.toBeNull();
        if (actual !== null) {
          expectRelative(actual, numberField(testCase.expect, 'delay_s'));
        }
      }
    }
  });

  it('matches DBM propagation, arrival, and cone vectors', async () => {
    const fixture = await loadFixture('dbm.json');

    for (const testCase of casesFor(fixture, 'dbm_step')) {
      const tUnix = 123;
      const actual = dbmStep(
        {
          rKm: numberField(testCase.inputs, 'r_km'),
          vKms: numberField(testCase.inputs, 'v_kms'),
          tUnix,
        },
        {
          gammaPerKm: numberField(testCase.inputs, 'gamma_per_km'),
          ambientWindKms: numberField(testCase.inputs, 'ambient_wind_kms'),
        },
        numberField(testCase.inputs, 'dt_s'),
      );
      expectRelative(actual.rKm, numberField(testCase.expect, 'r_km'));
      expectRelative(actual.vKms, numberField(testCase.expect, 'v_kms'));
      expect(actual.tUnix, testCase.name).toBe(tUnix + numberField(testCase.inputs, 'dt_s'));
    }

    for (const testCase of casesFor(fixture, 'dbm_arrival')) {
      const actual = dbmArrival(
        {
          rKm: numberField(testCase.inputs, 'r_km'),
          vKms: numberField(testCase.inputs, 'v_kms'),
          tUnix: numberField(testCase.inputs, 't_unix'),
        },
        {
          gammaPerKm: numberField(testCase.inputs, 'gamma_per_km'),
          ambientWindKms: numberField(testCase.inputs, 'ambient_wind_kms'),
        },
        numberField(testCase.inputs, 'target_r_km'),
      );
      if ('error' in testCase.expect) {
        expect(actual, testCase.name).toBeNull();
      } else {
        expect(actual, testCase.name).not.toBeNull();
        if (actual) {
          expect(Math.abs(actual.tArrivalUnix - numberField(testCase.expect, 't_arrival_unix')))
            .toBeLessThanOrEqual(2);
          expectRelative(actual.vArrivalKms, numberField(testCase.expect, 'v_arrival_kms'), 1e-6);
        }
      }
    }

    for (const testCase of casesFor(fixture, 'cone_contains_earth')) {
      const actual = coneContainsEarth(
        numberField(testCase.inputs, 'apex_lon_deg'),
        numberField(testCase.inputs, 'apex_lat_deg'),
        numberField(testCase.inputs, 'half_angle_deg'),
        numberField(testCase.inputs, 'earth_helio_lon_deg'),
        numberField(testCase.inputs, 'earth_helio_lat_deg'),
        numberField(testCase.inputs, 'parker_offset_deg'),
      );
      expect(actual, testCase.name).toBe(booleanField(testCase.expect, 'contains'));
    }
  });

  it('matches coupling, Dst, and Kp vectors', async () => {
    const fixture = await loadFixture('coupling.json');

    for (const testCase of casesFor(fixture, 'newell_coupling')) {
      expectRelative(
        newellCoupling(
          numberField(testCase.inputs, 'v_kms'),
          numberField(testCase.inputs, 'by_nt'),
          numberField(testCase.inputs, 'bz_nt'),
        ),
        numberField(testCase.expect, 'coupling'),
      );
    }

    for (const testCase of casesFor(fixture, 'dst_step')) {
      expectRelative(
        dstStep(
          numberField(testCase.inputs, 'dst_nt'),
          numberField(testCase.inputs, 'v_kms'),
          numberField(testCase.inputs, 'bz_nt'),
          numberField(testCase.inputs, 'density_pcc'),
          numberField(testCase.inputs, 'dt_s'),
        ),
        numberField(testCase.expect, 'dst_next_nt'),
      );
    }

    for (const testCase of casesFor(fixture, 'kp_to_g')) {
      expect(kpToG(numberField(testCase.inputs, 'kp')), testCase.name)
        .toBe(numberField(testCase.expect, 'g'));
    }
  });

  it('matches astronomy vectors', async () => {
    const fixture = await loadFixture('astronomy.json');
    for (const testCase of casesFor(fixture, 'sky_state')) {
      const actual = skyState(
        numberField(testCase.inputs, 'lat_deg'),
        numberField(testCase.inputs, 'lon_deg'),
        numberField(testCase.inputs, 't_unix'),
      );
      expect(Math.abs(actual.sunAltDeg - numberField(testCase.expect, 'sun_alt_deg')))
        .toBeLessThanOrEqual(0.3);
      expect(Math.abs(actual.moonAltDeg - numberField(testCase.expect, 'moon_alt_deg')))
        .toBeLessThanOrEqual(0.5);
      expect(Math.abs(actual.moonIllumFrac - numberField(testCase.expect, 'moon_illum_frac')))
        .toBeLessThanOrEqual(0.02);
    }
  });

  it('matches darkness and go-look vectors', async () => {
    const fixture = await loadFixture('golook.json');

    for (const testCase of casesFor(fixture, 'darkness_factor')) {
      expectRelative(
        darknessFactor(numberField(testCase.inputs, 'sun_alt_deg')),
        numberField(testCase.expect, 'factor'),
      );
    }

    for (const testCase of casesFor(fixture, 'go_look')) {
      const actual = goLook({
        ovalVisibleProb: numberField(testCase.inputs, 'oval_visible_prob'),
        sunAltDeg: numberField(testCase.inputs, 'sun_alt_deg'),
        moonAltDeg: numberField(testCase.inputs, 'moon_alt_deg'),
        moonIllumFrac: numberField(testCase.inputs, 'moon_illum_frac'),
        cloudTotalConsensus: numberField(testCase.inputs, 'cloud_total_consensus'),
        cloudLowConsensus: numberField(testCase.inputs, 'cloud_low_consensus'),
        cloudModelSpread: numberField(testCase.inputs, 'cloud_model_spread'),
        satelliteClearNow: optionalNumberField(testCase.inputs, 'satellite_clear_now'),
      });
      expectRelative(actual.score, numberField(testCase.expect, 'score'));
      expectRelative(actual.confidence, numberField(testCase.expect, 'confidence'));
      expect(actual.verdict, testCase.name).toBe(stringField(testCase.expect, 'verdict'));
      expect(actual.dominantLimiter, testCase.name)
        .toBe(stringField(testCase.expect, 'dominant_limiter'));
    }
  });
});
