/**
 * scene-events.tsx — the storm scenario's event list + per-event detail.
 *
 * These render the curated JUNE_2026_STORM replay and the current DONKI event
 * ledger in the immersive console's right rail.
 */
import { formatUtc } from './format';
import { JUNE_2026_STORM, cmeKineticEnergyJ, type StormCme, type StormFlare } from './storm-scenario';
import {
  cmeKinematicsIssues,
  liveCmeKineticEnergyJ,
  liveCmeObservationLabel,
  type LiveCmeView,
} from '@/scene/live-cmes';
import type { DonkiCme, DonkiFlare } from '@/scene/donki-feeds';
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

function earthPathLabel(view: LiveCmeView): string {
  switch (view.donki.earthImpactClassification) {
    case 'direct': return 'direct Earth shock forecast';
    case 'glancing': return 'glancing Earth shock forecast';
    case 'minor': return 'minor Earth impact forecast';
    case 'none': return 'no Earth shock ETA in this run';
    case 'unavailable': return 'WSA-Enlil run unavailable';
  }
}

function disturbanceWindow(view: LiveCmeView): string {
  if (!view.arrivalIso) return '—';
  const start = Date.parse(view.arrivalIso);
  const durationHours = view.donki.enlilDurationH;
  if (!Number.isFinite(start) || durationHours == null || durationHours <= 0) return formatUtc(view.arrivalIso);
  return `${formatUtc(view.arrivalIso)} → ${formatUtc(new Date(start + durationHours * 3_600_000).toISOString())}`;
}

function observedEarthPathLabel(cme: DonkiCme): string {
  switch (cme.earthImpactClassification) {
    case 'direct': return 'direct Earth shock forecast';
    case 'glancing': return 'glancing Earth shock forecast';
    case 'minor': return 'minor Earth impact forecast';
    case 'none': return 'no Earth shock ETA in this run';
    case 'unavailable': return 'WSA-Enlil run unavailable';
  }
}

function observedApexLabel(cme: DonkiCme): string {
  const lat = cme.apexLat_deg;
  const lon = cme.apexLon_deg;
  if (lat == null && lon == null) return 'unavailable';
  const parts: string[] = [];
  if (lat != null) parts.push(`${lat >= 0 ? 'N' : 'S'}${Math.abs(Math.round(lat))}°`);
  if (lon != null) parts.push(`${lon >= 0 ? 'W' : 'E'}${Math.abs(Math.round(lon))}°`);
  return parts.join(' · ');
}

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

/** Per-flare detail for a selected live DONKI/GOES observation. */
export function LiveFlareDetail({ flare }: { flare: DonkiFlare }) {
  const eventIso = flare.peakTime ?? flare.beginTime ?? flare.time;
  const hasEventTime = Number.isFinite(Date.parse(eventIso));
  const flareLabel = flare.classType ? `${flare.classType} solar flare` : 'Solar flare';

  return (
    <div className="hv-event-detail" aria-label={`${flareLabel} details`}>
      <header>
        <span className="hv-event-dot" style={{ background: '#ffd24a' }} aria-hidden="true" />
        <h3>{flareLabel}</h3>
      </header>
      {hasEventTime ? (
        <EruptionSnapshot dateIso={eventIso} label={flareLabel} kind="flare" />
      ) : (
        <p className="hv-detail-note" role="status">
          DONKI did not provide a usable event time, so verified event imagery cannot be requested.
        </p>
      )}
      <dl className="hv-detail-grid">
        <Detail term="Class (GOES)" value={flare.classType ?? '—'} />
        <Detail term="Source location" value={flare.sourceLocation ?? '—'} />
        <Detail term="Active region" value={flare.activeRegionNum == null ? '—' : `AR ${flare.activeRegionNum}`} />
        <Detail term="Onset" value={flare.beginTime ? formatUtc(flare.beginTime) : '—'} />
        <Detail term="Peak" value={flare.peakTime ? formatUtc(flare.peakTime) : '—'} />
        <Detail term="End" value={flare.endTime ? formatUtc(flare.endTime) : '—'} />
      </dl>
      <p className="hv-detail-note">
        Class, timing, source location and active region are observed fields from the DONKI solar-flare record and GOES X-ray event report.
      </p>
      {flare.link ? (
        <a className="hv-detail-link" href={flare.link} target="_blank" rel="noreferrer">
          → open DONKI flare record
        </a>
      ) : null}
    </div>
  );
}

