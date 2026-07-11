import { useEffect, useMemo, useState } from 'react';
import type { UseUserLocationResult } from './use-user-location';
import { kpToG, l1DelaySeconds, newellCoupling, skyState } from '@/core/physics';
import { dynamicPressureNPa } from '@/scene/magnetosphere';
import type { AuroraGridPoint, SwpcNow } from '@/scene/canvas-contract';

const L1_DISTANCE_KM = 1_500_000;

function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function formatValue(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function formatUtc(iso: string | null | undefined): string {
  if (!iso) return 'unavailable';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }) + ' UTC';
}

function ageLabel(iso: string | null | undefined, nowMs: number): { text: string; stale: boolean } {
  if (!iso) return { text: 'unavailable', stale: true };
  const ageMinutes = Math.max(0, (nowMs - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(ageMinutes)) return { text: 'unknown age', stale: true };
  if (ageMinutes < 2) return { text: '<2 min old', stale: false };
  if (ageMinutes < 90) return { text: `${Math.round(ageMinutes)} min old`, stale: ageMinutes > 15 };
  return { text: `${(ageMinutes / 60).toFixed(1)} h old`, stale: true };
}

function sampleOvation(grid: AuroraGridPoint[] | null | undefined, lat: number, lon: number): number | null {
  if (!grid?.length) return null;
  const normalizedLon = ((lon % 360) + 360) % 360;
  let nearest: AuroraGridPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of grid) {
    const dLat = point.lat - lat;
    let dLon = point.lon - normalizedLon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const weightedDistance = dLat * dLat + dLon * dLon * Math.max(0.08, Math.cos(lat * Math.PI / 180) ** 2);
    if (weightedDistance < bestDistance) {
      bestDistance = weightedDistance;
      nearest = point;
    }
  }
  return nearest?.prob ?? null;
}

function provenanceClass(kind: 'measured' | 'modelled' | 'computed' | 'unavailable'): string {
  return `hx-prov hx-prov--${kind}`;
}

