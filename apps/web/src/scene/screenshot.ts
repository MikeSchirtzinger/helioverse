/**
 * scene/screenshot.ts — Screenshot capture from a WebGL/WebGPU canvas.
 *
 * Pure helper: takes an HTMLCanvasElement (with a WebGL or WebGPU context)
 * and captures a PNG data URL synchronously or as a Blob.
 *
 * For WebGPU canvases: three.js WebGPURenderer supports toDataURL() via
 * copyExternalImageToTexture internally. This module works with both paths
 * because it calls canvas.toDataURL() / canvas.toBlob().
 *
 * Also exports a headless image-diff helper for automated testing.
 */

import type { ScreenshotResult } from './types';

// ---------------------------------------------------------------------------
// Screenshot capture
// ---------------------------------------------------------------------------

/**
 * Capture the current contents of a rendering canvas as a PNG data URL.
 * Works for both WebGL2 and WebGPU canvases (three.js renders to the canvas
 * backing store; toDataURL reads it regardless of context type).
 *
 * @param canvas  - The HTMLCanvasElement with the rendered scene.
 * @param format  - MIME type (default 'image/png').
 * @param quality - 0..1 for lossy formats (ignored for PNG).
 */
export function captureDataUrl(
  canvas: HTMLCanvasElement,
  format: 'image/png' | 'image/jpeg' = 'image/png',
  quality: number = 0.92,
): ScreenshotResult {
  const dataUrl = canvas.toDataURL(format, quality);
  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Capture as a Blob (async). Useful for uploading or saving.
 */
export function captureBlob(
  canvas: HTMLCanvasElement,
  format: 'image/png' | 'image/jpeg' = 'image/png',
  quality: number = 0.92,
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas.toBlob returned null'));
          return;
        }
        resolve({ blob, width: canvas.width, height: canvas.height });
      },
      format,
      quality,
    );
  });
}

// ---------------------------------------------------------------------------
// Headless screenshot for story/test helpers
// ---------------------------------------------------------------------------

/**
 * Create an offscreen canvas and return a 1×1 pixel data URL (a "blank frame").
 * Used in test/story environments where no GPU is available — proves the
 * screenshot pipeline is wired without requiring a real render.
 */
export function blankFrameDataUrl(): ScreenshotResult {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 1, 1);
  }
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: 1,
    height: 1,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Simple RGBA pixel-diff for two same-sized ImageData objects.
 * Returns the number of pixels that differ beyond a tolerance.
 *
 * This is a headless testing helper: render two frames and compare.
 * The WebGPU and WebGL2 paths MUST produce visually equivalent frames.
 */
export function pixelDiff(
  a: ImageData,
  b: ImageData,
  tolerance: number = 0,
): { changed: number; total: number; identical: boolean } {
  if (a.width !== b.width || a.height !== b.height) {
    return { changed: Infinity, total: a.width * a.height, identical: false };
  }

  const total = a.width * a.height;
  let changed = 0;

  const da = a.data;
  const db = b.data;

  for (let i = 0; i < da.length; i += 4) {
    // Safe: i+3 < da.length for all i in this loop
    const dr = Math.abs(da[i]! - db[i]!);
    const dg = Math.abs(da[i + 1]! - db[i + 1]!);
    const db_ = Math.abs(da[i + 2]! - db[i + 2]!);
    const da_alpha = Math.abs(da[i + 3]! - db[i + 3]!);

    if (dr > tolerance || dg > tolerance || db_ > tolerance || da_alpha > tolerance) {
      changed++;
    }
  }

  return { changed, total, identical: changed === 0 };
}

// ---------------------------------------------------------------------------
// Headless-render check (for CI without a GPU)
// ---------------------------------------------------------------------------

/**
 * Test whether we're in an environment that supports canvas rendering
 * (jsdom or a real browser). Returns true if a 2D context can be created.
 */
export function hasCanvasSupport(): boolean {
  try {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    return ctx !== null;
  } catch {
    return false;
  }
}
