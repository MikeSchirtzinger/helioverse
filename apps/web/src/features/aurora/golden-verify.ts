/**
 * aurora golden-vector verification script
 *
 * Run: npx tsx apps/web/src/features/aurora/golden-verify.ts
 *
 * Tests that our TypeScript re-implementations match the pinned golden vectors
 * from contracts/fixtures/vectors/ to the stated tolerances.
 *
 * This is a machine-runnable verification harness per spec §11.1.
 */

import { goLook, darknessFactor } from './go-look';
import { l1DelaySeconds } from './delay-correction';
import golookVectors from '../../../../../contracts/fixtures/vectors/golook.json';
import delayVectors from '../../../../../contracts/fixtures/vectors/delay-correction.json';

interface VectorBlock {
  function: string;
  tolerance: { type: string; value?: number };
  cases: Array<{ name: string; inputs: Record<string, unknown>; expect: Record<string, unknown> }>;
}

let failures = 0;
let passed = 0;

function close(a: number, b: number, tolType: string, tolVal?: number): boolean {
  if (tolType === 'exact') return a === b;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-300);
  return Math.abs(a - b) / denom <= (tolVal ?? 1e-9);
}

function runCase(
  vf: string,
  fn: string,
  caseName: string,
  expect: Record<string, unknown>,
  got: Record<string, unknown>,
  tolType: string,
  tolVal?: number,
) {
  for (const key of Object.keys(expect)) {
    const ev = expect[key];
    const gv = got[key];
    if (typeof ev === 'boolean' || typeof ev === 'string' || ev === null) {
      if (ev !== gv) {
        console.log(`  FAIL  ${vf}:${fn}:${caseName}:${key}: expect ${JSON.stringify(ev)}, got ${JSON.stringify(gv)}`);
        failures++;
      } else {
        passed++;
      }
    } else if (typeof ev === 'number' && typeof gv === 'number') {
      if (!close(gv, ev, tolType, tolVal)) {
        console.log(`  FAIL  ${vf}:${fn}:${caseName}:${key}: expect ${ev}, got ${gv}`);
        failures++;
      } else {
        passed++;
      }
    } else {
      if (JSON.stringify(ev) !== JSON.stringify(gv)) {
        console.log(`  FAIL  ${vf}:${fn}:${caseName}:${key}: expect ${JSON.stringify(ev)}, got ${JSON.stringify(gv)}`);
        failures++;
      } else {
        passed++;
      }
    }
  }
}

// ---- darkness_factor ----
console.log('=== go_look — darkness_factor ===');
for (const block of golookVectors.vectors as VectorBlock[]) {
  if (block.function !== 'darkness_factor') continue;
  for (const c of block.cases) {
    const got = { factor: darknessFactor(c.inputs.sun_alt_deg as number) };
    runCase('golook.json', block.function, c.name, c.expect as Record<string, unknown>, got, block.tolerance.type, block.tolerance.value);
  }
}

// ---- go_look ----
console.log('=== go_look ===');
for (const block of golookVectors.vectors as VectorBlock[]) {
  if (block.function !== 'go_look') continue;
  for (const c of block.cases) {
    const i = c.inputs as Record<string, unknown>;
    const result = goLook({
      ovalVisibleProb: i.oval_visible_prob as number,
      sunAltDeg: i.sun_alt_deg as number,
      moonAltDeg: i.moon_alt_deg as number,
      moonIllumFrac: i.moon_illum_frac as number,
      cloudTotalConsensus: i.cloud_total_consensus as number,
      cloudLowConsensus: i.cloud_low_consensus as number,
      cloudModelSpread: i.cloud_model_spread as number,
      satelliteClearNow: i.satellite_clear_now as number | null,
    });
    const got = {
      score: result.score,
      verdict: result.verdict,
      confidence: result.confidence,
      dominant_limiter: result.dominantLimiter,
    };
    const exp = c.expect as Record<string, unknown>;
    // Map key names
    const expMapped: Record<string, unknown> = {
      score: exp.score,
      verdict: exp.verdict,
      confidence: exp.confidence,
      dominant_limiter: exp.dominant_limiter,
    };
    runCase('golook.json', block.function, c.name, expMapped, got, block.tolerance.type, block.tolerance.value);
  }
}

// ---- l1_delay_seconds ----
console.log('=== delay-correction — l1_delay_seconds ===');
for (const block of delayVectors.vectors as VectorBlock[]) {
  for (const c of block.cases) {
    const i = c.inputs as Record<string, unknown>;
    try {
      const delay = l1DelaySeconds(i.spacecraft_earth_distance_km as number, i.measured_speed_kms as number);
      const got = { delay_s: delay };
      runCase('delay-correction.json', block.function, c.name, c.expect as Record<string, unknown>, got, block.tolerance.type, block.tolerance.value);
    } catch (e: unknown) {
      const got = { error: (e as Error).message.includes('OutOfRange') ? 'OutOfRange' : (e as Error).message };
      runCase('delay-correction.json', block.function, c.name, c.expect as Record<string, unknown>, got, 'exact');
    }
  }
}

console.log();
if (failures > 0) {
  console.log(`GOLDEN VERIFY RED — ${failures} failure(s), ${passed} passed`);
  process.exit(1);
}
console.log(`GOLDEN VERIFY GREEN — ${passed} assertions passed, 0 failures`);