export function CurrentConditions({
  swpc,
  error,
  receivedAt,
  location,
}: {
  swpc: SwpcNow | null;
  error: string | null;
  receivedAt: string | null;
  location: UseUserLocationResult;
}) {
  const nowMs = useClock();
  const user = location.location;
  const localProbability = user ? sampleOvation(swpc?.auroraGrid, user.latDeg, user.lonDeg) : null;
  const sky = user ? skyState(user.latDeg, user.lonDeg, nowMs / 1000) : null;
  const isDark = sky ? sky.sunAltDeg <= -6 : null;

  const delaySeconds = swpc?.speed_kms != null
    ? l1DelaySeconds(L1_DISTANCE_KM, swpc.speed_kms)
    : null;
  const delayMinutes = delaySeconds == null ? null : delaySeconds / 60;
  const pressure = swpc?.density != null && swpc.speed_kms != null
    ? dynamicPressureNPa(swpc.density, swpc.speed_kms)
    : null;
  const coupling = swpc?.speed_kms != null && swpc.by != null && swpc.bz_nt != null
    ? newellCoupling(swpc.speed_kms, swpc.by, swpc.bz_nt)
    : null;
  const gScale = swpc?.kp != null ? kpToG(swpc.kp) : null;
  const magAge = ageLabel(swpc?.mag_measured_at, nowMs);
  const plasmaAge = ageLabel(swpc?.plasma_measured_at, nowMs);
  const ovationAge = ageLabel(swpc?.ovation_observed_at, nowMs);

  const localHeadline = useMemo(() => {
    if (!user) return { label: 'Location needed', detail: 'Use your device location to sample the NOAA OVATION nowcast grid at your coordinates.' };
    if (localProbability == null) return { label: 'Aurora probability unavailable', detail: 'NOAA OVATION did not provide a usable coordinate grid.' };
    if (isDark === false) return { label: 'Daylight is the limiting gate', detail: `${Math.round(localProbability)}% OVATION probability at your location, but the Sun is above astronomical twilight.` };
    if (localProbability >= 30) return { label: 'Space conditions are favourable', detail: `${Math.round(localProbability)}% OVATION probability at your location. Cloud cover is not assessed.` };
    if (localProbability >= 10) return { label: 'Space conditions are possible', detail: `${Math.round(localProbability)}% OVATION probability at your location. Cloud cover is not assessed.` };
    return { label: 'Oval probability is low here', detail: `${Math.round(localProbability)}% OVATION probability at your location right now.` };
  }, [isDark, localProbability, user]);

  return (
    <section className="hx-conditions" aria-labelledby="hx-conditions-title">
      <div className="hx-panel-intro">
        <p className="hx-kicker">Now at Earth</p>
        <h2 id="hx-conditions-title">{localHeadline.label}</h2>
        <p>{localHeadline.detail}</p>
      </div>

      <div className="hx-location-row" data-status={location.status}>
        <div>
          <span className="hx-location-label">{user?.label ?? 'No location selected'}</span>
          <span>{user ? `${user.latDeg.toFixed(2)}°, ${user.lonDeg.toFixed(2)}° · measured by device` : 'Local visibility is not guessed.'}</span>
        </div>
        {!user ? (
          <button type="button" onClick={location.request} disabled={location.status === 'requesting'}>
            {location.status === 'requesting' ? 'Locating…' : 'Use my location'}
          </button>
        ) : null}
      </div>

      {error ? <div className="hx-feed-alert" role="status"><strong>Feed degradation</strong><span>{error}</span></div> : null}

      <div className="hx-local-gates" aria-label="Local viewing gates">
        <Gate label="OVATION at you" value={localProbability == null ? 'unavailable' : `${Math.round(localProbability)}%`} kind={localProbability == null ? 'unavailable' : 'modelled'} note="NOAA measured-driven nowcast" />
        <Gate label="Darkness" value={sky == null ? 'location needed' : isDark ? 'dark' : `${sky.sunAltDeg.toFixed(1)}° Sun`} kind={sky == null ? 'unavailable' : 'computed'} note="topocentric ephemeris" />
        <Gate label="Moon" value={sky == null ? 'location needed' : `${Math.round(sky.moonIllumFrac * 100)}% lit`} kind={sky == null ? 'unavailable' : 'computed'} note="brightness gate" />
        <Gate label="Cloud" value="unavailable" kind="unavailable" note="not assumed clear" />
      </div>

      <div className="hx-metrics" aria-label="Live space-weather measurements">
        <Metric label="Bz GSM" value={formatValue(swpc?.bz_nt)} unit="nT" state={swpc?.bz_nt == null ? 'missing' : swpc.bz_nt < 0 ? 'south' : 'north'} note={`${swpc?.mag_source ?? 'RTSW'} · ${magAge.text}`} />
        <Metric label="Wind" value={formatValue(swpc?.speed_kms, 0)} unit="km/s" state={swpc?.speed_kms == null ? 'missing' : 'neutral'} note={`${swpc?.plasma_source ?? 'RTSW'} · ${plasmaAge.text}`} />
        <Metric label="Density" value={formatValue(swpc?.density)} unit="p/cm³" state={swpc?.density == null ? 'missing' : 'neutral'} note={`measured · ${plasmaAge.text}`} />
        <Metric label="Kp estimate" value={formatValue(swpc?.kp)} unit={gScale && gScale > 0 ? `G${gScale}` : 'index'} state={swpc?.kp == null ? 'missing' : 'neutral'} note={`1-min derived · ${ageLabel(swpc?.kp_measured_at, nowMs).text}`} />
        <Metric label="Dst" value={formatValue(swpc?.dst_nt, 0)} unit="nT" state={swpc?.dst_nt == null ? 'missing' : 'neutral'} note={`ring current · ${ageLabel(swpc?.dst_measured_at, nowMs).text}`} />
        <Metric label="Hp30" value={formatValue(swpc?.hp30)} unit="index" state={swpc?.hp30 == null ? 'missing' : 'neutral'} note={`GFZ nowcast · ${ageLabel(swpc?.hp30_measured_at, nowMs).text}`} />
      </div>

      <div className="hx-derived-strip" aria-label="Derived physics values">
        <div><span>L1→Earth</span><strong>{delayMinutes == null ? '—' : `${Math.round(delayMinutes)} min`}</strong><em className={provenanceClass(delayMinutes == null ? 'unavailable' : 'modelled')}>{delayMinutes == null ? 'unavailable' : 'modelled'}</em></div>
        <div><span>Dynamic pressure</span><strong>{pressure == null ? '—' : `${pressure.toFixed(1)} nPa`}</strong><em className={provenanceClass(pressure == null ? 'unavailable' : 'computed')}>{pressure == null ? 'unavailable' : 'computed'}</em></div>
        <div><span>Coupling gate</span><strong>{coupling == null ? '—' : swpc!.bz_nt! < 0 ? 'open' : 'restricted'}</strong><em className={provenanceClass(coupling == null ? 'unavailable' : 'modelled')}>{coupling == null ? 'unavailable' : 'Newell model'}</em></div>
      </div>

      <details className="hx-clock-ledger">
        <summary>Source clocks and data age</summary>
        <dl>
          <div><dt>Magnetic field</dt><dd>{formatUtc(swpc?.mag_measured_at)} · {swpc?.mag_source ?? 'unavailable'}{magAge.stale ? ' · stale' : ''}</dd></div>
          <div><dt>Plasma</dt><dd>{formatUtc(swpc?.plasma_measured_at)} · {swpc?.plasma_source ?? 'unavailable'}{plasmaAge.stale ? ' · stale' : ''}</dd></div>
          <div><dt>OVATION input</dt><dd>{formatUtc(swpc?.ovation_observed_at)}{ovationAge.stale ? ' · stale' : ''}</dd></div>
          <div><dt>OVATION forecast</dt><dd>{formatUtc(swpc?.ovation_forecast_at)}</dd></div>
          <div><dt>Browser receipt</dt><dd>{formatUtc(receivedAt)} · transport time, not measurement time</dd></div>
        </dl>
      </details>
    </section>
  );
}

function Gate({ label, value, note, kind }: { label: string; value: string; note: string; kind: 'measured' | 'modelled' | 'computed' | 'unavailable' }) {
  return <div><span>{label}</span><strong>{value}</strong><em className={provenanceClass(kind)}>{note}</em></div>;
}

function Metric({ label, value, unit, note, state }: { label: string; value: string; unit: string; note: string; state: 'south' | 'north' | 'neutral' | 'missing' }) {
  return (
    <div className="hx-metric" data-state={state}>
      <span>{label}</span>
      <strong>{value}<small>{unit}</small></strong>
      <em>{note}</em>
    </div>
  );
}
