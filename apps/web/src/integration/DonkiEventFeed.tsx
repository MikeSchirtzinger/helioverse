/**
 * integration/DonkiEventFeed.tsx
 *
 * Compact "Recent space-weather events (DONKI, live)" panel.
 *
 * Merges FLR + IPS + GST into a single chronological list (newest-first).
 * For each row: type badge, UTC time, severity label.
 *
 * Causal chain (FLR→IPS→GST): where linkedEventIds connect events from the
 * same causal sequence, a chain indicator arrow is shown on the right of the
 * event row, linking to the downstream events by type. This reconstructs the
 * observable FLR→CME→IPS→GST path without fetching CME data again.
 *
 * Honest states:
 *   - loading spinner while first fetch is in-flight
 *   - empty message: "No DONKI events in last 30 days"
 *   - error message when all three feeds failed
 *   - individual rows clearly sourced as "DONKI / live"
 *
 * Styling uses existing --hv-* CSS custom properties + inline styles.
 * No new CSS classes required.
 */

import type { CSSProperties } from 'react';
import type { DonkiFlare, DonkiGst, DonkiIps } from '@/scene/donki-feeds';

// ─── Unified event row ────────────────────────────────────────────────────────

type EventKind = 'FLR' | 'IPS' | 'GST';

interface FeedRow {
  id: string;
  kind: EventKind;
  time: string;        // ISO UTC
  timeMs: number;
  label: string;
  severity: string;    // human-readable: classType for FLR, location for IPS, Kp for GST
  linkedEventIds: string[];
}

function flrToRow(f: DonkiFlare): FeedRow {
  return {
    id: f.id,
    kind: 'FLR',
    time: f.time,
    timeMs: safeMs(f.time),
    label: f.label,
    severity: f.classType ?? 'unknown class',
    linkedEventIds: f.linkedEventIds ?? [],
  };
}

function ipsToRow(i: DonkiIps): FeedRow {
  return {
    id: i.id,
    kind: 'IPS',
    time: i.time,
    timeMs: safeMs(i.time),
    label: i.label,
    severity: i.location ?? 'unknown location',
    linkedEventIds: i.linkedEventIds ?? [],
  };
}

function gstToRow(g: DonkiGst): FeedRow {
  return {
    id: g.id,
    kind: 'GST',
    time: g.time,
    timeMs: safeMs(g.time),
    label: g.label,
    severity: g.observedKp != null ? `Kp ${g.observedKp.toFixed(1)}` : 'Kp unknown',
    linkedEventIds: g.linkedEventIds ?? [],
  };
}

function safeMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function formatUtcShort(iso: string): string {
  const ms = safeMs(iso);
  if (!ms) return iso;
  return new Date(ms).toUTCString().replace(/:\d\d GMT$/, ' UTC');
}

// ─── Build an id→kind map to resolve linked event types ────────────────────

function buildIdMap(rows: FeedRow[]): Map<string, EventKind> {
  const map = new Map<string, EventKind>();
  for (const row of rows) map.set(row.id, row.kind);
  return map;
}

/**
 * From a row's linkedEventIds and the global id→kind map, derive
 * the downstream types referenced by that event (for the chain badge).
 */
function linkedKinds(row: FeedRow, idMap: Map<string, EventKind>): EventKind[] {
  return [...new Set(
    row.linkedEventIds
      .map((id) => idMap.get(id))
      .filter((k): k is EventKind => k !== undefined),
  )];
}

// ─── Styling ─────────────────────────────────────────────────────────────────

const BADGE_COLORS: Record<EventKind, { bg: string; fg: string }> = {
  FLR: { bg: 'oklch(62% 0.18 48 / 0.22)', fg: '#f6a55b' },
  IPS: { bg: 'oklch(62% 0.18 222 / 0.22)', fg: '#5bc8f6' },
  GST: { bg: 'oklch(62% 0.18 310 / 0.22)', fg: '#d57ef6' },
};

