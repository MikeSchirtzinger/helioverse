/**
 * scene/cme-style.ts — Data-driven CME visual encodings.
 *
 * Two pure mappings so every CME's *appearance* encodes a measured/estimated
 * quantity rather than a decorative flag:
 *   • colour  = measured launch speed   (`event.speed_kms`)
 *   • size    = estimated ejected mass  (`event.mass_kg`, derived from width)
 *
 * The colour ramp is an incandescence (black-body) ordering — deep red (slow)
 * → orange → white-hot (fast) — with monotonically rising lightness so a fast
 * CME reads as "hot/bright" and a slow one as "cool/dim" even in greyscale.
 * Green is deliberately avoided: it is reserved app-wide for auroral emission.
 * Shared by `createCmeVisuals` (cloud/cone/glow tint), the DOM label accent in
 * `HelioCanvas`, and the true-scale `MiniMap`.
 */

import * as THREE from 'three';
import type { CmeEventData } from './types';
import { clamp } from './canvas-helpers';
import { estimateCmeMassKg } from './donki-feeds';

interface SpeedStop {
  /** km/s anchor. */
  s: number;
  /** HSL hue 0..1. */
  h: number;
  /** HSL saturation 0..1. */
  sat: number;
  /** HSL lightness 0..1 — rises with speed for greyscale separability. */
  light: number;
}

/**
 * Speed → HSL anchors, incandescence-ordered (Planck/black-body ramp):
 * deep red (slow/cool) → red-orange → orange → amber → white-hot (fast/hot).
 * Lightness increases monotonically across the ramp for greyscale separability.
 *
 * PROVENANCE: colour encodes the MEASURED launch speed (DONKI `speed`), NOT a
 * temperature — the black-body ordering is a legibility choice (faster reads
 * hotter/brighter), not a claim that the CME is literally that colour-temperature.
 *
 * Why black-body and not the old blue→green→orange ramp: green is RESERVED
 * across Helioverse for auroral emission (557.7 nm). A CME passing through
 * green on its speed ramp collided with aurora-green, especially near Earth
 * where a green CME sprite reads as aurora. The incandescence ramp stays in
 * red→orange→white and never touches auroral green (SpaceWeather prime
 * directive: one colour = one meaning).
 *   ≤ 350 km/s  deep red
 *   ~ 700 km/s  red-orange
 *   ~ 1000 km/s orange
 *   ~ 1300 km/s amber
 *   ≥ 1650 km/s white-hot
 */
const SPEED_STOPS: readonly SpeedStop[] = [
  { s: 350, h: 0.0, sat: 0.85, light: 0.38 },
  { s: 700, h: 0.03, sat: 0.85, light: 0.46 },
  { s: 1000, h: 0.07, sat: 0.88, light: 0.53 },
  { s: 1300, h: 0.11, sat: 0.8, light: 0.62 },
  { s: 1650, h: 0.13, sat: 0.25, light: 0.9 },
];

/** Three.Color encoding a CME's measured launch speed (km/s). */
export function cmeSpeedColor(speed: number): THREE.Color {
  const first = SPEED_STOPS[0]!;
  const last = SPEED_STOPS[SPEED_STOPS.length - 1]!;
  const v = clamp(speed, first.s, last.s);

  let lo = first;
  let hi = last;
  for (let i = 0; i < SPEED_STOPS.length - 1; i += 1) {
    const a = SPEED_STOPS[i]!;
    const b = SPEED_STOPS[i + 1]!;
    if (v >= a.s && v <= b.s) {
      lo = a;
      hi = b;
      break;
    }
  }

  const t = hi.s === lo.s ? 0 : (v - lo.s) / (hi.s - lo.s);
  return new THREE.Color().setHSL(
    lo.h + (hi.h - lo.h) * t,
    lo.sat + (hi.sat - lo.sat) * t,
    lo.light + (hi.light - lo.light) * t,
  );
}

/** Hex int form of {@link cmeSpeedColor} (for three.js material colours). */
export function cmeSpeedColorHex(speed: number): number {
  return cmeSpeedColor(speed).getHex();
}

/** `#rrggbb` CSS form of {@link cmeSpeedColor} (for DOM labels + SVG minimap). */
export function cmeSpeedColorCss(speed: number): string {
  return `#${cmeSpeedColorHex(speed).toString(16).padStart(6, '0')}`;
}

/** Resolve a CME's estimated mass (kg), deriving it from angular width when needed. */
export function cmeMassKg(event: CmeEventData): number {
  return event.mass_kg ?? estimateCmeMassKg(event.halfAngle_deg, event.isHalo);
}

/**
 * Mass (kg) → a baseline size multiplier (~0.6 small … ~1.8 big halo). Log scale
 * across the literature CME mass band (~1e11 narrow → 3e13 halo) so a heavy CME
 * looks visibly larger than a light one at launch.
 */
export function cmeMassScale(massKg: number): number {
  const lo = 11; // log10(1e11)
  const hi = Math.log10(3e13); // ≈ 13.48
  const norm = clamp((Math.log10(Math.max(1e10, massKg)) - lo) / (hi - lo), 0, 1);
  return 0.6 + norm * 1.2;
}
