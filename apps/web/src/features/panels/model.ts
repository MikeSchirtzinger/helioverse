import type {
  ClockBadgeModel,
  EventDetailModel,
  EventDetailRow,
  EventPrediction,
  HelioEvent,
  HelioSnapshot,
  KinematicsVersion,
  MetricPanelModel,
  MetricSeverity,
  MetricStripModel,
  MetricTrend,
  NoaaScaleBadge,
  SourceHealth,
  SparklinePoint,
  TimedValue,
} from './types';
import { classifyByBands, classifyNoaaScale, metricThresholds, parseNoaaScaleLevel } from './thresholds';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export function createMetricStripModel(snapshot: HelioSnapshot): MetricStripModel {
  return {
    generatedAt: snapshot.generated_at,
    spacecraft: snapshot.solar_wind.spacecraft,
    cadenceSeconds: snapshot.cadence_s,
    metrics: [
      createBzMetric(snapshot),
      createSpeedMetric(snapshot),
      createDensityMetric(snapshot),
      createBtMetric(snapshot),
      createKpMetric(snapshot),
      createDstMetric(snapshot),
      createProtonFluxMetric(snapshot),
    ],
    noaaScales: createNoaaScaleBadges(snapshot),
    clocks: createThreeClockBadges(snapshot),
    activeEventIds: snapshot.events_active,
    alerts: snapshot.alerts,
  };
}

export function createThreeClockBadges(snapshot: HelioSnapshot, nowIso = snapshot.generated_at): ClockBadgeModel[] {
  const nowMs = safeTime(nowIso);
  const sunSource = snapshot.sources.sdo_imagery ?? snapshot.sources.helioviewer;
  const sunAge = ageSeconds(snapshot.clocks.sun_imagery_at, nowMs, sunSource?.age_s ?? null);
  const l1Age = ageSeconds(snapshot.clocks.l1_measured_at, nowMs, snapshot.sources.swpc_mag.age_s ?? snapshot.sources.swpc_plasma.age_s);
  const modelAge = ageSeconds(snapshot.clocks.model_run_at, nowMs, snapshot.sources.donki.age_s);

  return [
    {
      id: 'sun',
      label: 'Sun clock',
      observedAt: snapshot.clocks.sun_imagery_at,
      ageSeconds: sunAge,
      status: sourceStatusWithAge(sunSource?.status ?? 'gap', sunAge, 45 * MINUTE),
      severity: sourceSeverity(sunSource?.status ?? 'gap', sunAge, 45 * MINUTE),
      description: 'Latest cached solar imagery texture. It is observational, but normally trails the Sun by about 15 minutes.',
      sourceLabel: sunSource === snapshot.sources.helioviewer ? 'Helioviewer' : 'SDO imagery',
    },
    {
      id: 'l1',
      label: 'L1 clock',
      observedAt: snapshot.clocks.l1_measured_at,
      ageSeconds: l1Age,
      status: sourceStatusWithAge(snapshot.sources.swpc_plasma.status, l1Age, 10 * MINUTE),
      severity: snapshot.l1_to_earth.delay_quality === 'degraded_fixed'
        ? 'elevated'
        : sourceSeverity(snapshot.sources.swpc_plasma.status, l1Age, 10 * MINUTE),
      description: 'Measured solar wind at L1, shifted to Earth with the real-delay correction when plasma is fresh.',
      sourceLabel: `${snapshot.solar_wind.spacecraft} / SWPC L1`,
      delaySeconds: snapshot.l1_to_earth.delay_s,
      delayQuality: snapshot.l1_to_earth.delay_quality,
    },
    {
      id: 'projection',
      label: 'Projection clock',
      observedAt: snapshot.clocks.model_run_at,
      ageSeconds: modelAge,
      status: sourceStatusWithAge(snapshot.sources.donki.status, modelAge, 6 * HOUR),
      severity: sourceSeverity(snapshot.sources.donki.status, modelAge, 6 * HOUR),
      description: 'Latest propagation/model as-of time for in-flight CME projections and widening uncertainty cones.',
      sourceLabel: 'DONKI / DBM inputs',
    },
  ];
}

