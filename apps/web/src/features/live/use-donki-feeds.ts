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
 * Refresh cadence: initial mount, then five minutes after each batch settles.
 * The shared DONKI cache deduplicates in-flight work and uses the same response
 * TTL, so every scheduled poll can receive same-day events and revisions.
 *
 * Returns:
 *   flares  — DonkiFlare[] | null  (null = fetch failed or still loading)
 *   ips     — DonkiIps[]   | null
 *   gst     — DonkiGst[]   | null
 *   loading — true while the first fetch is in-flight
 *   error   — string | null (last error across any of the three feeds)
 */

import { useEffect, useState } from 'react';
import type { DonkiCme, DonkiFlare, DonkiGst, DonkiIps } from '@/scene/donki-feeds';
import { DONKI_CACHE_TTL_MS, fetchCmeAnalyses, fetchFlares, fetchGst, fetchIps } from '@/scene/donki-feeds';

export interface DonkiFeedsState {
  cmes: DonkiCme[] | null;
  flares: DonkiFlare[] | null;
  ips: DonkiIps[] | null;
  gst: DonkiGst[] | null;
  loading: boolean;
  error: string | null;
}

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

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      const { startDate, endDate } = currentWindow();
      try {
        // All four in parallel — DONKI deduplicates in-flight work per key.
        const [cmes, flares, ips, gst] = await Promise.all([
          fetchCmeAnalyses(startDate, endDate),
          fetchFlares(startDate, endDate),
          fetchIps(startDate, endDate),
          fetchGst(startDate, endDate),
        ]);
        if (cancelled) return;
        setState({ cmes, flares, ips, gst, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }

    let timer = 0;
    async function pollAfterSettlement() {
      await fetchAll();
      if (!cancelled) {
        timer = window.setTimeout(() => { void pollAfterSettlement(); }, DONKI_CACHE_TTL_MS);
      }
    }

    void pollAfterSettlement();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return state;
}
