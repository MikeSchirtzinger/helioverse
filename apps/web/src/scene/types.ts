/**
 * scene/types.ts — Pure TypeScript types for the runtime scene.
 *
 * All types are statically inspectable by tsc -b --noEmit.
 * No runtime imports from three.js — only type-level references
 * to @types/three are used (import type).
 */

// ---------------------------------------------------------------------------
// Scale mode
// ---------------------------------------------------------------------------

/** Scene distance scale: linear AU or disclosed logarithmic heliocentric distance. */
export type ScaleMode = 'true' | 'compressed';

// ---------------------------------------------------------------------------
// WebGPU / WebGL2 detection
// ---------------------------------------------------------------------------

export interface GpuDetection {
  /** Whether navigator.gpu was present and a GPUAdapter was obtained. */
  webgpu: boolean;
  /** Whether a WebGL2RenderingContext is available. */
  webgl2: boolean;
  /** The selected renderer path: 'webgpu' | 'webgl2' | 'none'. */
  path: 'webgpu' | 'webgl2' | 'none';
  /** Name reported by the GPU adapter or WebGL renderer string. */
  rendererInfo: string | null;
}

// ---------------------------------------------------------------------------
// Heliographic coordinate system (Stonyhurst)
// ---------------------------------------------------------------------------

/**
 * A point in heliographic Stonyhurst coordinates.
 * - lon_deg: 0 = Sun-Earth line, +west.
 * - lat_deg: ±90 poles.
 * - r_km: radial distance from solar centre.
 */
export interface HelioPoint {
  lon_deg: number;
  lat_deg: number;
  r_km: number;
}

// ---------------------------------------------------------------------------
// Scene object descriptors (data, not three.js objects)
// ---------------------------------------------------------------------------

export interface SunData {
  /** Heliographic origin (always 0,0,0). */
  position: HelioPoint;
  /** Radius in km (contract: SUN_RADIUS_KM = 695 700). */
  radius_km: number;
  /** Active SDO wavelength label (304/193/HMI) or null when unavailable. */
  activeWavelength: string | null;
}

export interface EarthData {
  /** Heliographic position at the given epoch. */
  position: HelioPoint;
  /** Physical radius in km (6371). */
  radius_km: number;
  /** Earth heliographic longitude at epoch. */
  epoch_unix: number;
}

export interface L1Data {
  /** Heliographic position of the active upstream L1 monitor. */
  position: HelioPoint;
  /** Spacecraft name. */
  spacecraft: string;
  /** Distance from Earth centre in km. */
  earthDistance_km: number;
}

export interface ParkerGridData {
  /** Heliographic field-line points (polyline vertex arrays). */
  spirals: HelioPoint[][];
  /** Solar wind speed used for the spiral computation (km/s). */
  speed_kms: number;
  /** Solar rotation period used (seconds). */
  rotation_period_s: number;
}

/** A normalized CME event from DONKI or the curated historical replay. */
export interface CmeEventData {
  /** DONKI-style event ID. */
  id: string;
  /** Apex source heliographic position. */
  sourcePosition: HelioPoint;
  /** Speed at liftoff (km/s). */
  speed_kms: number;
  /** Half-angle of the cone (degrees). */
  halfAngle_deg: number;
  /** Is this a halo CME? */
  isHalo: boolean;
  /** Earth-bound score 0..1. */
  earthBoundScore: number;
  /**
   * Ejected mass (kg) — ESTIMATED (DONKI carries no mass; derived from angular
   * width via the CME mass–width relation). Optional: the live path passes
   * `DonkiCme.estMass_kg`; historical replay data may carry the same documented
   * width-derived estimate.
   * Drives the CME's baseline render size (mass → size).
   */
  mass_kg?: number;
  /** Epoch of liftoff (unix seconds). */
  liftoff_unix: number;
  /**
   * Measured time the front crossed 21.5 R_sun ≈ 0.1 AU (unix seconds), from
   * DONKI's `time21_5`. Anchors the near-Sun leg; when absent the propagation
   * model derives it from the measured launch speed.
   */
  time21_5_unix?: number | null;
  /** Current (propagated) front position, or null if not yet computed. */
  frontPosition: HelioPoint | null;
  /** Arrival window (unix seconds), or null if not yet predicted. */
  arrivalWindow: { start: number; eta: number; end: number } | null;
  /**
   * WSA-Enlil predicted Kp index (0–9) for this CME's Earth impact. Optional:
   * present when the DONKI Enlil run has a kp_* field; absent for replay CMEs
   * or when no Enlil run was made. Used only in labelled model readouts.
   * PROVENANCE: WSA-Enlil, modelled.
   */
  predictedKp?: number | null;
  /**
   * WSA-Enlil predicted CME transit duration at Earth (hours). Optional: present
   * when DONKI has an Enlil run with `estimatedDuration`. Used for band-thickness
   * in the particle cloud (speed × duration = band depth). PROVENANCE: WSA-Enlil, modelled.
   */
  enlilDurationH?: number | null;
}

// ---------------------------------------------------------------------------
// Camera state
// ---------------------------------------------------------------------------

/** Orbital camera state. Angles are degrees; distance in scene units. */
export interface CameraState {
  /** Azimuthal angle (rotation around the scene vertical axis). */
  azimuth_deg: number;
  /** Polar/elevation angle (0 = equatorial plane, 90 = north pole). */
  polar_deg: number;
  /** Distance from the look-at target (scene units). */
  distance: number;
  /** Point the camera is looking at (heliographic). */
  target: HelioPoint;
}

/** Scale toggle state bundled with the current scale transform. */
export interface ScaleState {
  mode: ScaleMode;
  /** Convert true heliocentric distance (km) to scene units. */
  toSceneUnits: (r_km: number) => number;
  /** Convert scene units back to true distance (km). */
  toTrueKm: (sceneUnits: number) => number;
}

// ---------------------------------------------------------------------------
// Screenshot result
// ---------------------------------------------------------------------------

export interface ScreenshotResult {
  /** Data URL (PNG) of the current canvas contents. */
  dataUrl: string;
  /** Width/height of the captured image. */
  width: number;
  height: number;
  /** ISO-8601 timestamp of capture. */
  capturedAt: string;
}