export function createEventDetailModel(event: HelioEvent): EventDetailModel {
  const bestKinematics = getBestKinematics(event);
  const latestPrediction = getLatestPrediction(event);
  const status = event.outcome
    ? event.outcome.hit ? 'resolved' : 'missed'
    : event.predictions.length > 0 ? 'active' : 'cataloged';
  const arrivalErrorHours = computeArrivalErrorHours(latestPrediction, event.outcome);
  const rows: EventDetailRow[] = [
    { label: 'Detected', value: formatIso(event.detected_at) },
    { label: 'Liftoff / peak', value: event.liftoff_at ? formatIso(event.liftoff_at) : event.peak_at ? formatIso(event.peak_at) : 'n/a' },
    { label: 'Source', value: formatSourceRegion(event) },
    { label: 'Earth-bound score', value: formatPercent(event.earth_bound_score), severity: classifyProbability(event.earth_bound_score) },
    ...kinematicsRows(bestKinematics),
    ...predictionRows(latestPrediction),
    ...outcomeRows(event.outcome, arrivalErrorHours),
  ];

  return {
    id: event.id,
    type: event.type,
    status,
    title: `${event.type} ${event.id}`,
    subtitle: event.flare ? `${event.flare.class} flare-linked event` : `${event.provenance.catalog} event`,
    earthBoundScore: event.earth_bound_score,
    earthBoundSeverity: classifyProbability(event.earth_bound_score),
    bestKinematics,
    latestPrediction,
    outcome: event.outcome,
    arrivalErrorHours,
    thumbnail: event.thumbnail ?? null,
    rows,
    links: event.links,
    provenance: event.provenance,
  };
}

function createBzMetric(snapshot: HelioSnapshot): MetricPanelModel {
  const value = snapshot.solar_wind.bz_gsm_nt;
  return {
    key: 'bz',
    label: 'Bz GSM',
    value,
    formattedValue: formatNumber(value, 1),
    unit: 'nT',
    measuredAt: snapshot.solar_wind.measured_at,
    severity: classifyByBands(value, metricThresholds.bz),
    trend: trendFromNumbers(snapshot.solar_wind.series.bz_gsm_nt),
    sparkline: zipSeries(snapshot.solar_wind.series.t_unix, snapshot.solar_wind.series.bz_gsm_nt),
    thresholdBands: [...metricThresholds.bz],
    prominence: 'hero',
    description: 'Southward (negative) Bz is the short-fuse aurora trigger and gets first-class treatment.',
  };
}

function createSpeedMetric(snapshot: HelioSnapshot): MetricPanelModel {
  const value = snapshot.solar_wind.speed_kms;
  return {
    key: 'speed',
    label: 'Solar wind',
    value,
    formattedValue: formatNumber(value, 0),
    unit: 'km/s',
    measuredAt: snapshot.solar_wind.measured_at,
    severity: classifyByBands(value, metricThresholds.speed),
    trend: trendFromNumbers(snapshot.solar_wind.series.speed_kms),
    sparkline: zipSeries(snapshot.solar_wind.series.t_unix, snapshot.solar_wind.series.speed_kms),
    thresholdBands: [...metricThresholds.speed],
    prominence: 'normal',
    description: 'Bulk L1 solar-wind speed. Also determines the L1→Earth delay correction.',
  };
}

function createDensityMetric(snapshot: HelioSnapshot): MetricPanelModel {
  const value = snapshot.solar_wind.density_pcc;
  return {
    key: 'density',
    label: 'Density',
    value,
    formattedValue: formatNumber(value, 1),
    unit: 'p/cm³',
    measuredAt: snapshot.solar_wind.measured_at,
    severity: classifyByBands(value, metricThresholds.density),
    trend: trendFromNumbers(snapshot.solar_wind.series.density_pcc),
    sparkline: zipSeries(snapshot.solar_wind.series.t_unix, snapshot.solar_wind.series.density_pcc),
    thresholdBands: [...metricThresholds.density],
    prominence: 'normal',
    description: 'Plasma density; sudden compression can mark a sheath or shock arrival.',
  };
}

function createBtMetric(snapshot: HelioSnapshot): MetricPanelModel {
  const value = snapshot.solar_wind.bt_nt;
  return {
    key: 'bt',
    label: 'Bt',
    value,
    formattedValue: formatNumber(value, 1),
    unit: 'nT',
    measuredAt: snapshot.solar_wind.measured_at,
    severity: classifyByBands(value, metricThresholds.bt),
    trend: 'unknown',
    sparkline: [],
    thresholdBands: [...metricThresholds.bt],
    prominence: 'normal',
    description: 'Total IMF magnitude. It is most geoeffective when paired with southward Bz.',
  };
}

function createKpMetric(snapshot: HelioSnapshot): MetricPanelModel {
  const value = snapshot.indices.kp.value;
  const forecast = snapshot.indices.kp_forecast ?? [];
  const sparkline = [
    timedValueToPoint(snapshot.indices.kp),
    ...forecast.map((point) => ({ t: isoToUnix(point.valid_at), value: point.value })),
  ].filter((point): point is SparklinePoint => point !== null);
  return {
    key: 'kp',
    label: 'Kp',
    value,
    formattedValue: formatNumber(value, 2),
    unit: 'index',
    measuredAt: snapshot.indices.kp.measured_at,
    severity: classifyByBands(value, metricThresholds.kp),
    trend: trendFromPoints(sparkline),
    sparkline,
    thresholdBands: [...metricThresholds.kp],
    prominence: 'normal',
    description: 'Planetary K index and near-term forecast slots. Kp≥5 maps to NOAA G-scale storming.',
  };
}

