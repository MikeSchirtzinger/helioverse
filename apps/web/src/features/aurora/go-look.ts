/**
 * go-look.ts — Pinned "go look" score implementation
 *
 * Matches contracts/tests/formulas.py go_look() exactly. This is a
 * temporary TypeScript re-implementation of the pinned contract semantics;
 * the canonical implementation lives in crates/helio-core (WASM).
 *
 * Do NOT tune constants — changing any constant requires regenerating
 * golden vectors in contracts/fixtures/vectors/golook.json.
 */

/**
 * Darkness factor for aurora visibility.
 * PINNED: clamp((−6 − sun_alt_deg) / 12, 0, 1)
 * => 0 at civil twilight or brighter (alt >= −6), 1 at astronomical dark (alt <= −18),
 * linear ramp between.
 */
export function darknessFactor(sunAltDeg: number): number {
  return clamp((-6 - sunAltDeg) / 12, 0, 1);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ----------------------------------------------------------------
// GoLookInputs — matches the WASM crate's GoLookInputs struct
// ----------------------------------------------------------------

export interface GoLookInputs {
  /** Visible-aurora probability 0..1 at the user's location, sampled from the
   * delay-corrected OVATION grid. */
  ovalVisibleProb: number;
  sunAltDeg: number;
  moonAltDeg: number;
  /** Illuminated fraction of the lunar disk, 0..1. */
  moonIllumFrac: number;
  /** Multi-model consensus means, 0..1 (Open-Meteo, spec §3.6). */
  cloudTotalConsensus: number;
  /** Low cloud weighted heaviest — it's what actually blocks aurora. */
  cloudLowConsensus: number;
  /** Cross-model disagreement 0..1 (0 = all models agree). */
  cloudModelSpread: number;
  /** GOES CSM Tier-0 point answer, 0..1 clear; null when the leg is unavailable. */
  satelliteClearNow: number | null;
}

export type Verdict = "Likely" | "Possible" | "Unlikely";
export type Limiter =
  | "Daylight"
  | "Oval"
  | "CloudObserved"
  | "CloudForecast"
  | "Moon";

export interface GoLookScore {
  score: number;
  verdict: Verdict;
  confidence: number;
  /** The factor that most limits tonight — drives "why it might be wrong" (spec §8.6). */
  dominantLimiter: Limiter;
}

const LIMITER_ORDER: Limiter[] = [
  "Daylight",
  "Oval",
  "CloudObserved",
  "CloudForecast",
  "Moon",
];

/**
 * The on-device "go look" score. v1.0 heuristic.
 *
 * PINNED formulas (match formulas.py go_look() exactly):
 *   darkness     = darkness_factor(sun_alt_deg)
 *   moon_factor  = 1 − 0.6 · moon_illum_frac · clamp(sin(moon_alt_deg·π/180), 0, 1)
 *   clear_fcst   = clamp(1 − (0.7·cloud_low + 0.3·cloud_total), 0, 1)
 *   clear        = satellite_clear_now is null ? clear_fcst : 0.5·clear_fcst + 0.5·sat
 *   score        = oval_visible_prob · darkness · moon_factor · clear
 *   confidence   = (1 − cloud_model_spread) · (sat leg missing ? 0.85 : 1.0)
 *   verdict      = score >= 0.30 → Likely; >= 0.10 → Possible; else Unlikely
 *   limiter      = argmin over factors {Daylight: darkness, Oval: oval_visible_prob,
 *                   CloudObserved: sat-or-1.0, CloudForecast: clear_fcst, Moon: moon_factor}
 *                   ties broken by enum order.
 */
export function goLook(inputs: GoLookInputs): GoLookScore {
  const darkness = darknessFactor(inputs.sunAltDeg);
  const moonFactor =
    1.0 -
    0.6 *
      inputs.moonIllumFrac *
      clamp(Math.sin(toRadians(inputs.moonAltDeg)), 0, 1);

  const clearFcst = clamp(
    1.0 - (0.7 * inputs.cloudLowConsensus + 0.3 * inputs.cloudTotalConsensus),
    0,
    1,
  );

  let clear: number;
  let confidence: number;
  if (inputs.satelliteClearNow === null) {
    clear = clearFcst;
    confidence = (1.0 - inputs.cloudModelSpread) * 0.85;
  } else {
    clear = 0.5 * clearFcst + 0.5 * inputs.satelliteClearNow;
    confidence = (1.0 - inputs.cloudModelSpread) * 1.0;
  }

  const score = inputs.ovalVisibleProb * darkness * moonFactor * clear;

  let verdict: Verdict;
  if (score >= 0.3) {
    verdict = "Likely";
  } else if (score >= 0.1) {
    verdict = "Possible";
  } else {
    verdict = "Unlikely";
  }

  const factors: Record<Limiter, number> = {
    Daylight: darkness,
    Oval: inputs.ovalVisibleProb,
    CloudObserved: inputs.satelliteClearNow ?? 1.0,
    CloudForecast: clearFcst,
    Moon: moonFactor,
  };

  const best = Math.min(...Object.values(factors));
  const dominantLimiter =
    LIMITER_ORDER.find((k) => factors[k] === best) ?? "Oval";

  return { score, verdict, confidence, dominantLimiter };
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}
