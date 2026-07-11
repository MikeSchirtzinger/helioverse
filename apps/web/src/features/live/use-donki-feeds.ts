/**
 * features/live/use-donki-feeds.ts
 *
 * React hook that fetches DONKI FLR (solar flares), IPS (interplanetary shocks),
 * and GST (geomagnetic storms) for a rolling 30-day window ending NOW.
 *
 * The window is computed from real wall-clock `new Date()` — intentionally NOT
 * the historical replay clock, because these are live outcome feeds for model
 * evaluation, not replay data.
 *
 * Refresh cadence: initial mount + every 5 minutes. DONKI data is cached
 * in-module per date-range key (see donki-feeds.ts), so the refresh only
 * re-hits the network when the window key changes (i.e. on date rollover).
 *
 * Returns:
 *   flares  — DonkiFlare[] | null  (null = fetch failed or still loading)
 *   ips     — DonkiIps[]   | null
 *   gst     — DonkiGst[]   | null
 *   loading — true while the first fetch is in-flight
 *   error   — string | null (last error across any of the three feeds)
 */

import { useEffect, useRef, useState } from 'react';
import type { DonkiCme, DonkiFlare, DonkiGst, DonkiIps } from '@/scene/donki-feeds';
import { fetchCmeAnalyses, fetchFlares, fetchGst, fetchIps } from '@/scene/donki-feeds';

export interface DonkiFeedsState {
  cmes: DonkiCme[] | null;
  flares: DonkiFlare[] | null;
  ips: DonkiIps[] | null;
  gst: DonkiGst[] | null;
  loading: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WINDOW_DAYS = 30;

/** Format a Date as YYYY-MM-DD (UTC). */
function toYMD(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Compute the rolling 30-day window [startDate, endDate] in YYYY-MM-DD. */
function currentWindow(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - WINDOW_DAYS);
  return { startDate: toYMD(start), endDate: toYMD(now) };
}

export function useDonkiFeeds(): DonkiFeedsState {
  const [state, setState] = useState<DonkiFeedsState>({
    cmes: null,
    flares: null,
    ips: null,
    gst: null,
    loading: true,
    error: null,
  });

  // Track whether the component is still mounted to avoid stale setState calls.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchAll() {
      const { startDate, endDate } = currentWindow();
      try {
        // All three in parallel — DONKI caches per key, so no duplicate requests.
        const [cmes, flares, ips, gst] = await Promise.all([
          fetchCmeAnalyses(startDate, endDate),
          fetchFlares(startDate, endDate),
          fetchIps(startDate, endDate),
          fetchGst(startDate, endDate),
        ]);
        if (!mountedRef.current) return;
        setState({ cmes, flares, ips, gst, loading: false, error: null });
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }

    void fetchAll();
    const interval = setInterval(() => { void fetchAll(); }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return state;
}
