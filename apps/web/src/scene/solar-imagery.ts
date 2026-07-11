/**
 * scene/solar-imagery.ts — Real Sun imagery from the Helioviewer API.
 *
 * `gs671-suske.ndc.nasa.gov` (the NASA Goddard Space Weather Lab tool the
 * user pointed at) is an instance of Helioviewer. Its public API needs no
 * key and sends `Access-Control-Allow-Origin: *`, so we call it directly
 * from the browser: `takeScreenshot?display=true` returns a PNG of the solar
 * disk for any timestamp + channel. We mask it to a clean circular disk and
 * reproject that measured Earth-view observation onto a three.js sphere map.
 *
 * Everything degrades honestly: any network/CORS/decoding failure resolves to
 * `null`; the caller keeps a dark sphere plus an explicit imagery-unavailable
 * label. The measured Earth-facing disk is orthographically reprojected onto
 * only the Earth-facing hemisphere; the unobserved far side remains dark. It
 * never substitutes procedural solar structure. No secrets, ever.
 */

import * as THREE from 'three';
import type { SolarFilter } from './canvas-contract';

// Helioviewer's API sends no CORS headers, so we route through a same-origin
// `/hv-api` reverse proxy (configured in vite.config dev + preview, and expected
// in any real deployment). Falls back to the direct URL off-browser.
function screenshotEndpoint(): string {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : 'https://api.helioviewer.org';
  return `${origin}/hv-api/v2/takeScreenshot/`;
}

/** Our observation channels → Helioviewer source IDs (verified live). */
export const SOLAR_FILTER_SOURCE_IDS: Record<SolarFilter, number> = {
  visible: 18, // SDO/HMI continuum (white-light photosphere)
  sdo304: 13, // SDO/AIA 304 Å
  sdo171: 10, // SDO/AIA 171 Å
  sdo193: 11, // SDO/AIA 193 Å
  sdo211: 12, // SDO/AIA 211 Å
  magnetogram: 19, // SDO/HMI line-of-sight magnetogram
};

/** Nominal solar radius in arcseconds (used to find the disk edge in pixels). */
const SOLAR_RADIUS_ARCSEC = 959.63;
/** Arcsec/pixel that frames the full disk with margin in a 1024px image. */
const IMAGE_SCALE = 2.4204409;
const IMAGE_SIZE = 1024;

export interface SunImageRequest {
  /** ISO-8601 UTC timestamp. */
  dateIso: string;
  filter: SolarFilter;
  size?: number;
  imageScale?: number;
}

/** Build a Helioviewer `takeScreenshot` URL that returns a PNG directly. */
export function helioviewerScreenshotUrl(req: SunImageRequest): string {
  const size = req.size ?? IMAGE_SIZE;
  const sourceId = SOLAR_FILTER_SOURCE_IDS[req.filter] ?? SOLAR_FILTER_SOURCE_IDS.sdo193;
  const url = new URL(screenshotEndpoint());
  url.searchParams.set('date', req.dateIso);
  url.searchParams.set('imageScale', String(req.imageScale ?? IMAGE_SCALE));
  url.searchParams.set('layers', `[${sourceId},1,100]`);
  url.searchParams.set('x0', '0');
  url.searchParams.set('y0', '0');
  url.searchParams.set('width', String(size));
  url.searchParams.set('height', String(size));
  url.searchParams.set('display', 'true');
  url.searchParams.set('watermark', 'false');
  return url.toString();
}

/** Round a timestamp into a coarse bucket so scrubbing doesn't spam requests. */
const BUCKET_S = 720; // 12 minutes
function bucketIso(dateIso: string): string {
  const ms = Date.parse(dateIso);
  if (Number.isNaN(ms)) return dateIso;
  const bucketed = Math.round(ms / 1000 / BUCKET_S) * BUCKET_S * 1000;
  return new Date(bucketed).toISOString().replace('.000Z', 'Z');
}

// Cache immutable sphere-map canvases keyed by filter+bucket.
const sphereMapCache = new Map<string, HTMLCanvasElement>();
const CACHE_LIMIT = 24;

function rememberSphereMap(key: string, canvas: HTMLCanvasElement): void {
  sphereMapCache.set(key, canvas);
  if (sphereMapCache.size > CACHE_LIMIT) {
    const oldest = sphereMapCache.keys().next().value;
    if (oldest !== undefined) sphereMapCache.delete(oldest);
  }
}

