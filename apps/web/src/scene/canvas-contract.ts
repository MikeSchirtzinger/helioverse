import type { CmeEventData, ScaleMode } from './types';
import type { SceneFoundation } from './scene-data';

// ─── SWPC Live L1 Data Contract ──────────────────────────────────────────────

/**
 * One point from the OVATION Prime aurora probability grid.
 * Source: ovation_aurora_latest.json `coordinates` array.
 *   lon  — geographic longitude, 0–359 °
 *   lat  — geographic latitude, −90 to +90 ° (positive = northern hemisphere)
 *   prob — aurora probability, 0–100 %
 */
export interface AuroraGridPoint {
  lon: number;
  lat: number;
  prob: number;
}

/**
 * Snapshot of real-time NOAA SWPC L1 and aurora data.
 *
 * All fields are optional / nullable — they degrade gracefully when the SWPC
 * endpoint is unreachable or a column is missing in the response.
 *
 * Source feeds (no new fetches — all fields come from already-requested responses):
 *
 * rtsw_mag_1m.json (array of spacecraft rows; select active + newest time_tag)
 *   bx_gsm  → bx     (nT, GSM)
 *   by_gsm  → by     (nT, GSM)
 *   bz_gsm  → bz_nt  (nT, GSM)   ← existing field
 *   bt      → bt     (nT, total IMF magnitude)
 *
 * rtsw_wind_1m.json (array of spacecraft rows; select active + newest time_tag)
 *   proton_density     → density      (protons/cm³)
 *   proton_speed       → speed_kms    (km/s)             ← existing field
 *   proton_temperature → temperature  (K, proton temp)
 *
 * planetary_k_index_1m.json  → kp  (0–9 estimated)      ← existing field
 *
 * ovation_aurora_latest.json
 *   equatorward edge scalar  → auroraEdgeLatDeg           ← existing field
 *   full coordinates array   → auroraGrid  (≈65,160 points, both hemispheres)
 */
export interface SwpcNow {
  // ── Existing fields (unchanged) ──────────────────────────────────────────
  /** Estimated planetary Kp (0–9), 1-minute cadence. */
  kp: number | null;
  /** Southward IMF Bz in nT, GSM frame (negative drives geomagnetic storms). */
  bz_nt: number | null;
  /** Solar wind bulk speed (km/s). */
  speed_kms: number | null;
  /** Equatorward edge of meaningful aurora (geographic latitude, degrees). */
  auroraEdgeLatDeg: number | null;

  // ── IMF fields from the active NOAA RTSW magnetic row ────────────────────
  /** IMF X component in nT, GSM frame (anti-sunward). */
  bx?: number | null;
  /** IMF Y component in nT, GSM frame (dusk-dawn). */
  by?: number | null;
  /** Total IMF magnitude in nT. */
  bt?: number | null;

  // ── Plasma fields from the active NOAA RTSW wind row ─────────────────────
  /** Solar wind proton number density (protons/cm³). */
  density?: number | null;
  /** Solar wind proton temperature (K). */
  temperature?: number | null;

  // ── Full OVATION aurora probability grid ─────────────────────────────────
  /**
   * Complete OVATION Prime aurora probability grid (~65,160 points).
   * Both hemispheres: lat > 0 = northern, lat < 0 = southern.
   * units: lon [0–359 °], lat [−90..+90 °], prob [0–100 %].
   * Source: ovation_aurora_latest.json `coordinates` array (already fetched).
   * null when fetch failed or grid was absent in response.
   */
  auroraGrid?: AuroraGridPoint[] | null;

  // ── Reward / label feeds (ENG-1 extension) ───────────────────────────────
  /**
   * Kyoto Dst ring-current index (nT). Negative = ring-current storm injection.
   * Source: services.swpc.noaa.gov/products/kyoto-dst.json (SWPC proxy, CORS-open).
   * Cadence: 1-hour provisional values. null on failure.
   */
  dst_nt?: number | null;
  /**
   * ISO UTC timestamp of the latest Dst measurement row taken from the response.
   * Format: YYYY-MM-DD HH:MM:SS (UTC, as provided by SWPC).
   */
  dst_measured_at?: string | null;
  /**
   * GFZ Potsdam Hp30 index (30-min high-cadence Kp variant, 0–9+ scale).
   * Source: kp.gfz.de/app/json/ via /gfz proxy (CORS issue; key-free CC-BY-4.0).
   * Cadence: 30-minute nowcast. null on failure.
   */
  hp30?: number | null;
  /**
   * ISO UTC timestamp of the latest Hp30 nowcast row taken from the GFZ response.
   * Format: ISO 8601 string as returned by GFZ datetime array.
   */
  hp30_measured_at?: string | null;