/** Live DONKI CME list for the right rail. */
export function LiveCmeList({
  observations,
  views,
  selectedId,
  primaryId,
  totalDetected,
  shown,
  windowLabel,
  onSelect,
}: {
  observations: readonly DonkiCme[];
  views: LiveCmeView[];
  selectedId: string | null;
  primaryId: string | null;
  totalDetected: number;
  shown: number;
  windowLabel: string | null;
  onSelect: (id: string) => void;
}) {
  const viewById = new Map(views.map((view) => [view.donki.activityID, view]));
  const newestFirst = [...observations].sort((a, b) => b.startUnix - a.startUnix);
  return (
    <div className="hv-events-list" aria-label="Live CMEs">
      <p className="hv-eyebrow">
        Observed CMEs · {totalDetected}
        {totalDetected > 0 ? ` · ${shown} drawn` : ''}
        {windowLabel ? ` · ${windowLabel}` : ''}
      </p>
      <ul>
        {newestFirst.map((observation) => {
          const view = viewById.get(observation.activityID);
          const issues = cmeKinematicsIssues(observation);
          const launchIso = Number.isFinite(observation.startUnix)
            ? isoOf(observation.startUnix)
            : observation.startTime;
          return (
            <li key={observation.activityID}>
              <button
                type="button"
                className={`hv-event-row hv-event-row--cme${selectedId === observation.activityID ? ' is-selected' : ''}`}
                onClick={() => onSelect(observation.activityID)}
                title={issues.length ? `Observed by NASA DONKI; 3D front withheld because ${issues.join(', ')} is unavailable.` : 'Observed by NASA DONKI; measured kinematics are sufficient for a modelled 3D front.'}
              >
                <span
                  className={`hv-event-dot${view ? '' : ' hv-event-dot--withheld'}`}
                  style={view ? { background: hex(view.canvas.color) } : undefined}
                  aria-hidden="true"
                />
                <span className="hv-event-name">
                  {liveCmeObservationLabel(observation)}
                  {observation.activityID === primaryId ? ' · primary' : ''}
                  {!view ? ' · 3D withheld' : ''}
                </span>
                <span className="hv-event-meta">{formatUtc(launchIso)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A real DONKI observation that cannot honestly be promoted to a 3D front.
 * Every available source field remains visible; missing geometry stays missing.
 */
export function LiveCmeObservationDetail({ cme }: { cme: DonkiCme }) {
  const issues = cmeKinematicsIssues(cme);
  const label = liveCmeObservationLabel(cme);
  const eventIso = cme.startTime;
  const hasEventTime = Number.isFinite(Date.parse(eventIso));
  const possibleKp = cme.predictedKpRange
    ? cme.predictedKpRange.min === cme.predictedKpRange.max
      ? `${cme.predictedKpRange.max} · model scenario`
      : `${cme.predictedKpRange.min}–${cme.predictedKpRange.max} · model scenarios`
    : '—';

  return (
    <div className="hv-event-detail" aria-label="Observed CME details">
      <header>
        <span className="hv-event-dot hv-event-dot--withheld" aria-hidden="true" />
        <h3>{label}</h3>
      </header>
      {hasEventTime ? (
        <EruptionSnapshot dateIso={eventIso} label={label} kind="cme" />
      ) : (
        <p className="hv-detail-note" role="status">
          DONKI did not provide a usable launch time, so verified event imagery cannot be requested.
        </p>
      )}
      <dl className="hv-detail-grid">
        <Detail term="Launch" value={hasEventTime ? formatUtc(eventIso) : '—'} />
        <Detail term="Speed (DONKI)" value={cme.speed_kms == null ? '—' : `${Math.round(cme.speed_kms)} km/s`} />
        <Detail term="Angular width" value={cme.halfAngle_deg == null ? '—' : `${(cme.halfAngle_deg * 2).toFixed(0)}°`} />
        <Detail term="Apex" value={observedApexLabel(cme)} />
        <Detail term="Source location" value={cme.sourceLocation.trim() || '—'} />
        <Detail term="Active region" value={cme.activeRegion == null ? '—' : `AR ${cme.activeRegion}`} />
        {cme.speedClass ? <Detail term="Speed class" value={speedClassLabel(cme.speedClass)} /> : null}
        <Detail term="Earth path (modelled)" value={observedEarthPathLabel(cme)} />
        <Detail term="Possible Kp" value={possibleKp} />
        <Detail term="Predicted arrival" value={cme.enlilShockIso ? formatUtc(cme.enlilShockIso) : '—'} />
        <Detail term="3D front" value={issues.length ? `withheld · missing ${issues.join(', ')}` : 'kinematics complete'} />
      </dl>
      <p className="hv-detail-note">
        This is a current NASA DONKI observation. The event stays in the live ledger, but no 3D front is drawn because
        {issues.length ? ` DONKI has not supplied ${issues.join(', ')}.` : ' it is outside the current 3D display selection.'}
        {' '}Helioverse does not invent the missing reconstruction geometry.
      </p>
      {cme.link ? (
        <a className="hv-detail-link" href={cme.link} target="_blank" rel="noreferrer">
          → open DONKI record
        </a>
      ) : null}
      {cme.enlilRunLink ? (
        <a className="hv-detail-link" href={cme.enlilRunLink} target="_blank" rel="noreferrer">
          → open WSA-Enlil model run
        </a>
      ) : null}
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
  const possibleKp = donki.predictedKpRange
    ? donki.predictedKpRange.min === donki.predictedKpRange.max
      ? `${donki.predictedKpRange.max} · model scenario`
      : `${donki.predictedKpRange.min}–${donki.predictedKpRange.max} · model scenarios`
    : '—';
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
        <Detail term="Earth path (modelled)" value={earthPathLabel(view)} />
        <Detail term="Possible Kp" value={possibleKp} />
        <Detail term="Predicted arrival" value={view.arrivalIso ? formatUtc(view.arrivalIso) : '—'} />
        <Detail term="Disturbed interval" value={disturbanceWindow(view)} />
        <Detail term="Model run completed" value={donki.enlilModelCompletionIso ? formatUtc(donki.enlilModelCompletionIso) : '—'} />
      </dl>
      <p className="hv-detail-note">
        {donki.earthImpactClassification === 'unavailable'
          ? 'No WSA-Enlil run is available.'
          : donki.earthImpactClassification === 'none'
            ? 'This WSA-Enlil run carries no Earth shock ETA; that is not proof that every part of the CME misses Earth.'
            : `WSA-Enlil supplies a ${donki.earthImpactClassification} Earth shock forecast.`}{' '}
        The measured cone {view.coneHitsEarth ? 'contains' : 'does not contain'} the Sun–Earth direction.
        {donki.predictedKpRange ? ` Possible Kp spans ${donki.predictedKpRange.min}–${donki.predictedKpRange.max} across the modelled IMF-orientation scenarios; Bz is not known until measured upstream.` : ''}
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
        Speed, width and apex direction are measured by NASA DONKI CME Analysis. Arrival, disturbance duration and
        possible Kp are modelled by WSA-Enlil. Mass, ions and energy are estimated from angular width because DONKI carries no mass.
      </p>
      {donki.link ? (
        <a className="hv-detail-link" href={donki.link} target="_blank" rel="noreferrer">
          → open DONKI record
        </a>
      ) : null}
      {donki.enlilRunLink ? (
        <a className="hv-detail-link" href={donki.enlilRunLink} target="_blank" rel="noreferrer">
          → open WSA-Enlil model run
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
