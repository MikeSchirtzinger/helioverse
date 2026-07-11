/**
 * scene-events.tsx — the storm scenario's event list + per-event detail.
 *
 * These render the curated JUNE_2026_STORM replay and the current DONKI event
 * ledger in the immersive console's right rail.
 */
import { formatUtc } from './format';
import { JUNE_2026_STORM, cmeKineticEnergyJ, type StormCme, type StormFlare } from './storm-scenario';
import { liveCmeKineticEnergyJ, type LiveCmeView } from '@/scene/live-cmes';
import { EruptionSnapshot } from './EruptionSnapshot';

const isoOf = (unix: number): string => new Date(unix * 1000).toISOString().replace('.000Z', 'Z');

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const speedClassLabel = (speedClass: string): string => ({
  S: 'slow (<500 km/s)',
  C: 'fast (500–999 km/s)',
  O: 'very fast (1,000–1,999 km/s)',
  R: 'rapid (2,000–2,999 km/s)',
  ER: 'extreme (≥3,000 km/s)',
})[speedClass.toUpperCase()] ?? 'classified by DONKI';

export function StormEventsList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const scenario = JUNE_2026_STORM;
  return (
    <div className="hv-events-list" aria-label="Storm events">
      <p className="hv-eyebrow">Storm events · 3 flares → 3 CMEs</p>
      <ul>
        {scenario.flares.map((flare) => {
          const cme = scenario.cmes.find((c) => c.id === flare.cmeId);
          return (
            <li key={flare.id}>
              <button
                type="button"
                className={`hv-event-row${selectedId === flare.id ? ' is-selected' : ''}`}
                onClick={() => onSelect(flare.id)}
              >
                <span className="hv-event-dot" style={{ background: '#ffd24a' }} aria-hidden="true" />
                <span className="hv-event-name">{flare.flareClass} flare</span>
                <span className="hv-event-meta">{formatUtc(flare.peakIso)}</span>
              </button>
              {cme ? (
                <button
                  type="button"
                  className={`hv-event-row hv-event-row--cme${selectedId === cme.id ? ' is-selected' : ''}`}
                  onClick={() => onSelect(cme.id)}
                >
                  <span
                    className="hv-event-dot"
                    style={{ background: `#${cme.color.toString(16).padStart(6, '0')}` }}
                    aria-hidden="true"
                  />
                  <span className="hv-event-name">
                    {cme.name} {cme.id === scenario.primaryCmeId ? '· primary' : ''}
                  </span>
                  <span className="hv-event-meta">{cme.speed_kms} km/s</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CmeDetail({ cme }: { cme: StormCme }) {
  const ke = cmeKineticEnergyJ(cme.science.mass_kg, cme.speed_kms);
  const flare = JUNE_2026_STORM.flares.find((f) => f.id === cme.flareId);
  return (
    <div className="hv-event-detail" aria-label={`${cme.name} details`}>
      <header>
        <span className="hv-event-dot" style={{ background: `#${cme.color.toString(16).padStart(6, '0')}` }} aria-hidden="true" />
        <h3>
          {cme.name} — {cme.flareClass} CME
        </h3>
      </header>
      <EruptionSnapshot dateIso={isoOf(cme.liftoff_unix)} label={cme.name} kind="cme" />
      <dl className="hv-detail-grid">
        <Detail term="Launch" value={formatUtc(isoOf(cme.liftoff_unix))} />
        <Detail term="Speed (DONKI)" value={`${cme.speed_kms} km/s`} />
        <Detail term="Angular width" value={`${(cme.halfAngle_deg * 2).toFixed(0)}°`} />
        <Detail term="Halo" value={cme.isHalo ? 'Yes (partial halo)' : 'No'} />
        <Detail term="Apex" value={`${cme.sourcePosition.lat_deg >= 0 ? 'N' : 'S'}${Math.abs(cme.sourcePosition.lat_deg)}° ${cme.sourcePosition.lon_deg >= 0 ? 'W' : 'E'}${Math.abs(cme.sourcePosition.lon_deg)}°`} />
        <Detail term="Source region" value={flare?.ar ?? '—'} />
        <Detail term="Predicted arrival" value={cme.predictedEtaIso ? formatUtc(cme.predictedEtaIso) : '—'} />
        <Detail term="Observed shock" value={cme.actualEtaIso ? formatUtc(cme.actualEtaIso) : 'glancing — no clean L1 shock'} />
      </dl>
      {/* Derived-from-width estimates are visually de-ranked into their own group (R2). */}
      <div className="hv-detail-estimates">
        <p className="hv-eyebrow">Estimated from angular width</p>
        <dl className="hv-detail-grid">
          <Detail term="Mass" value={`~${cme.science.mass_kg.toExponential(1)} kg`} />
          <Detail term="Ions" value={`~${cme.science.ions.toExponential(1)} protons`} />
          <Detail term="Kinetic energy" value={`~${ke.toExponential(1)} J`} />
        </dl>
      </div>
      <p className="hv-detail-note">
        {cme.id === JUNE_2026_STORM.primaryCmeId
          ? 'The X1.0 partial-halo CME — aimed near Earth (apex N32) and the headline driver of the Jun 5 G2 storm.'
          : cme.earthBoundScore < 0.5
            ? 'Aimed high-north (apex N52), so it largely misses Earth — matching its low Enlil Kp.'
            : 'Aimed near Earth; arrives first and compounds with the X1.0 CME at L1.'}{' '}
        Speed, width and direction are measured by NASA DONKI CME Analysis; mass/ions are estimated from the
        angular width (DONKI carries no mass).
      </p>
    </div>
  );
}

export function FlareDetail({
  flare,
  cme,
  onSelect,
}: {
  flare: StormFlare;
  cme: StormCme | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="hv-event-detail" aria-label={`${flare.flareClass} flare details`}>
      <header>
        <span className="hv-event-dot" style={{ background: '#ffd24a' }} aria-hidden="true" />
        <h3>{flare.flareClass} solar flare</h3>
      </header>
      <EruptionSnapshot dateIso={flare.peakIso} label={`${flare.flareClass} flare`} kind="flare" />
      <dl className="hv-detail-grid">
        <Detail term="Peak (GOES)" value={formatUtc(flare.peakIso)} />
        <Detail term="Region" value={flare.ar} />
        <Detail term="Radio blackout" value={flare.blackout} />
        <Detail term="Class" value={flare.flareClass} />
      </dl>
      {cme ? (
        <button type="button" className="hv-detail-link" onClick={() => onSelect(cme.id)}>
          → launched {cme.name} ({cme.speed_kms} km/s)
        </button>
      ) : null}
    </div>
  );
}

/** Live DONKI CME list for the right rail. */
export function LiveCmeList({
  views,
  selectedId,
  primaryId,
  totalDetected,
  shown,
  windowLabel,
  onSelect,
}: {
  views: LiveCmeView[];
  selectedId: string | null;
  primaryId: string | null;
  totalDetected: number;
  shown: number;
  windowLabel: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="hv-events-list" aria-label="Live CMEs">
      <p className="hv-eyebrow">
        Live CMEs · {shown}
        {totalDetected > shown ? ` of ${totalDetected}` : ''}
        {windowLabel ? ` · ${windowLabel}` : ''}
      </p>
      <ul>
        {views.map((v) => {
          const e = v.canvas.event;
          return (
            <li key={e.id}>
              <button
                type="button"
                className={`hv-event-row hv-event-row--cme${selectedId === e.id ? ' is-selected' : ''}`}
                onClick={() => onSelect(e.id)}
              >
                <span className="hv-event-dot" style={{ background: hex(v.canvas.color) }} aria-hidden="true" />
                <span className="hv-event-name">
                  {v.canvas.label}
                  {e.id === primaryId ? ' · primary' : ''}
                </span>
                <span className="hv-event-meta">{formatUtc(isoOf(e.liftoff_unix))}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Per-CME detail for a selected live DONKI CME. Mirrors the replay CmeDetail. */
export function LiveCmeDetail({ view }: { view: LiveCmeView }) {
  const { donki, canvas } = view;
  const e = canvas.event;
  const speed = donki.speed_kms ?? e.speed_kms;
  const mass = donki.estMass_kg;
  const ke = liveCmeKineticEnergyJ(mass, speed);
  const lat = e.sourcePosition.lat_deg;
  const lon = e.sourcePosition.lon_deg;
  const sourceLocation = donki.sourceLocation.trim() || '—';
  return (
    <div className="hv-event-detail" aria-label="Live CME details">
      <header>
        <span className="hv-event-dot" style={{ background: hex(canvas.color) }} aria-hidden="true" />
        <h3>{canvas.label}</h3>
      </header>
      <EruptionSnapshot dateIso={isoOf(e.liftoff_unix)} label={canvas.label} kind="cme" />
      <dl className="hv-detail-grid">
        <Detail term="Launch" value={formatUtc(isoOf(e.liftoff_unix))} />
        <Detail term="Speed (DONKI)" value={`${Math.round(speed)} km/s`} />
        <Detail term="Angular width" value={`${(e.halfAngle_deg * 2).toFixed(0)}°`} />
        <Detail term="Halo" value={e.isHalo ? 'Yes' : 'No'} />
        <Detail term="Apex" value={`${lat >= 0 ? 'N' : 'S'}${Math.abs(Math.round(lat))}° ${lon >= 0 ? 'W' : 'E'}${Math.abs(Math.round(lon))}°`} />
        <Detail term="Source location" value={sourceLocation} />
        <Detail term="Active region" value={donki.activeRegion == null ? '—' : `AR ${donki.activeRegion}`} />
        {donki.speedClass ? <Detail term="Speed class" value={speedClassLabel(donki.speedClass)} /> : null}
        <Detail term="Earth path (modelled)" value={!donki.hasEnlilRun ? 'unavailable' : view.earthDirected ? 'impact flagged by WSA-Enlil' : 'impact not flagged by WSA-Enlil'} />
        <Detail term="Predicted Kp" value={view.predictedKp != null ? `≤ ${view.predictedKp} (WSA-Enlil)` : '—'} />
        <Detail term="Predicted arrival" value={view.arrivalIso ? formatUtc(view.arrivalIso) : '—'} />
      </dl>
      <p className="hv-detail-note">
        {!donki.hasEnlilRun ? 'No WSA-Enlil run is available' : view.earthDirected ? 'WSA-Enlil models an Earth impact' : 'WSA-Enlil does not model an Earth impact'}
        {view.coneHitsEarth ? '; its measured cone geometrically contains Earth.' : '; its measured cone misses Earth.'}
        {view.predictedKp != null ? ` Enlil predicts up to Kp ${view.predictedKp}.` : ''}
      </p>
      {/* Derived-from-width estimates are visually de-ranked into their own group. */}
      <div className="hv-detail-estimates">
        <p className="hv-eyebrow">Estimated from angular width</p>
        <dl className="hv-detail-grid">
          <Detail term="Mass" value={`~${mass.toExponential(1)} kg`} />
          <Detail term="Ions" value={`~${donki.estIons.toExponential(1)} protons`} />
          <Detail term="Kinetic energy" value={`~${ke.toExponential(1)} J`} />
        </dl>
      </div>
      <p className="hv-detail-note">
        Speed, width and apex direction are measured by NASA DONKI CME Analysis. Arrival and predicted Kp are
        modelled by WSA-Enlil. Mass, ions and energy are estimated from angular width because DONKI carries no mass.
      </p>
      {donki.link ? (
        <a className="hv-detail-link" href={donki.link} target="_blank" rel="noreferrer">
          → open DONKI record
        </a>
      ) : null}
    </div>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="hv-detail-cell">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}