  // ── Source clocks + current spacecraft (SCN 26-21 RTSW migration) ──────────
  /** UTC timestamp carried by the selected active RTSW magnetometer row. */
  mag_measured_at?: string | null;
  /** Spacecraft/source string carried by that row (currently SOLAR1/ACE/IMAP). */
  mag_source?: string | null;
  /** NOAA RTSW numeric quality flag for the selected magnetic row. */
  mag_quality?: number | null;
  /** UTC timestamp carried by the selected active RTSW plasma row. */
  plasma_measured_at?: string | null;
  /** Spacecraft/source string carried by that row. */
  plasma_source?: string | null;
  /** NOAA RTSW numeric quality flag for the selected plasma row. */
  plasma_quality?: number | null;
  /** Timestamp of the selected 1-minute estimated-Kp row. */
  kp_measured_at?: string | null;
  /** OVATION input observation time and output forecast time. */
  ovation_observed_at?: string | null;
  ovation_forecast_at?: string | null;
  /** Per-feed truth state; unavailable never falls through to synthetic data. */
  feed_status?: {
    mag: 'ok' | 'unavailable';
    plasma: 'ok' | 'unavailable';
    kp: 'ok' | 'unavailable';
    ovation: 'ok' | 'unavailable';
    dst: 'ok' | 'unavailable';
    hp30: 'ok' | 'unavailable';
  };
}

export type CanvasRendererPath = 'webgpu' | 'webgl2' | 'none' | 'initializing';

export type CanvasInteractionMode = 'orbit' | 'inspect' | 'follow-event' | 'earth-impact' | 'magnetosphere';

/** NASA/SWPC-style solar observation channels the Sun can be rendered through. */
export type SolarFilter = 'visible' | 'sdo304' | 'sdo171' | 'sdo193' | 'sdo211' | 'magnetogram';

export interface HelioCanvasCapability {
  path: CanvasRendererPath;
  label: string;
  detail: string;
  isHardwareAccelerated: boolean;
}

/** Toggleable scene layers. Defaults keep the "distracting" cone + field lines off. */
export interface CanvasLayers {
  /** Sun's Parker-spiral magnetic field lines. */
  magneticField: boolean;
  /** Translucent CME angular-width envelope. */
  cmeCone: boolean;
  /** Planet orbit rings. */
  orbits: boolean;
  /** Planet / Sun / Earth / event name labels. */
  labels: boolean;
  /** Real SDO/Helioviewer Sun imagery for the selected time. */
  realImagery: boolean;
  /** Tracked bounding box + name around the travelling CME. */
  boundingBox: boolean;
}

export type CanvasLayerKey = keyof CanvasLayers;

export interface HelioCanvasControls {
  scaleMode: ScaleMode;
  interactionMode: CanvasInteractionMode;
  solarFilter?: SolarFilter;
  reducedMotion?: boolean;
  /** Master-clock time the scene renders (unix seconds). */
  timeUnix?: number;
  /** Layer visibility. */
  layers?: CanvasLayers;
}

export const DEFAULT_CANVAS_LAYERS: CanvasLayers = {
  magneticField: false,
  cmeCone: false,
  orbits: true,
  labels: true,
  realImagery: true,
  boundingBox: false,
};

export const CANVAS_LAYERS: Array<{ key: CanvasLayerKey; label: string; hint: string }> = [
  { key: 'realImagery', label: 'Real Sun', hint: 'Texture the Sun with live SDO / Helioviewer imagery for the selected time.' },
  { key: 'cmeCone', label: 'CME envelope', hint: 'Show the measured DONKI angular-width envelope; this is geometry, not a calibrated probability.' },
  { key: 'magneticField', label: 'Field lines', hint: 'Show modelled Parker geometry parameterized by the current measured L1 speed; it is not a global measurement.' },
  { key: 'boundingBox', label: 'Front data', hint: 'Show a measured readout on each CME front — angular width (DONKI) + modelled leading-edge distance (AU).' },
  { key: 'orbits', label: 'Orbits', hint: 'Show the planet orbit rings.' },
  { key: 'labels', label: 'Labels', hint: 'Show planet, Sun, Earth and event-name labels.' },
  // A global particle tunnel was removed: one local L1 sample cannot support
  // Sun→Earth-wide structure. Speed remains available to the labelled Parker,
  // L1-delay, Shue, and Newell model surfaces.
];

