/**
 * features/live/use-live-cmes.ts
 *
 * React hook that fetches LIVE NASA DONKI CME Analysis for a rolling now−7d
 * window and builds the renderable {@link LiveScene} the 3D console draws in
 * "live" mode (R4 — real CMEs currently in flight, not the curated replay).
 *
 * The window + the scene's master clock are anchored to real wall-clock
 * `new Date()` — these are the CMEs happening NOW, so the default clock is now
 * and scrubbing rewinds to watch them launch / advances to watch them arrive.
 *
 * Refresh cadence: initial mount + every 30 minutes. CMEs evolve over hours and
 * DONKI caches per date-range key (see donki-feeds.ts), so a refresh only
 * re-hits the network when the day rolls over or a new analysis lands.
 *
 * Returns:
 *   scene    — LiveScene | null  (null = quiet Sun, still loading, or fetch failed)
 *   loading  — true while the first fetch is in-flight
 *   error    — string | null
 *   windowLabel — human "Jun 09 → Jun 16" for provenance
 */

import { useEffect, useRef, useState } from 'react';
import { fetchCmeAnalyses } from '@/scene/donki-feeds';
import { buildLiveScene, type LiveScene } from '@/scene/live-cmes';

export interface LiveCmesState {
  scene: LiveScene | null;
  loading: boolean;
  error: string | null;
  windowLabel: string | null;
}

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const WINDOW_DAYS = 7;

/** Format a Date as YYYY-MM-DD (UTC). */
function toYMD(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Compact "Jun 09 → Jun 16" label from two YYYY-MM-DD strings. */
function windowLabelOf(startYmd: string, endYmd: string): string {
  const fmt = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return `${mon} ${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  return `${fmt(startYmd)} → ${fmt(endYmd)}`;
}

export function useLiveCmes(): LiveCmesState {
  const [state, setState] = useState<LiveCmesState>({
    scene: null,
    loading: true,
    error: null,
    windowLabel: null,
  });

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchScene() {
      const now = new Date();
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - WINDOW_DAYS);
      const startYmd = toYMD(start);
      const endYmd = toYMD(now);
      const nowUnix = Math.floor(now.getTime() / 1000);
      const windowStartUnix = Math.floor(start.getTime() / 1000);

      try {
        const list = await fetchCmeAnalyses(startYmd, endYmd);
        if (!mountedRef.current) return;
        const scene = list ? buildLiveScene(list, nowUnix, windowStartUnix) : null;
        setState({
          scene,
          loading: false,
          error: list ? null : 'DONKI unreachable',
          windowLabel: windowLabelOf(startYmd, endYmd),
        });
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }

    void fetchScene();
    const interval = setInterval(() => { void fetchScene(); }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return state;
}