function badgeStyle(kind: EventKind): CSSProperties {
  const { bg, fg } = BADGE_COLORS[kind];
  return {
    display: 'inline-block',
    padding: '2px 7px',
    borderRadius: 5,
    background: bg,
    color: fg,
    fontFamily: 'var(--hv-mono)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    flexShrink: 0,
  };
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 12px',
  borderBottom: '1px solid oklch(70% 0.03 240 / 0.12)',
  fontSize: 12,
  color: 'var(--hv-text)',
};

const timeStyle: CSSProperties = {
  color: 'var(--hv-muted)',
  fontFamily: 'var(--hv-mono)',
  fontSize: 11,
  flexShrink: 0,
  minWidth: 160,
};

const severityStyle: CSSProperties = {
  marginLeft: 'auto',
  color: 'var(--hv-muted)',
  fontFamily: 'var(--hv-mono)',
  fontSize: 11,
  flexShrink: 0,
};

const chainStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginLeft: 8,
  flexShrink: 0,
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface DonkiEventFeedProps {
  flares: DonkiFlare[] | null;
  ips: DonkiIps[] | null;
  gst: DonkiGst[] | null;
  loading: boolean;
  error: string | null;
}

export function DonkiEventFeed({ flares, ips, gst, loading, error }: DonkiEventFeedProps) {
  const rows: FeedRow[] = [
    ...(flares ?? []).map(flrToRow),
    ...(ips ?? []).map(ipsToRow),
    ...(gst ?? []).map(gstToRow),
  ].sort((a, b) => b.timeMs - a.timeMs); // newest first

  const idMap = buildIdMap(rows);

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px 8px',
    borderBottom: '1px solid oklch(70% 0.03 240 / 0.16)',
    color: 'var(--hv-muted)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.07em',
    textTransform: 'uppercase' as const,
  };

  const panelStyle: CSSProperties = {
    background: 'var(--hv-panel)',
    border: '1px solid var(--hv-hairline)',
    borderRadius: 'var(--hv-radius)',
    overflow: 'hidden',
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#79e6a3',
            boxShadow: '0 0 5px #79e6a3',
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <span>Recent space-weather events (DONKI, live)</span>
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'oklch(72% 0.035 248 / 0.6)' }}>
          last 30 days
        </span>
      </div>

      {loading && (
        <div style={{ padding: '18px 12px', color: 'var(--hv-muted)', fontSize: 12 }}>
          Fetching DONKI events…
        </div>
      )}

      {!loading && error && flares === null && ips === null && gst === null && (
        <div style={{ padding: '18px 12px', color: '#f6d365', fontSize: 12 }}>
          DONKI feed unavailable: {error}
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div style={{ padding: '18px 12px', color: 'var(--hv-muted)', fontSize: 12 }}>
          No DONKI events in the last 30 days.
        </div>
      )}

      {rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((row) => {
            const downstream = linkedKinds(row, idMap);
            return (
              <li key={row.id} style={rowStyle}>
                <span style={badgeStyle(row.kind)}>{row.kind}</span>
                <span style={timeStyle}>{formatUtcShort(row.time)}</span>
                <span
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={row.label}
                >
                  {row.label}
                </span>
                {/* Causal-chain indicator: downstream event type(s) linked to this event */}
                {downstream.length > 0 && (
                  <span style={chainStyle} title={`Linked to: ${downstream.join(', ')}`} aria-label={`Causes ${downstream.join(', ')}`}>
                    {downstream.map((kind) => (
                      <span key={kind} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ color: 'var(--hv-muted)', fontSize: 10 }}>→</span>
                        <span style={{ ...badgeStyle(kind), fontSize: 10, padding: '1px 5px' }}>{kind}</span>
                      </span>
                    ))}
                  </span>
                )}
                <span style={severityStyle}>{row.severity}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
