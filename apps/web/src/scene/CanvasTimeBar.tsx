import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { AU_KM } from './constants';
import { cmeFrontRadiusKm, cmeFrontSpeedKms, cmeKinematics } from './cme-propagation';
import type { CmeEventData } from './types';

export type TimeBarMilestoneKind = 'flare' | 'cme' | 'predicted' | 'actual' | 'storm' | 'aurora';

export interface TimeBarMilestone {
  id: string;
  /** Source event selected when this milestone is opened. */
  eventId?: string;
  label: string;
  timeIso: string;
  kind: TimeBarMilestoneKind;
  detail: string;
}

export interface CanvasTimeBarProps {
  windowStartIso: string;
  windowEndIso: string;
  /** Master-clock value (ISO-8601 UTC). */
  valueIso: string;
  onChange: (iso: string) => void;
  milestones: TimeBarMilestone[];
  /** CME whose front distance is read out. Null keeps a flare-only live ledger visible. */
  event: CmeEventData | null;
  regionLabel?: string;
  playing: boolean;
  speedHoursPerSecond: number;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (hoursPerSecond: number) => void;
  /** Live monitoring does not masquerade as a narrative playback. */
  playbackEnabled?: boolean;
  mode?: 'live' | 'replay';
  /** Selecting a visible milestone opens its real event record. */
  onMilestoneSelect?: (milestone: TimeBarMilestone) => void;
}

const SPEEDS: Array<{ label: string; hoursPerSec: number }> = [
  { label: '1h/s', hoursPerSec: 1 },
  { label: '6h/s', hoursPerSec: 6 },
  { label: '24h/s', hoursPerSec: 24 },
];

const TICK_KIND_LABEL: Record<TimeBarMilestoneKind, string> = {
  flare: 'Flare',
  cme: 'CME',
  predicted: 'Predicted',
  actual: 'Arrival',
  storm: 'Storm',
  aurora: 'Aurora',
};

function toIso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

function fmtUtc(iso: string): string {
  return iso.replace('T', ' ').replace(':00Z', 'Z').replace('Z', ' UTC');
}

function fmtEventUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }) + ' UTC';
}

function fmtWindowUtc(startIso: string, endIso: string): string {
  const format = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return `${format(startIso)} – ${format(endIso)}`;
}

