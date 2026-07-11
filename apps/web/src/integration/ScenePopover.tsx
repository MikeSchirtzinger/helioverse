/**
 * ScenePopover.tsx — an on-canvas inspector for the selected CME, pinned to the
 * object in 3D space. `SceneStage` positions it imperatively from the per-frame
 * anchor `HelioCanvas` reports, so it tracks the travelling front (or, before
 * eruption, the Sun-surface source beacon) as the camera orbits.
 *
 * It is a deliberately COMPACT subset of the right-rail CmeDetail: a real
 * Helioviewer eruption thumbnail plus the MEASURED DONKI fields only — launch,
 * speed, angular width, apex direction. The modelled front position and the
 * width-derived mass / ion / energy estimates stay in the rail's full breakdown;
 * the popover points there rather than duplicating (and risking diverging from)
 * them.
 *
 * PROVENANCE: every field shown here is measured by NASA DONKI CME Analysis; the
 * thumbnail is a real SDO/Helioviewer frame (see EruptionSnapshot). Nothing here
 * is synthetic, and the one modelled quantity (front position) is labelled as
 * such in the note.
 */
import { EruptionSnapshot } from './EruptionSnapshot';
import { formatUtc } from './format';
import type { CanvasCme } from '@/scene/canvas-contract';

const isoOf = (unix: number): string => new Date(unix * 1000).toISOString().replace('.000Z', 'Z');
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Measured CME apex direction, e.g. "N32° W14°", from the DONKI source position. */
function apexLabel(lat: number, lon: number): string {
  const ns = `${lat >= 0 ? 'N' : 'S'}${Math.abs(Math.round(lat))}°`;
  const ew = `${lon >= 0 ? 'W' : 'E'}${Math.abs(Math.round(lon))}°`;
  return `${ns} ${ew}`;
}

export function ScenePopover({ cme, onClose }: { cme: CanvasCme; onClose: () => void }) {
  const e = cme.event;
  return (
    <div className="hv-scene-popover" role="dialog" aria-label={`${cme.label} — eruption inspector`}>
      <header className="hv-scene-popover-head">
        <span className="hv-event-dot" style={{ background: hex(cme.color) }} aria-hidden="true" />
        <h3>{cme.label}</h3>
        <button
          type="button"
          className="hv-scene-popover-close"
          onClick={onClose}
          aria-label="Dismiss inspector"
          title="Dismiss"
        >
          ×
        </button>
      </header>

      <EruptionSnapshot dateIso={isoOf(e.liftoff_unix)} label={cme.label} kind="cme" />

      <dl className="hv-detail-grid">
        <Cell term="Launch" value={formatUtc(isoOf(e.liftoff_unix))} />
        <Cell term="Speed (DONKI)" value={`${Math.round(e.speed_kms)} km/s`} />
        <Cell term="Angular width" value={`${(e.halfAngle_deg * 2).toFixed(0)}°`} />
        <Cell term="Apex" value={apexLabel(e.sourcePosition.lat_deg, e.sourcePosition.lon_deg)} />
      </dl>

      <p className="hv-detail-note">
        Speed, width &amp; apex measured by NASA DONKI; the travelling front is modelled (DBM).
        Estimated mass and modelled arrival are in the side panel.
      </p>
    </div>
  );
}

function Cell({ term, value }: { term: string; value: string }) {
  return (
    <div className="hv-detail-cell">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}
