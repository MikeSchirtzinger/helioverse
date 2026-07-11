/**
 * scene/use-goes-xray.ts — React hook for the live GOES X-ray series.
 *
 * Fetches the long-band soft X-ray series once (the module caches it for the
 * session) and re-fetches every 5 minutes so the live Sun stays current. Returns
 * `null` until the first response, and on any failure — callers then drive the
 * Sun from its neutral baseline. Colocated under `scene/**` so the canvas owns
 * its own data dependency.
 */

import { useEffect, useState } from 'react';
import { fetchGoesXray, type GoesXraySample } from './goes-xray';

/** 5-minute refresh — GOES X-ray cadence is ~1 minute but the storm-scale signal moves slowly. */
const REFRESH_MS = 5 * 60 * 1000;

export function useGoesXray(): GoesXraySample[] | null {
  const [samples, setSamples] = useState<GoesXraySample[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetchGoesXray().then((next) => {
        if (alive && next) setSamples(next);
      });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return samples;
}
