/**
 * delay-correction.ts — The spec §2.1 L1→Earth real-delay correction
 *
 * Ballistic: delay_s = distance_km / speed_kms.
 * When the plasma speed is out of range or missing, the caller falls back
 * to the fixed 1800-s delay and labels the forecast "degraded."
 *
 * PINNED semantics (match formulas.py l1_delay_seconds() exactly):
 * - distance valid range: [1.2e6, 1.8e6] km
 * - speed valid range: [200.0, 3000.0] km/s
 */

export const FIXED_FALLBACK_DELAY_S = 1800.0;
export const DISTANCE_MIN_KM = 1.2e6;
export const DISTANCE_MAX_KM = 1.8e6;
export const SPEED_MIN_KMS = 200.0;
export const SPEED_MAX_KMS = 3000.0;

export class OutOfRangeError extends Error {
  constructor(param: string) {
    super(`OutOfRange: ${param}`);
    this.name = "OutOfRangeError";
  }
}

/**
 * Compute the real L1→Earth propagation delay from the measured bulk speed.
 *
 * Returns delay in seconds, or throws OutOfRangeError if distance or speed
 * is outside the pinned validity range (caller then uses FIXED_FALLBACK_DELAY_S
 * with delay_quality = "degraded_fixed").
 */
export function l1DelaySeconds(
  spacecraftEarthDistanceKm: number,
  measuredSpeedKms: number,
): number {
  if (
    spacecraftEarthDistanceKm < DISTANCE_MIN_KM ||
    spacecraftEarthDistanceKm > DISTANCE_MAX_KM
  ) {
    throw new OutOfRangeError("spacecraftEarthDistanceKm");
  }
  if (measuredSpeedKms < SPEED_MIN_KMS || measuredSpeedKms > SPEED_MAX_KMS) {
    throw new OutOfRangeError("measuredSpeedKms");
  }
  return spacecraftEarthDistanceKm / measuredSpeedKms;
}

/**
 * Compute the effective L1 delay from snapshot data.
 *
 * Returns the delay_s and delay_quality, preferring the snapshot's
 * pre-computed value when it's marked "measured", falling back to our
 * own computation, and finally to the fixed fallback.
 */
export interface DelayResult {
  delayS: number;
  delayQuality: "measured" | "degraded_fixed";
  arrivingNowMeasuredAt: string; // ISO 8601
}

export function computeDelay(
  snapshotDelayS: number,
  snapshotDelayQuality: "measured" | "degraded_fixed",
  snapshotArrivingNowMeasuredAt: string,
  spacecraftDistanceKm: number,
  measuredSpeedKms: number | null,
): DelayResult {
  // Trust the snapshot's pre-computed delay if it's measured
  if (snapshotDelayQuality === "measured") {
    return {
      delayS: snapshotDelayS,
      delayQuality: "measured",
      arrivingNowMeasuredAt: snapshotArrivingNowMeasuredAt,
    };
  }

  // Try computing ourselves from the measured speed
  if (measuredSpeedKms !== null) {
    try {
      const delay = l1DelaySeconds(spacecraftDistanceKm, measuredSpeedKms);
      // Compute approximate arriving_now by shifting l1_measured_at
      // (the caller has the timestamp; we just return the delay)
      return {
        delayS: delay,
        delayQuality: "measured",
        arrivingNowMeasuredAt: "", // caller fills
      };
    } catch {
      // fall through to degraded
    }
  }

  // Degraded fallback
  return {
    delayS: FIXED_FALLBACK_DELAY_S,
    delayQuality: "degraded_fixed",
    arrivingNowMeasuredAt: snapshotArrivingNowMeasuredAt,
  };
}

/**
 * Format the delay as a human-readable label.
 */
export function formatDelayHours(delayS: number): string {
  const mins = Math.round(delayS / 60);
  if (mins < 60) {
    return `${mins} min`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
