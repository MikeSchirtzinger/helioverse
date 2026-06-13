import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  buildFocusPayload,
  getAsOfFrame,
  parseIsoMillis,
  percentToTimeIso,
  timeToPercent,
  toIsoUtc,
} from './model';
import type { IsoUtcString, TimelineEventChip, TimelineFocusPayload, TimelineModel, TimelineMode } from './types';

export interface TimelineScrubberProps {
  model: TimelineModel;
  valueIso?: IsoUtcString;
  onTimeChange?: (timeIso: IsoUtcString, mode: TimelineMode) => void;
  onFocusEvent?: (payload: TimelineFocusPayload) => void;
  resolveThumbnailUrl?: (r2Key: string) => string;
  className?: string;
}

const modeLabels: Record<TimelineMode, string> = {
  history: '30-day history / scrub',
  live: 'Live',
  project: 'Project',
};

export function TimelineScrubber({
  model,
  valueIso,
  onTimeChange,
  onFocusEvent,
  resolveThumbnailUrl,
  className,
}: TimelineScrubberProps) {
  const [internalValueIso, setInternalValueIso] = useState<IsoUtcString>(model.window.liveAtIso);
  const selectedIso = valueIso ?? internalValueIso;
  const frame = useMemo(() => getAsOfFrame(model, selectedIso), [model, selectedIso]);
  const selectedPct = timeToPercent(selectedIso, model.window);
  const livePct = timeToPercent(model.window.liveAtIso, model.window);

  const updateTime = (nextIso: IsoUtcString) => {
    if (!valueIso) setInternalValueIso(nextIso);
    onTimeChange?.(nextIso, getAsOfFrame(model, nextIso).mode);
  };

  const jumpToMode = (mode: TimelineMode) => {
    if (mode === 'history') {
      updateTime(toIsoUtc(parseIsoMillis(model.window.liveAtIso) - 7 * 24 * 60 * 60 * 1000));
      return;
    }
    if (mode === 'project') {
      updateTime(toIsoUtc(parseIsoMillis(model.window.liveAtIso) + 18 * 60 * 60 * 1000));
      return;
    }
    updateTime(model.window.liveAtIso);
  };

  const focusChip = (chip: TimelineEventChip) => {
    const payload = buildFocusPayload(model, chip.id, selectedIso);
    onFocusEvent?.(payload);
  };

  return (
    <section className={className} style={styles.shell} aria-label="Helioverse timeline scrubber">
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Timeline</p>
          <h2 style={styles.title}>History ↔ live ↔ projection</h2>
        </div>
        <div style={styles.modeButtons} aria-label="Timeline modes">
          {(Object.keys(modeLabels) as TimelineMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => jumpToMode(mode)}
              style={{ ...styles.modeButton, ...(frame.mode === mode ? styles.modeButtonActive : undefined) }}
              aria-pressed={frame.mode === mode}
            >
              {modeLabels[mode]}
            </button>
          ))}
        </div>
      </header>

      <div style={styles.statusRow}>
        <Badge label="view" value={formatUtc(selectedIso)} tone={frame.mode} />
        <Badge label="as-of inputs" value={formatUtc(frame.inputsAsOfIso)} tone={frame.isHindcast ? 'history' : 'live'} />
        <Badge label="delay" value={frame.delayQuality === 'degraded_fixed' ? 'degraded fixed 30m' : 'measured'} tone={frame.delayQuality === 'degraded_fixed' ? 'project' : 'live'} />
      </div>

      <div style={styles.clockRow} aria-label="Three source clocks">
        <ClockBadge label="Sun imagery" iso={frame.clocks.sun_imagery_at} />
        <ClockBadge label="L1 measured" iso={frame.clocks.l1_measured_at} />
        <ClockBadge label="Model run" iso={frame.clocks.model_run_at} />
      </div>

      <div style={styles.trackWrap}>
        <div style={styles.segmentLabels} aria-hidden>
          <span>−{model.window.historyDays}d history</span>
          <span style={{ marginLeft: `${Math.max(0, livePct - 10)}%` }}>now</span>
          <span>+{model.window.projectDays}d project</span>
        </div>
        <div style={styles.track}>
          <div style={{ ...styles.historyBand, width: `${livePct}%` }} />
          <div style={{ ...styles.projectBand, left: `${livePct}%`, width: `${100 - livePct}%` }} />
          <div style={{ ...styles.liveMarker, left: `${livePct}%` }} aria-hidden />
          <div style={{ ...styles.playhead, left: `${selectedPct}%` }} aria-hidden />
          {model.chips.map((chip) => (
            <EventChip key={chip.id} chip={chip} onClick={() => focusChip(chip)} resolveThumbnailUrl={resolveThumbnailUrl} />
          ))}
        </div>
        <input
          aria-label="Scrub timeline time"
          type="range"
          min={0}
          max={1000}
          value={Math.round(selectedPct * 10)}
          onChange={(event) => updateTime(percentToTimeIso(Number(event.currentTarget.value) / 10, model.window))}
          style={styles.range}
        />
      </div>

      <footer style={styles.footer}>
        <span>{frame.isHindcast ? 'Hindcast-safe: future revisions are withheld at this as-of frame.' : 'Live/project: projections use the latest available as-of frame.'}</span>
        <span>{model.events.length} fixture events · {model.snapshots.length} as-of snapshots</span>
      </footer>
    </section>
  );
}