/** One renderable CME: the kinematics plus a display label and tint. */
export interface CanvasCme {
  event: CmeEventData;
  label: string;
  color: number;
}

export interface HelioCanvasProps {
  scene: SceneFoundation;
  /** All CMEs in the scenario — each rendered as its own travelling front. */
  cmes: CanvasCme[];
  /** The dominant CME that drives the camera-follow target. */
  primaryEventId?: string | null;
  /** Currently selected flare/CME id (highlights its box). */
  selectedEventId?: string | null;
  /** Fired when a CME front / source beacon is clicked on the canvas. */
  onSelectEvent?: (eventId: string | null) => void;
  controls: HelioCanvasControls;
  className?: string;
  labelledBy?: string;
  describedBy?: string;
  onCapabilityChange?: (capability: HelioCanvasCapability) => void;
  /**
   * Live OVATION aurora probability grid (~65,160 points, both hemispheres).
   * When non-empty, ENG-A's canvas renders a DataTexture heatmap on the globe.
   * When absent/empty, the heatmap is hidden and an unavailable label is shown.
   * Shape matches AuroraGridPoint from swpc-feeds / canvas-contract.
   */
  auroraGrid?: AuroraGridPoint[] | null;
}

export interface HelioCanvasSnapshot {
  activeEventId: string | null;
  rendererPath: CanvasRendererPath;
  scaleMode: ScaleMode;
  interactionMode: CanvasInteractionMode;
}

export const CANVAS_INTERACTION_MODES: Array<{ mode: CanvasInteractionMode; label: string; hint: string }> = [
  { mode: 'orbit', label: 'System', hint: 'Drag to orbit the eight-planet solar system; wheel to zoom.' },
  { mode: 'inspect', label: 'Inspect', hint: 'Hold focus on Earth, L1, and active CME readouts.' },
  { mode: 'follow-event', label: 'Follow CME', hint: 'Bias the camera toward the Earth-bound CME shell.' },
  { mode: 'earth-impact', label: 'Earth impact', hint: 'Zoom to Earth: predicted strike footprint, aurora oval, and arrival window.' },
  { mode: 'magnetosphere', label: 'Magnetosphere', hint: 'Magnetopause compression & Van Allen belts: watch the boundary push inside geosynchronous orbit.' },
];

export const SOLAR_FILTERS: Array<{ id: SolarFilter; label: string; hint: string }> = [
  { id: 'visible', label: 'Visible', hint: 'White-light photosphere — the Sun as the eye sees it.' },
  { id: 'sdo304', label: '304 Å', hint: 'SDO/AIA 304 Å — chromosphere & transition region (~50,000 K).' },
  { id: 'sdo171', label: '171 Å', hint: 'SDO/AIA 171 Å — quiet corona & coronal loops (~600,000 K).' },
  { id: 'sdo193', label: '193 Å', hint: 'SDO/AIA 193 Å — hotter corona & flare plasma (~1.2 MK).' },
  { id: 'sdo211', label: '211 Å', hint: 'SDO/AIA 211 Å — active-region corona (~2 MK).' },
  { id: 'magnetogram', label: 'Magnetogram', hint: 'SDO/HMI line-of-sight magnetic field — black/white polarity.' },
];

export const HELIO_CANVAS_CLASSNAMES = {
  root: 'hv-live-canvas',
  canvas: 'hv-live-canvas__surface',
  reticle: 'hv-live-canvas__reticle',
} as const;

export const INITIAL_CANVAS_CAPABILITY: HelioCanvasCapability = {
  path: 'initializing',
  label: 'Renderer initializing',
  detail: 'Requesting WebGPU first, then falling back to WebGL2 if needed.',
  isHardwareAccelerated: false,
};

export function rendererCapability(path: CanvasRendererPath, detail?: string): HelioCanvasCapability {
  if (path === 'webgpu') {
    return {
      path,
      label: 'WebGPU live',
      detail: detail ?? 'Primary WebGPU renderer active.',
      isHardwareAccelerated: true,
    };
  }
  if (path === 'webgl2') {
    return {
      path,
      label: 'WebGL2 fallback',
      detail: detail ?? 'WebGPU unavailable; WebGL2 renderer active.',
      isHardwareAccelerated: true,
    };
  }
  if (path === 'none') {
    return {
      path,
      label: 'Canvas unavailable',
      detail: detail ?? 'No supported GPU canvas renderer is available in this browser.',
      isHardwareAccelerated: false,
    };
  }
  return INITIAL_CANVAS_CAPABILITY;
}
