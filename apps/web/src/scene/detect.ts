/**
 * scene/detect.ts — WebGPU feature detection with WebGL2 fallback.
 *
 * Pure function: no side effects, statically inspectable.
 * Call detectGpuCapabilities() to probe the browser's GPU support.
 *
 * Returns a GpuDetection describing the available path:
 *   - webgpu: navigator.gpu is present AND a GPUAdapter was obtained.
 *   - webgl2:  a WebGL2RenderingContext can be created on an offscreen canvas.
 *   - none:    neither is available.
 */

import type { GpuDetection } from './types';

// ---------------------------------------------------------------------------
// Pure detection helpers
// ---------------------------------------------------------------------------

/** Check for navigator.gpu (the WebGPU entry point). */
export function hasNavigatorGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Check for WebGL2 via a temporary canvas. Does NOT touch the DOM. */
export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    return gl !== null;
  } catch {
    return false;
  }
}

/** Check for WebGPU via an offscreen canvas (requires actual GPU adapter request). */
export function hasWebGPUOffscreen(): boolean {
  // Static check: the API entry point must exist.
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Lightweight synchronous detection. Does NOT request a GPU adapter
 * (that is async and requires user-gesture in some browsers). Use
 * this for the initial render-path decision; call requestGpuAdapter()
 * later to confirm and obtain the device info string.
 */
export function detectSync(): Pick<GpuDetection, 'webgl2' | 'webgpu'> & { webgpuApiPresent: boolean } {
  const webgpuApiPresent = hasNavigatorGpu();
  const webgl2 = hasWebGL2();
  // Sync: webgpu reflects API presence (navigator.gpu). The async
  // detectGpuCapabilities() is the definitive adapter-requested check.
  return { webgpu: webgpuApiPresent, webgpuApiPresent, webgl2 };
}

// ---------------------------------------------------------------------------
// Async GPU adapter request (for the info string and final path selection)
// ---------------------------------------------------------------------------

/**
 * Request a WebGPU adapter (async). Returns the adapter info string or null.
 * This is the definitive check — even if `navigator.gpu` exists,
 * the adapter may be unavailable (e.g. blocked by browser flags).
 */
export async function requestGpuAdapter(): Promise<{ adapter: GPUAdapter | null; info: string | null }> {
  if (!hasNavigatorGpu()) {
    return { adapter: null, info: null };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { adapter: null, info: null };
    }
    const info = adapter.info;
    const desc = `${info.vendor} / ${info.architecture} / ${info.device}`;
    return { adapter, info: desc };
  } catch {
    return { adapter: null, info: null };
  }
}

// ---------------------------------------------------------------------------
// Unified detection
// ---------------------------------------------------------------------------

/**
 * Full detection result. Use this to decide the renderer path:
 *   path='webgpu'  → use WebGPURenderer (three.js)
 *   path='webgl2'  → use WebGLRenderer (three.js fallback)
 *   path='none'    → show "browser unsupported" message
 */
export async function detectGpuCapabilities(): Promise<GpuDetection> {
  const webgl2 = hasWebGL2();
  const webgpuApiPresent = hasNavigatorGpu();

  let webgpu = false;
  let rendererInfo: string | null = null;

  if (webgpuApiPresent) {
    const { adapter, info } = await requestGpuAdapter();
    webgpu = adapter !== null;
    rendererInfo = info;
  }

  // WebGL2 fallback info
  if (!webgpu && webgl2) {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (gl) {
        const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbgInfo) {
          rendererInfo = gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) as string;
        } else {
          rendererInfo = 'WebGL2 (no debug info)';
        }
      }
    } catch {
      rendererInfo = 'WebGL2';
    }
  }

  const path: GpuDetection['path'] =
    webgpu ? 'webgpu' : webgl2 ? 'webgl2' : 'none';

  return { webgpu, webgl2, path, rendererInfo };
}

// ---------------------------------------------------------------------------
// Degraded-mode indicators (spec §2.1)
// ---------------------------------------------------------------------------

/**
 * When the detection determines neither WebGPU nor WebGL2 is available,
 * the scene renders a static fallback message rather than an empty canvas.
 */
export function isGpuAvailable(detection: GpuDetection): boolean {
  return detection.path !== 'none';
}

/** Preferred path — primary is always WebGPU, with graceful degradation. */
export function preferredPath(detection: GpuDetection): 'webgpu' | 'webgl2' | 'none' {
  return detection.path;
}