function EventChip({
  chip,
  onClick,
  resolveThumbnailUrl,
}: {
  chip: TimelineEventChip;
  onClick: () => void;
  resolveThumbnailUrl?: (r2Key: string) => string;
}) {
  const thumbUrl = chip.thumbnail ? resolveThumbnailUrl?.(chip.thumbnail.r2_key) : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...styles.chip, left: `${chip.positionPct}%`, borderColor: chip.isActive ? '#fbbf24' : chip.isResolved ? '#38bdf8' : '#64748b' }}
      title={`${chip.id} @ ${chip.timeIso}`}
    >
      <span style={styles.thumbSlot} aria-label={chip.thumbnail ? `${chip.thumbnail.wavelength} thumbnail slot` : 'thumbnail slot empty'}>
        {thumbUrl ? <img src={thumbUrl} alt="" style={styles.thumbImage} /> : <span style={styles.thumbFallback}>{chip.type}</span>}
      </span>
      <span style={styles.chipText}>
        <strong>{chip.label}</strong>
        <small>{chip.isResolved ? 'resolved' : chip.isActive ? 'active' : `score ${Math.round(chip.earthBoundScore * 100)}%`}</small>
      </span>
    </button>
  );
}

function Badge({ label, value, tone }: { label: string; value: string; tone: TimelineMode }) {
  return (
    <span style={{ ...styles.badge, ...toneStyle(tone) }}>
      <span style={styles.badgeLabel}>{label}</span>
      {value}
    </span>
  );
}

function ClockBadge({ label, iso }: { label: string; iso: IsoUtcString | null }) {
  return (
    <span style={styles.clockBadge}>
      <span style={styles.badgeLabel}>{label}</span>
      {iso ? formatUtc(iso) : 'unavailable'}
    </span>
  );
}

function toneStyle(tone: TimelineMode): CSSProperties {
  if (tone === 'history') return { background: 'rgba(56, 189, 248, 0.13)', borderColor: 'rgba(56, 189, 248, 0.45)' };
  if (tone === 'project') return { background: 'rgba(168, 85, 247, 0.14)', borderColor: 'rgba(168, 85, 247, 0.45)' };
  return { background: 'rgba(34, 197, 94, 0.14)', borderColor: 'rgba(34, 197, 94, 0.45)' };
}

function formatUtc(iso: IsoUtcString): string {
  return iso.replace('T', ' ').replace(':00Z', 'Z');
}

const styles: Record<string, CSSProperties> = {
  shell: {
    color: '#e2e8f0',
    background: 'linear-gradient(180deg, rgba(15,23,42,0.97), rgba(2,6,23,0.98))',
    border: '1px solid rgba(148,163,184,0.24)',
    borderRadius: 18,
    padding: 18,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    boxShadow: '0 22px 70px rgba(2, 6, 23, 0.38)',
  },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  eyebrow: { margin: 0, color: '#38bdf8', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' },
  title: { margin: '3px 0 0', fontSize: 20, fontWeight: 700 },
  modeButtons: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  modeButton: {
    color: '#cbd5e1',
    background: 'rgba(15,23,42,0.85)',
    border: '1px solid rgba(148,163,184,0.28)',
    borderRadius: 999,
    padding: '8px 12px',
    cursor: 'pointer',
  },
  modeButtonActive: { color: '#fff', borderColor: '#38bdf8', boxShadow: '0 0 0 1px rgba(56,189,248,0.28) inset' },
  statusRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 },
  clockRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  badge: { display: 'inline-flex', gap: 6, border: '1px solid', borderRadius: 999, padding: '6px 10px', fontSize: 12 },
  clockBadge: {
    display: 'inline-flex',
    gap: 6,
    border: '1px solid rgba(148,163,184,0.22)',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    color: '#cbd5e1',
    background: 'rgba(15,23,42,0.6)',
  },
  badgeLabel: { color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' },
  trackWrap: { marginTop: 22 },
  segmentLabels: { display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 12, marginBottom: 7 },
  track: {
    position: 'relative',
    height: 112,
    borderRadius: 16,
    overflow: 'visible',
    border: '1px solid rgba(148,163,184,0.24)',
    background: '#020617',
  },
  historyBand: { position: 'absolute', top: 0, bottom: 0, left: 0, background: 'linear-gradient(90deg, rgba(14,165,233,0.12), rgba(14,165,233,0.04))' },
  projectBand: { position: 'absolute', top: 0, bottom: 0, background: 'repeating-linear-gradient(135deg, rgba(168,85,247,0.18), rgba(168,85,247,0.18) 8px, rgba(168,85,247,0.07) 8px, rgba(168,85,247,0.07) 16px)' },
  liveMarker: { position: 'absolute', top: -7, bottom: -7, width: 2, background: '#22c55e', boxShadow: '0 0 16px #22c55e' },
  playhead: { position: 'absolute', top: -10, bottom: -10, width: 2, background: '#f8fafc', boxShadow: '0 0 14px rgba(248,250,252,0.8)', zIndex: 3 },
  chip: {
    position: 'absolute',
    top: 21,
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 138,
    maxWidth: 180,
    padding: 7,
    color: '#e2e8f0',
    background: 'rgba(15,23,42,0.94)',
    border: '1px solid',
    borderRadius: 13,
    cursor: 'pointer',
    zIndex: 4,
  },
  thumbSlot: {
    flex: '0 0 auto',
    width: 42,
    height: 42,
    borderRadius: 10,
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    color: '#93c5fd',
    background: 'radial-gradient(circle at 50% 45%, rgba(251,191,36,0.42), rgba(14,165,233,0.18) 58%, rgba(15,23,42,0.9))',
    border: '1px solid rgba(148,163,184,0.3)',
  },
  thumbImage: { width: '100%', height: '100%', objectFit: 'cover' },
  thumbFallback: { fontSize: 11, fontWeight: 800 },
  chipText: { display: 'grid', gap: 2, minWidth: 0, textAlign: 'left', fontSize: 12 },
  range: { width: '100%', marginTop: 14, accentColor: '#38bdf8' },
  footer: { display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 10, color: '#94a3b8', fontSize: 12 },
};
