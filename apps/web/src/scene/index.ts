/**
 * scene/ — W1-P3: WebGPU Scene Skeleton
 *
 * Owner: W1-P3-B (DeepSeek builder) / W1-P3-V (GPT validator)
 *
 * Barrel export. Every public symbol is re-exported from its owning module.
 * All pure functions and TS types are statically inspectable by
 *   tsc -b --noEmit
 *
 * Scope:
 * - WebGPU feature detection with WebGL2 fallback
 * - Sun/Earth/L1/Parker grid data in 3D space
 * - Camera controls (orbit, zoom, pan)
 * - True/compressed scale toggle
 * - Screenshot-capable story/test helpers
 *
 * Do NOT wire to App.tsx — that's the W2 integration packages' job.
 */

// -- Types (pure, no runtime imports) --
export type {
  ScaleMode,
  GpuDetection,
  HelioPoint,
  SunData,
  EarthData,
  L1Data,
  ParkerGridData,
  CmeEventData,
  CameraState,
  ScaleState,
  ScreenshotResult,
} from './types';

// -- Constants (contract-pinned) --
export {
  AU_KM,
  SUN_RADIUS_KM,
  FIXED_FALLBACK_DELAY_S,
  EARTH_RADIUS_KM,
  L1_EARTH_DISTANCE_KM,
  DEFAULT_SOLAR_WIND_SPEED_KMS,
  SOLAR_SYNODIC_ROTATION_S,
  SOLAR_SIDEREAL_ROTATION_S,
  DEFAULT_DBM_GAMMA_PER_KM,
  DEFAULT_DBM_AMBIENT_WIND_KMS,
  EARTH_MIN_SCENE_RADIUS,
  SUN_COMPRESSED_SCENE_RADIUS,
  COMPRESS_FACTOR,
  COMPRESS_LINEAR_ZONE_KM,
} from './constants';

// -- GPU detection --
export {
  hasNavigatorGpu,
  hasWebGL2,
  hasWebGPUOffscreen,
  detectSync,
  requestGpuAdapter,
  detectGpuCapabilities,
  isGpuAvailable,
  preferredPath,
} from './detect';

// -- Parker grid (pure math) --
export {
  computeParkerSpiral,
  computeParkerGrid,
  parkerOffsetDeg,
  parkerOffsetAt1AU,
  PARKER_DEFAULTS,
} from './parker-grid';

// -- Camera & scale (pure state) --
export {
  createDefaultCameraState,
  orbitAzimuth,
  orbitPolar,
  zoom,
  pan,
  compressDistance,
  uncompressDistance,
  helioToSceneCartesian,
  objectSceneRadius,
  createScaleState,
  toggleScale,
  DEFAULT_TARGET,
} from './camera';

// -- Scene data generators --
export {
  createSunData,
  createEarthData,
  earthCarringtonLongitude,
  createL1Data,
  createCmeEventData,
  createSceneBundle,
} from './scene-data';
export type { SceneBundle } from './scene-data';

// -- Scene graph construction (three.js runtime) --
export {
  helioToVector3,
  createSunMesh,
  createEarthMesh,
  createL1Marker,
  createParkerGridLines,
  createSceneLights,
  createSceneObjects,
  createRenderer,
  createWebGL2Renderer,
} from './scene-setup';
export type { SceneObjects } from './scene-setup';

// -- Screenshot & test helpers --
export {
  captureDataUrl,
  captureBlob,
  blankFrameDataUrl,
  pixelDiff,
  hasCanvasSupport,
} from './screenshot';

// -- Fixture reader (contract JSON → scene data) --
export {
  isoToUnix,
  snapshotEpoch,
  earthFromSnapshot,
  l1FromSnapshot,
  sunFromSnapshot,
  cmeFromEvent,
  sceneFromFixtures,
} from './reader';
export type {
  SnapshotForScene,
  EventForScene,
  SceneFromFixtures,
} from './reader';

// -- Module-level ready flag (for integration checks) --
export const SCENE_READY = true;