/**
 * Reproject an Earth-view orthographic solar disk onto a sphere-map texture.
 * Three.js SphereGeometry places the +X (Sun→Earth) hemisphere around u=0.5.
 * Each front-side texel samples the corresponding measured disk coordinate;
 * x≤0 is genuinely unobserved by SDO from Earth and stays neutral dark.
 */
function projectDiskToSphereMap(disk: HTMLCanvasElement, size: number, imageScale: number): HTMLCanvasElement {
  const width = size;
  const height = Math.max(2, Math.round(size / 2));
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const sourceContext = disk.getContext('2d');
  const outputContext = output.getContext('2d');
  if (!sourceContext || !outputContext) return output;

  const source = sourceContext.getImageData(0, 0, size, size);
  const target = outputContext.createImageData(width, height);
  const center = size / 2;
  const diskRadius = SOLAR_RADIUS_ARCSEC / imageScale;

  for (let y = 0; y < height; y += 1) {
    const theta = ((y + 0.5) / height) * Math.PI;
    const sphereY = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    for (let x = 0; x < width; x += 1) {
      const phi = ((x + 0.5) / width) * Math.PI * 2;
      const sphereX = -Math.cos(phi) * sinTheta;
      const sphereZ = Math.sin(phi) * sinTheta;
      const targetIndex = (y * width + x) * 4;

      // Neutral, explicitly unavailable far hemisphere.
      target.data[targetIndex] = 22;
      target.data[targetIndex + 1] = 17;
      target.data[targetIndex + 2] = 21;
      target.data[targetIndex + 3] = 255;
      if (sphereX <= 0) continue;

      const sourceX = Math.max(0, Math.min(size - 1, Math.round(center + sphereZ * diskRadius)));
      const sourceY = Math.max(0, Math.min(size - 1, Math.round(center - sphereY * diskRadius)));
      const sourceIndex = (sourceY * size + sourceX) * 4;
      const hemisphereFeather = Math.max(0, Math.min(1, sphereX / 0.18));
      const alpha = ((source.data[sourceIndex + 3] ?? 0) / 255) * hemisphereFeather;
      target.data[targetIndex] = Math.round((source.data[sourceIndex] ?? 0) * alpha + 22 * (1 - alpha));
      target.data[targetIndex + 1] = Math.round((source.data[sourceIndex + 1] ?? 0) * alpha + 17 * (1 - alpha));
      target.data[targetIndex + 2] = Math.round((source.data[sourceIndex + 2] ?? 0) * alpha + 21 * (1 - alpha));
    }
  }

  outputContext.putImageData(target, 0, 0);
  return output;
}

/** Draw the fetched disk image and mask it to a feathered circle on black-free alpha. */
function maskSolarDisk(source: CanvasImageSource, size: number, imageScale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(source, 0, 0, size, size);

  // Keep only the solar disk; feather the limb so it blends into the glow.
  const center = size / 2;
  const diskRadius = SOLAR_RADIUS_ARCSEC / imageScale; // px
  const mask = ctx.createRadialGradient(center, center, diskRadius * 0.7, center, center, diskRadius * 1.02);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.92, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

function canvasToTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Fetch the real Sun for `dateIso` + `filter` and return a circular-disk
 * texture, or `null` if the network/decoding fails (caller shows unavailable).
 */
export async function loadSunTexture(
  req: SunImageRequest,
  signal?: AbortSignal,
): Promise<THREE.CanvasTexture | null> {
  const size = req.size ?? IMAGE_SIZE;
  const imageScale = req.imageScale ?? IMAGE_SCALE;
  const dateIso = bucketIso(req.dateIso);
  const key = `${req.filter}|${dateIso}`;

  const cached = sphereMapCache.get(key);
  if (cached) return canvasToTexture(cached);

  try {
    const response = await fetch(helioviewerScreenshotUrl({ ...req, dateIso, size, imageScale }), {
      signal,
      mode: 'cors',
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (signal?.aborted) return null;
    const bitmap = await createImageBitmap(blob);
    const disk = maskSolarDisk(bitmap, size, imageScale);
    bitmap.close?.();
    const sphereMap = projectDiskToSphereMap(disk, size, imageScale);
    rememberSphereMap(key, sphereMap);
    return canvasToTexture(sphereMap);
  } catch {
    return null;
  }
}
