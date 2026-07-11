import { useMemo, type CSSProperties } from 'react';
import { AU_KM } from './constants';
import { cmeFrontRadiusKm, cmeFrontSpeedKms, cmeKinematics } from './cme-propagation';
import type { CmeEventData } from './types';

export type TimeBarMilestoneKind = 'flare' | 'cme' | 'predicted' | 'actual' | 'storm' | 'aurora';

export interface TimeBarMilestone {
  id: string;
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
  /** Event whose front distance is read out (and gating the "T+" label). */
  event: CmeEventData;
  regionLabel?: string;
  playing: boolean;
  speedHoursPerSecond: number;
  onPlayingChange: (playing: boolean) => void;
  onSpeedChange: (hoursPerSecond: number) => void;
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

  const liftoffMs = (event.liftoff_unix ?? 0) * 1000;
  const sinceEruptionH = (valueMs - liftoffMs) / 3_600_000;
  const frontAu = cmeFrontRadiusKm(event, valueMs / 1000) / AU_KM;
  const erupted = valueMs >= liftoffMs;

  // Physically-meaningful front speed (km/s) and how it's changing. The launch
  // Before 21.5 R_sun the displayed speed is derived from the two DONKI
  // time/radius anchors. Beyond that point the measured DONKI speed enters the
  // drag model fitted to the arrival anchor.
  const kin = useMemo(() => cmeKinematics(event), [event]);
  const frontSpeed = cmeFrontSpeedKms(event, valueMs / 1000);
  const nearSun = valueMs / 1000 < kin.t1_unix;
  const speedTrend = !erupted
    ? ''
    : nearSun
      ? '· interpolated launch leg'
      : kin.v0_kms > kin.w_kms
        ? '↓ solar-wind drag'
        : '↑ solar-wind drag';

  const activeMilestone = useMemo(() => {
    let best: TimeBarMilestone | null = null;
    for (const milestone of milestones) {
      if (Date.parse(milestone.timeIso) <= valueMs) best = milestone;
    }
    return best;
  }, [milestones, valueMs]);

  return (
    <div className="hv-canvas-timebar" aria-label="Event timeline scrubber">
      <div className="hv-tb-controls">
        <button
          type="button"
          className={`hv-tb-play${playing ? ' is-playing' : ''}`}
          onClick={() => onPlayingChange(!playing)}
          aria-pressed={playing}
          aria-label={playing ? 'Pause playback' : 'Play the eruption-to-impact journey'}
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>

        <div className="hv-tb-speeds" role="group" aria-label="Playback speed">
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

        <div className="hv-tb-readout">
          <span className="hv-tb-clock">{fmtUtc(valueIso)}</span>
          <span>
            {erupted ? `T+${sinceEruptionH.toFixed(1)} h` : `T${sinceEruptionH.toFixed(1)} h`} · front{' '}
            {frontAu < 0.02 ? 'at Sun' : `${frontAu.toFixed(2)} AU`}
          </span>
          {erupted ? (
            <span className="hv-tb-speed" title={`Front speed: derived from DONKI's Sun-surface/time21_5 anchors before 0.1 AU; DONKI reports ${Math.round(kin.v0_kms)} km/s at the DBM anchor, then drag relaxes it toward ambient wind.`}>
              {Math.round(frontSpeed)} km/s <em>{speedTrend}</em>
            </span>
          ) : null}
        </div>
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
              <button
                key={milestone.id}
                type="button"
                className={`hv-tb-tick hv-tb-tick--${milestone.kind}`}
                style={{ left: `${tickPct}%` }}
                title={`${TICK_KIND_LABEL[milestone.kind]} · ${milestone.label} — ${fmtUtc(milestone.timeIso)}\n${milestone.detail}`}
                onClick={() => onChange(milestone.timeIso)}
                aria-label={`Jump to ${milestone.label} at ${fmtUtc(milestone.timeIso)}`}
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
          <>Pre-event quiet Sun · scrub or play to launch the {regionLabel ?? 'CME'} eruption.</>
        )}
      </p>
    </div>
  );
}