export function CanvasTimeBar({
  windowStartIso,
  windowEndIso,
  valueIso,
  onChange,
  milestones,
  event,
  regionLabel,
  playing,
  speedHoursPerSecond,
  onPlayingChange,
  onSpeedChange,
  playbackEnabled = true,
  mode = 'replay',
  onMilestoneSelect,
}: CanvasTimeBarProps) {
  const startMs = useMemo(() => Date.parse(windowStartIso), [windowStartIso]);
  const endMs = useMemo(() => Date.parse(windowEndIso), [windowEndIso]);
  const span = Math.max(1, endMs - startMs);

  const speedIdx = Math.max(0, SPEEDS.findIndex((speed) => speed.hoursPerSec === speedHoursPerSecond));

  const valueMs = Date.parse(valueIso);
  const pct = ((valueMs - startMs) / span) * 100;

  const setFromPercent = (percent: number) => {
    const ms = startMs + (Math.max(0, Math.min(100, percent)) / 100) * span;
    onChange(toIso(ms));
  };

  const liftoffMs = event ? event.liftoff_unix * 1000 : null;
  const sinceEruptionH = liftoffMs == null ? null : (valueMs - liftoffMs) / 3_600_000;
  const frontAu = event ? cmeFrontRadiusKm(event, valueMs / 1000) / AU_KM : null;
  const erupted = liftoffMs != null && valueMs >= liftoffMs;

  // Physically-meaningful front speed (km/s) and how it's changing. The launch
  // Before 21.5 R_sun the displayed speed is derived from the two DONKI
  // time/radius anchors. Beyond that point the measured DONKI speed enters the
  // drag model fitted to the arrival anchor.
  const kin = useMemo(() => event ? cmeKinematics(event) : null, [event]);
  const frontSpeed = event ? cmeFrontSpeedKms(event, valueMs / 1000) : null;
  const nearSun = kin ? valueMs / 1000 < kin.t1_unix : false;
  const speedTrend = !erupted
    ? ''
    : nearSun
      ? '· interpolated launch leg'
      : kin && kin.v0_kms > kin.w_kms
        ? '↓ solar-wind drag'
        : '↑ solar-wind drag';

  const activeMilestone = useMemo(() => {
    let best: TimeBarMilestone | null = null;
    for (const milestone of milestones) {
      if (Date.parse(milestone.timeIso) <= valueMs) best = milestone;
    }
    return best;
  }, [milestones, valueMs]);
  const activeMilestoneRef = useRef<HTMLButtonElement>(null);
  const eventStripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = eventStripRef.current;
    const active = activeMilestoneRef.current;
    if (!strip || !active) return;
    strip.scrollLeft = Math.max(0, active.offsetLeft - (strip.clientWidth - active.clientWidth) / 2);
  }, [activeMilestone?.id]);

  const selectMilestone = (milestone: TimeBarMilestone) => {
    onChange(milestone.timeIso);
    onMilestoneSelect?.(milestone);
  };

  return (
    <div className={`hv-canvas-timebar hv-canvas-timebar--${mode}`} aria-label="Space-weather event timeline">
      <div className="hv-tb-heading">
        <div>
          <span>Event timeline</span>
          <strong>{mode === 'live' ? 'Observed launches + modelled Earth ETAs' : 'Historical event replay'}</strong>
        </div>
        <time>{fmtWindowUtc(windowStartIso, windowEndIso)} UTC</time>
      </div>

      <div className="hv-tb-controls">
        {playbackEnabled ? (
          <>
            <button
              type="button"
              className={`hv-tb-play${playing ? ' is-playing' : ''}`}
              onClick={() => onPlayingChange(!playing)}
              aria-pressed={playing}
              aria-label={playing ? 'Pause historical replay' : 'Play historical event replay'}
            >
              {playing ? '❚❚ Pause replay' : '▶ Play replay'}
            </button>

            <div className="hv-tb-speeds" role="group" aria-label="Replay speed">
              {SPEEDS.map((speed, index) => (
                <button
                  key={speed.label}
                  type="button"
                  className={index === speedIdx ? 'is-active' : ''}
                  aria-pressed={index === speedIdx}
                  onClick={() => onSpeedChange(speed.hoursPerSec)}
                >
                  {speed.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <span className="hv-tb-monitor-state"><i aria-hidden="true" /> Live monitor</span>
        )}

        <div className="hv-tb-readout">
          <span className="hv-tb-clock">{fmtUtc(valueIso)}</span>
          {event && sinceEruptionH != null && frontAu != null ? (
            <span>
              {erupted ? `T+${sinceEruptionH.toFixed(1)} h` : `T${sinceEruptionH.toFixed(1)} h`} · front{' '}
              {frontAu < 0.02 ? 'at Sun' : `${frontAu.toFixed(2)} AU`}
            </span>
          ) : <span>Observed solar-event ledger</span>}
          {erupted && kin && frontSpeed != null ? (
            <span className="hv-tb-speed" title={`Front speed: derived from DONKI's Sun-surface/time21_5 anchors before 0.1 AU; DONKI reports ${Math.round(kin.v0_kms)} km/s at the DBM anchor, then drag relaxes it toward ambient wind.`}>
              {Math.round(frontSpeed)} km/s <em>{speedTrend}</em>
            </span>
          ) : null}
        </div>
      </div>

      <div ref={eventStripRef} className="hv-tb-event-strip" aria-label="Events in this timeline">
        {milestones.map((milestone) => (
          <button
            key={`event-${milestone.id}`}
            ref={activeMilestone?.id === milestone.id ? activeMilestoneRef : undefined}
            type="button"
            className={`hv-tb-event hv-tb-event--${milestone.kind}${activeMilestone?.id === milestone.id ? ' is-current' : ''}`}
            onClick={() => selectMilestone(milestone)}
            aria-label={`Open ${milestone.label}, ${fmtEventUtc(milestone.timeIso)}`}
          >
            <span>{TICK_KIND_LABEL[milestone.kind]}</span>
            <strong>{milestone.label}</strong>
            <time>{fmtEventUtc(milestone.timeIso)}</time>
          </button>
        ))}
      </div>

      <div className="hv-tb-track">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(Math.max(0, Math.min(100, pct)) * 10)}
          onChange={(event_) => setFromPercent(Number(event_.currentTarget.value) / 10)}
          aria-label="Scrub event time"
          aria-valuetext={fmtUtc(valueIso)}
          style={{ '--hv-pct': `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties}
        />
        <div className="hv-tb-ticks">
          {milestones.map((milestone) => {
            const tickPct = ((Date.parse(milestone.timeIso) - startMs) / span) * 100;
            if (tickPct < 0 || tickPct > 100) return null;
            return (
              <span
                key={milestone.id}
                className={`hv-tb-tick hv-tb-tick--${milestone.kind}`}
                style={{ left: `${tickPct}%` }}
                title={`${TICK_KIND_LABEL[milestone.kind]} · ${milestone.label} — ${fmtUtc(milestone.timeIso)}\n${milestone.detail}`}
                aria-hidden="true"
              />
            );
          })}
        </div>
      </div>

      <p className="hv-tb-caption">
        {activeMilestone ? (
          <>
            <strong>{activeMilestone.label}</strong> — {activeMilestone.detail}
          </>
        ) : (
          event
            ? <>Pre-event quiet Sun · scrub or play to launch the {regionLabel ?? 'CME'} eruption.</>
            : <>No recorded event at this clock position.</>
        )}
      </p>
    </div>
  );
}
