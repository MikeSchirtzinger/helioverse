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
 * Refresh cadence: initial mount, then five minutes after each response settles.
 * The shared DONKI cache uses the same successful-response TTL, so every poll
 * revalidates same-day CME revisions instead of landing just before expiry.
 *
 * Returns:
 *   observations — every live DONKI record, including incomplete 3D analyses
 *   scene    — LiveScene | null  (null = no renderable CME or fetch failed)
 *   loading  — true while the first fetch is in-flight
 *   error    — string | null
 *   windowLabel — human "Jun 09 → Jun 16" for provenance
 */

import { useEffect, useState } from 'react';
import { DONKI_CACHE_TTL_MS, fetchCmeAnalyses, type DonkiCme } from '@/scene/donki-feeds';
import { buildLiveScene, type LiveScene } from '@/scene/live-cmes';

export interface LiveCmesState {
  observations: DonkiCme[] | null;
  scene: LiveScene | null;
  loading: boolean;
  error: string | null;
  windowLabel: string | null;
}

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
    observations: null,
    scene: null,
    loading: true,
    error: null,
    windowLabel: null,
  });

  useEffect(() => {
    let cancelled = false;

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
        if (cancelled) return;
        const scene = list ? buildLiveScene(list, nowUnix, windowStartUnix) : null;
        setState({
          observations: list,
          scene,
          loading: false,
          error: list ? null : 'DONKI unreachable',
          windowLabel: windowLabelOf(startYmd, endYmd),
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({
          observations: null,
          scene: null,
          loading: false,
          error: message,
          windowLabel: windowLabelOf(startYmd, endYmd),
        });
      }
    }

    let timer = 0;
    async function pollAfterSettlement() {
      await fetchScene();
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
