/**
 * features/live/use-swpc-now.ts
 *
 * React hook that polls the live NOAA SWPC L1 endpoint every 60 seconds.
 * Uses `fetchSwpcNow()` which hits services.swpc.noaa.gov directly — the
 * endpoint is CORS-open so no proxy is required.
 *
 * Returns:
 *   data      — latest SwpcNow snapshot, or null when unreachable / errored
 *   error     — last error message, or null
 *   updatedAt — ISO string of when data was last successfully fetched, or null
 *
 * On a total fetch failure data is set to null; callers show unavailable states.
 * The interval is cleared on unmount to avoid leaks.
 */

import { useEffect, useRef, useState } from 'react';
import type { SwpcNow } from '@/scene/swpc-feeds';
import { fetchSwpcNow } from '@/scene/swpc-feeds';

export interface SwpcNowState {
  data: SwpcNow | null;
  error: string | null;
  updatedAt: string | null;
}

const POLL_INTERVAL_MS = 60_000;

export function useSwpcNow(): SwpcNowState {
  const [state, setState] = useState<SwpcNowState>({ data: null, error: null, updatedAt: null });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let destroyed = false;

    async function fetchOnce() {
      // Cancel any in-flight request before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const data = await fetchSwpcNow(controller.signal);
        if (destroyed) return;
        const anyFeedAvailable = data.feed_status
          ? Object.values(data.feed_status).some((status) => status === 'ok')
          : false;
        setState({
          data,
          error: anyFeedAvailable ? null : 'NOAA/GFZ feeds returned no current measurements.',
          // Receipt time is deliberately separate from every instrument clock
          // carried in `data.*_measured_at`.
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        if (destroyed) return;
        // AbortError is expected on unmount — treat silently.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, data: null, error: message }));
      }
    }

    void fetchOnce();
    const interval = setInterval(() => { void fetchOnce(); }, POLL_INTERVAL_MS);

    return () => {
      destroyed = true;
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, []);

  return state;
}