function createDstMetric(snapshot: HelioSnapshot): MetricPanelModel {
  const value = snapshot.indices.dst_nt.value;
  const point = timedValueToPoint(snapshot.indices.dst_nt);
  return {
    key: 'dst',
    label: 'Dst',
    value,
    formattedValue: formatNumber(value, 0),
    unit: 'nT',
    measuredAt: snapshot.indices.dst_nt.measured_at,
    severity: classifyByBands(value, metricThresholds.dst),
    trend: 'unknown',
    sparkline: point ? [point] : [],
    thresholdBands: [...metricThresholds.dst],
    prominence: 'normal',
    description: 'Ring-current storm index. More negative values indicate stronger geomagnetic storming.',
  };
}

function createProtonFluxMetric(snapshot: HelioSnapshot): MetricPanelModel {
  const scale = snapshot.indices.noaa_scales.S;
  const level = parseNoaaScaleLevel(scale);
  const value = level === null ? null : Math.pow(10, level);
  const severity = classifyNoaaScale(scale);
  return {
    key: 'proton_flux',
    label: 'Proton flux',
    value,
    formattedValue: scale ? `${scale} proxy` : 'S0 / n/a',
    unit: '>10 MeV pfu',
    measuredAt: snapshot.indices.kp.measured_at,
    severity,
    trend: 'unknown',
    sparkline: [],
    thresholdBands: [...metricThresholds.proton_flux],
    prominence: 'normal',
    description: 'SEP/proton flux panel. Snapshot v1 exposes NOAA S-scale; direct pfu series can be added contract-additively later.',
    unavailableReason: scale ? undefined : 'No proton pfu scalar is present in snapshot v1; NOAA S-scale is quiet.',
  };
}

function createNoaaScaleBadges(snapshot: HelioSnapshot): NoaaScaleBadge[] {
  return [
    { scale: 'R', value: snapshot.indices.noaa_scales.R, severity: classifyNoaaScale(snapshot.indices.noaa_scales.R), label: 'Radio blackout' },
    { scale: 'S', value: snapshot.indices.noaa_scales.S, severity: classifyNoaaScale(snapshot.indices.noaa_scales.S), label: 'Solar radiation' },
    { scale: 'G', value: snapshot.indices.noaa_scales.G, severity: classifyNoaaScale(snapshot.indices.noaa_scales.G), label: 'Geomagnetic storm' },
  ];
}

function zipSeries(tUnix: number[], values: Array<number | null>): SparklinePoint[] {
  return values.map((value, index) => ({ t: tUnix[index] ?? index, value }));
}

function trendFromNumbers(values: Array<number | null>): MetricTrend {
  return trendFromPoints(values.map((value, index) => ({ t: index, value })));
}

function trendFromPoints(points: SparklinePoint[]): MetricTrend {
  const valid = points.map((point) => point.value).filter((value): value is number => value !== null && Number.isFinite(value));
  if (valid.length < 2) return 'unknown';
  const first = valid[0];
  const last = valid[valid.length - 1];
  if (first === undefined || last === undefined) return 'unknown';
  const delta = last - first;
  const tolerance = Math.max(0.05, Math.abs(first) * 0.01);
  if (delta > tolerance) return 'rising';
  if (delta < -tolerance) return 'falling';
  return 'flat';
}

function timedValueToPoint(value: TimedValue): SparklinePoint | null {
  if (!value.measured_at) return null;
  return { t: isoToUnix(value.measured_at), value: value.value };
}

function sourceStatusWithAge(status: SourceHealth, age: number | null, staleAfter: number): SourceHealth {
  if (status === 'gap' || age === null) return status;
  return age > staleAfter ? 'stale' : status;
}

function sourceSeverity(status: SourceHealth, age: number | null, staleAfter: number): MetricSeverity {
  if (status === 'gap' || age === null) return 'unknown';
  if (status === 'stale' || age > staleAfter) return 'elevated';
  return 'quiet';
}

function ageSeconds(observedAt: string | null, nowMs: number | null, sourceAge: number | null): number | null {
  if (sourceAge !== null && Number.isFinite(sourceAge)) return sourceAge;
  const observedMs = safeTime(observedAt);
  if (observedMs === null || nowMs === null) return null;
  return Math.max(0, Math.round((nowMs - observedMs) / 1000));
}

function safeTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function isoToUnix(iso: string): number {
  const ms = safeTime(iso);
  return ms === null ? 0 : Math.round(ms / 1000);
}

function getBestKinematics(event: HelioEvent): KinematicsVersion | null {
  return event.kinematics.find((version) => version.is_most_accurate) ?? event.kinematics.at(-1) ?? null;
}

function getLatestPrediction(event: HelioEvent): EventPrediction | null {
  return [...event.predictions].sort((a, b) => (safeTime(b.predicted_at) ?? 0) - (safeTime(a.predicted_at) ?? 0))[0] ?? null;
}

function computeArrivalErrorHours(prediction: EventPrediction | null, outcome: HelioEvent['outcome']): number | null {
  if (!prediction?.arrival || !outcome?.shock_arrival_at) return null;
  const predicted = safeTime(prediction.arrival.eta);
  const actual = safeTime(outcome.shock_arrival_at);
  if (predicted === null || actual === null) return null;
  return (predicted - actual) / (1000 * HOUR);
}

function kinematicsRows(kinematics: KinematicsVersion | null): EventDetailRow[] {
  if (!kinematics) return [{ label: 'Kinematics', value: 'n/a' }];
  return [
    { label: 'Speed', value: `${formatNumber(kinematics.speed_kms, 0)} km/s`, severity: classifyByBands(kinematics.speed_kms, metricThresholds.speed) },
    { label: 'Half-angle', value: `${formatNumber(kinematics.half_angle_deg, 0)}°${kinematics.is_halo ? ' halo' : ''}` },
    { label: 'Direction', value: `${formatNumber(kinematics.direction.lon_deg, 0)}° lon, ${formatNumber(kinematics.direction.lat_deg, 0)}° lat` },
    { label: 'Analysis', value: `v${kinematics.version} ${kinematics.measurement_technique ?? 'unknown'} @ ${formatIso(kinematics.measured_at)}` },
  ];
}

function predictionRows(prediction: EventPrediction | null): EventDetailRow[] {
  if (!prediction) return [{ label: 'Prediction', value: 'No active prediction' }];
  return [
    { label: 'Model', value: prediction.model },
    { label: 'Hit probability', value: formatPercent(prediction.hit_probability), severity: classifyProbability(prediction.hit_probability) },
    { label: 'Arrival window', value: prediction.arrival ? `${formatIso(prediction.arrival.window_start)} → ${formatIso(prediction.arrival.window_end)} (${formatPercent(prediction.arrival.window_ci)} CI)` : 'n/a' },
    { label: 'ETA', value: prediction.arrival ? formatIso(prediction.arrival.eta) : 'n/a' },
    { label: 'Predicted Kp / Dst', value: `${prediction.peak_kp ? formatNumber(prediction.peak_kp.value, 1) : 'n/a'} Kp, ${prediction.min_dst_nt ? formatNumber(prediction.min_dst_nt.value, 0) : 'n/a'} nT` },
  ];
}

function outcomeRows(outcome: HelioEvent['outcome'], arrivalErrorHours: number | null): EventDetailRow[] {
  if (!outcome) return [{ label: 'Outcome', value: 'Unresolved' }];
  return [
    { label: 'Outcome', value: outcome.hit ? 'Hit confirmed' : 'Miss', severity: outcome.hit ? 'storm' : 'quiet' },
    { label: 'Observed shock', value: outcome.shock_arrival_at ? formatIso(outcome.shock_arrival_at) : 'n/a' },
    { label: 'Predicted − observed', value: arrivalErrorHours === null ? 'n/a' : `${arrivalErrorHours.toFixed(1)} h` },
    { label: 'Observed Kp / Dst', value: `${outcome.peak_kp ?? 'n/a'} Kp, ${outcome.min_dst_nt ?? 'n/a'} nT` },
  ];
}

function formatSourceRegion(event: HelioEvent): string {
  const source = event.source_region;
  if (!source) return 'n/a';
  const ar = source.ar_number ? `AR ${source.ar_number}, ` : '';
  const instrument = source.instrument ? ` · ${source.instrument}` : '';
  return `${ar}${formatNumber(source.lon_deg, 0)}° lon, ${formatNumber(source.lat_deg, 0)}° lat${instrument}`;
}

function classifyProbability(value: number): MetricSeverity {
  if (value >= 0.8) return 'storm';
  if (value >= 0.55) return 'elevated';
  return 'quiet';
}

function formatNumber(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatIso(iso: string): string {
  return iso.replace('T', ' ').replace(/:00Z$/, 'Z');
}
