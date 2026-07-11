/**
 * scene/scene-setup.ts — Three.js scene graph construction from scene data.
 *
 * This module creates the three.js Object3D hierarchy from the pure data
 * descriptors (SunData, EarthData, L1Data, ParkerGridData). It does NOT
 * mount to the DOM or start a render loop — that's the caller's job.
 *
 * IMPORTANT: this module imports three.js at RUNTIME. The rest of the
 * scene/ modules are pure functions with zero three.js imports.
 */

import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { SunData, EarthData, L1Data, ParkerGridData, ScaleState } from './types';
import { helioToSceneCartesian, objectSceneRadius } from './camera';

// ---------------------------------------------------------------------------
// Scene graph helpers
// ---------------------------------------------------------------------------

/**
 * Convert a heliographic point to a THREE.Vector3 using the current ScaleState.
 */
export function helioToVector3(
  p: { lon_deg: number; lat_deg: number; r_km: number },
  scale: ScaleState,
): THREE.Vector3 {
  const { x, y, z } = helioToSceneCartesian(
    { lon_deg: p.lon_deg, lat_deg: p.lat_deg, r_km: p.r_km },
    scale.mode,
  );
  return new THREE.Vector3(x, y, z);
}

// ---------------------------------------------------------------------------
// Sun mesh
// ---------------------------------------------------------------------------

/** Default Sun colour (matches SDO 304Å gold tint). */
const SUN_COLOR = 0xffaa00;
const SUN_EMISSIVE = 0x331100;

/**
 * Create a Sun sphere mesh. Orbital radius comes from objectSceneRadius().
 * In the real scene this will be texture-mapped with an SDO image; for the
 * skeleton it's a flat-lit emissive sphere.
 */
export function createSunMesh(sun: SunData, scale: ScaleState): THREE.Mesh {
  const radius = objectSceneRadius(sun.radius_km, scale.mode);
  const geometry = new THREE.SphereGeometry(radius, 64, 64);
  const material = new THREE.MeshStandardMaterial({
    color: SUN_COLOR,
    emissive: SUN_EMISSIVE,
    roughness: 0.6,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sun';
  mesh.position.set(0, 0, 0);
  return mesh;
}

// ---------------------------------------------------------------------------
// Earth mesh
// ---------------------------------------------------------------------------

const EARTH_COLOR = 0x2244aa;
const EARTH_EMISSIVE = 0x001122;

export function createEarthMesh(earth: EarthData, scale: ScaleState): THREE.Mesh {
  const radius = objectSceneRadius(earth.radius_km, scale.mode);
  const pos = helioToVector3(earth.position, scale);
  const geometry = new THREE.SphereGeometry(radius, 48, 48);
  const material = new THREE.MeshStandardMaterial({
    color: EARTH_COLOR,
    emissive: EARTH_EMISSIVE,
    roughness: 0.5,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'earth';
  mesh.position.copy(pos);
  return mesh;
}

// ---------------------------------------------------------------------------
// L1 marker
// ---------------------------------------------------------------------------

const L1_COLOR = 0x44ff44;

export function createL1Marker(l1: L1Data, scale: ScaleState): THREE.Mesh {
  // Small diamond-shaped marker
  const pos = helioToVector3(l1.position, scale);
  const markerRadius = scale.mode === 'true' ? 0.003 : 0.02;
  const geometry = new THREE.OctahedronGeometry(markerRadius, 0);
  const material = new THREE.MeshBasicMaterial({ color: L1_COLOR });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'l1';
  mesh.position.copy(pos);
  return mesh;
}

// ---------------------------------------------------------------------------
// Parker grid lines
// ---------------------------------------------------------------------------

const GRID_COLOR = 0x334466;

export function createParkerGridLines(grid: ParkerGridData, scale: ScaleState): THREE.Group {
  const group = new THREE.Group();
  group.name = 'parker-grid';

  for (const spiral of grid.spirals) {
    if (spiral.length < 2) continue;
    const points: THREE.Vector3[] = spiral.map((p) => helioToVector3(p, scale));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // Use LineBasicMaterial for skeletal wireframe
    const material = new THREE.LineBasicMaterial({
      color: GRID_COLOR,
      transparent: true,
      opacity: 0.3,
    });

    group.add(new THREE.Line(geometry, material));
  }

  return group;
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export function createSceneLights(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lights';

  // Ambient — so the dark side isn't pure black
  const ambient = new THREE.AmbientLight(0x111122, 0.4);
  ambient.name = 'ambient';
  group.add(ambient);

  // Point light at the Sun's position (illuminates Earth, etc.)
  const sunLight = new THREE.PointLight(0xffffcc, 2, 0, 0);
  sunLight.name = 'sun-light';
  sunLight.position.set(0, 0, 0);
  group.add(sunLight);

  return group;
}

// ---------------------------------------------------------------------------
// Full scene assembly
// ---------------------------------------------------------------------------

export interface SceneObjects {
  scene: THREE.Scene;
  sun: THREE.Mesh;
  earth: THREE.Mesh;
  l1: THREE.Mesh;
  parkerGrid: THREE.Group;
  lights: THREE.Group;
}

/**
 * Build the complete helioverse scene graph and return named references.
 * Does NOT create a renderer, camera, or DOM mount — the caller owns that.
 */
export function createSceneObjects(
  sunData: SunData,
  earthData: EarthData,
  l1Data: L1Data,
  parkerGrid: ParkerGridData,
  scale: ScaleState,
): SceneObjects {
  const scene = new THREE.Scene();
  scene.name = 'helioverse';

  // Background: deep space
  scene.background = new THREE.Color(0x050510);

  const sun = createSunMesh(sunData, scale);
  const earth = createEarthMesh(earthData, scale);
  const l1 = createL1Marker(l1Data, scale);
  const grid = createParkerGridLines(parkerGrid, scale);
  const lights = createSceneLights();

  scene.add(sun);
  scene.add(earth);
  scene.add(l1);
  scene.add(grid);
  scene.add(lights);

  return { scene, sun, earth, l1, parkerGrid: grid, lights };
}

// ---------------------------------------------------------------------------
// Renderer factory (WebGPU-primary, WebGL2-fallback)
// ---------------------------------------------------------------------------

/**
 * Create a three.js WebGPURenderer. Falls back to WebGLRenderer if
 * WebGPU is not available or the import fails.
 *
 * Note: three@0.171 exports WebGPURenderer from 'three/webgpu'.
 * WebGLRenderer is from 'three'.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  preferWebGpu: boolean,
): Promise<{ renderer: WebGPURenderer | THREE.WebGLRenderer; isWebGpu: boolean }> {
  if (preferWebGpu && 'gpu' in navigator) {
    try {
      // Dynamic import to avoid bundling issues when WebGPU is unavailable
      const { WebGPURenderer: WGPURenderer } = await import('three/webgpu');
      const renderer = new WGPURenderer({ canvas, antialias: true });
      await renderer.init();
      return { renderer, isWebGpu: true };
    } catch {
      // WebGPU init failed — fall through to WebGL2
      console.warn('WebGPU init failed, falling back to WebGL2');
    }
  }

  // WebGL2 fallback (three.js WebGLRenderer already defaults to WebGL2)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return { renderer, isWebGpu: false };
}

/** Synchronous WebGL2-only renderer (for tests/headless). */
export function createWebGL2Renderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  return renderer;
}
