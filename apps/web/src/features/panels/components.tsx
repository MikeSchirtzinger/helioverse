import type { CSSProperties, ReactNode } from 'react';
import { createEventDetailModel, createMetricStripModel } from './model';
import { severityColors } from './thresholds';
import type {
  ClockBadgeModel,
  EventDetailModel,
  HelioEvent,
  HelioSnapshot,
  MetricPanelModel,
  MetricSeverity,
  MetricStripModel,
  SparklinePoint,
} from './types';

export interface MetricStripProps {
  snapshot?: HelioSnapshot;
  model?: MetricStripModel;
  title?: string;
}

export function MetricStrip({ snapshot, model, title = 'Live space-weather metrics' }: MetricStripProps) {
  const strip = model ?? (snapshot ? createMetricStripModel(snapshot) : null);
  if (!strip) return <EmptyPanel message="No metric snapshot loaded" />;

  const hero = strip.metrics.find((metric) => metric.prominence === 'hero');
  const metrics = strip.metrics.filter((metric) => metric !== hero);

  return (
    <section aria-label={title} style={styles.shell}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Metrics strip</p>
          <h2 style={styles.title}>{title}</h2>
        </div>
        <div style={styles.meta}>as of {formatClock(strip.generatedAt)} · {strip.spacecraft} · {strip.cadenceSeconds}s cadence</div>
      </header>

      <ClockBadges clocks={strip.clocks} />

      <div style={styles.metricsGrid}>
        {hero ? <MetricCard metric={hero} hero /> : null}
        {metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)}
      </div>

      <div style={styles.badgeRow} aria-label="NOAA scale badges">
        {strip.noaaScales.map((scale) => (
          <StatusPill key={scale.scale} severity={scale.severity} title={scale.label}>
            {scale.scale}: {scale.value ?? '0'}
          </StatusPill>
        ))}
        {strip.activeEventIds.length > 0 ? <StatusPill severity="elevated">{strip.activeEventIds.length} active event(s)</StatusPill> : null}
        {strip.alerts.map((alert) => <StatusPill key={`${alert.code}-${alert.issued_at}`} severity="storm">{alert.code}</StatusPill>)}
      </div>
    </section>
  );
}

export interface MetricCardProps {
  metric: MetricPanelModel;
  hero?: boolean;
}

export function MetricCard({ metric, hero = false }: MetricCardProps) {
  const color = severityColors[metric.severity];
  return (
    <article style={{ ...styles.card, ...(hero ? styles.heroCard : null), borderColor: color }}>
      <div style={styles.cardTopline}>
        <span style={styles.metricLabel}>{metric.label}</span>
        <StatusPill severity={metric.severity}>{metric.severity}</StatusPill>
      </div>
      <div style={styles.valueRow}>
        <span style={{ ...styles.metricValue, ...(hero ? styles.heroValue : null), color }}>{metric.formattedValue}</span>
        <span style={styles.unit}>{metric.unit}</span>
      </div>
      <Sparkline points={metric.sparkline} severity={metric.severity} prominent={hero} />
      <div style={styles.cardFooter}>
        <span>{trendLabel(metric.trend)}</span>
        <span>{metric.measuredAt ? formatClock(metric.measuredAt) : 'no timestamp'}</span>
      </div>
      {metric.unavailableReason ? <p style={styles.note}>{metric.unavailableReason}</p> : null}
    </article>
  );
}

export interface SparklineProps {
  points: SparklinePoint[];
  severity: MetricSeverity;
  prominent?: boolean;
}

export function Sparkline({ points, severity, prominent = false }: SparklineProps) {
  const width = 160;
  const height = prominent ? 54 : 42;
  const valid = points.filter((point) => point.value !== null && Number.isFinite(point.value));
  const color = severityColors[severity];

  if (valid.length === 0) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="No sparkline data" style={styles.sparkline}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#31405f" strokeDasharray="4 5" />
      </svg>
    );
  }

  if (valid.length === 1) {
    const only = valid[0];
    return (
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Single value ${only?.value ?? 'n/a'}`} style={styles.sparkline}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#31405f" />
        <circle cx={width - 8} cy={height / 2} r="3" fill={color} />
      </svg>
    );
  }

  const values = valid.map((point) => point.value).filter((value): value is number => value !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / Math.max(1, valid.length - 1);
  const polyline = valid.map((point, index) => {
    const value = point.value ?? min;
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Metric sparkline" style={styles.sparkline}>
      <line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke="#263653" />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={prominent ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockBadges({ clocks }: { clocks: ClockBadgeModel[] }) {
  return (
    <div style={styles.clockGrid} aria-label="Three clock badges">
      {clocks.map((clock) => (
        <div key={clock.id} style={{ ...styles.clockBadge, borderColor: severityColors[clock.severity] }} title={clock.description}>
          <span style={styles.clockLabel}>{clock.label}</span>
          <strong style={{ color: severityColors[clock.severity] }}>{clock.observedAt ? relativeAge(clock.ageSeconds) : 'gap'}</strong>
          <span style={styles.clockDetail}>{clock.sourceLabel}</span>
          {clock.delaySeconds !== undefined ? <span style={styles.clockDetail}>Earth lag {formatDuration(clock.delaySeconds)} · {clock.delayQuality}</span> : null}
        </div>
      ))}
    </div>
  );
}

export interface EventDetailPanelProps {
  event?: HelioEvent;
  model?: EventDetailModel;
}

export function EventDetailPanel({ event, model }: EventDetailPanelProps) {
  const detail = model ?? (event ? createEventDetailModel(event) : null);
  if (!detail) return <EmptyPanel message="No event selected" />;

  return (
    <section aria-label="Event detail panel" style={styles.detailShell}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Event detail</p>
          <h2 style={styles.title}>{detail.title}</h2>
          <p style={styles.subtitle}>{detail.subtitle}</p>
        </div>
        <StatusPill severity={detail.earthBoundSeverity}>Earth-bound {Math.round(detail.earthBoundScore * 100)}%</StatusPill>
      </header>

      <div style={styles.detailGrid}>
        <div style={styles.thumbnailBox}>
          {detail.thumbnail ? (
            <>
              <div style={styles.thumbnailPlaceholder}>{detail.thumbnail.wavelength}</div>
              <code style={styles.r2Key}>{detail.thumbnail.r2_key}</code>
            </>
          ) : (
            <span style={styles.muted}>No thumbnail</span>
          )}
        </div>
        <dl style={styles.detailList}>
          {detail.rows.map((row) => (
            <div key={`${row.label}-${row.value}`} style={styles.detailRow}>
              <dt style={styles.detailTerm}>{row.label}</dt>
              <dd style={{ ...styles.detailValue, color: row.severity ? severityColors[row.severity] : undefined }}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <footer style={styles.linksRow}>
        {detail.links.length === 0 ? <span style={styles.muted}>No linked events</span> : detail.links.map((link) => (
          <StatusPill key={`${link.rel}-${link.id}`} severity="unknown">{link.rel}: {link.id}</StatusPill>
        ))}
      </footer>
    </section>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return <section style={styles.shell}><p style={styles.muted}>{message}</p></section>;
}

function StatusPill({ severity, children, title }: { severity: MetricSeverity; children: ReactNode; title?: string }) {
  return (
    <span title={title} style={{ ...styles.pill, color: severityColors[severity], borderColor: severityColors[severity] }}>
      {children}
    </span>
  );
}

function trendLabel(trend: MetricPanelModel['trend']): string {
  switch (trend) {
    case 'rising': return '↗ rising';
    case 'falling': return '↘ falling';
    case 'flat': return '→ flat';
    case 'unknown': return 'trend n/a';
  }
}

function formatClock(iso: string): string {
  return iso.replace('T', ' ').replace(/:00Z$/, 'Z');
}

function relativeAge(seconds: number | null): string {
  if (seconds === null) return 'unknown age';
  return `${formatDuration(seconds)} old`;
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

const styles = {
  shell: {
    padding: '16px',
    background: 'linear-gradient(180deg, rgba(10, 16, 34, 0.96), rgba(7, 10, 22, 0.96))',
    border: '1px solid rgba(130, 160, 255, 0.18)',
    borderRadius: 18,
    color: '#e8f0ff',
  },
  detailShell: {
    padding: '16px',
    background: 'rgba(8, 12, 26, 0.96)',
    border: '1px solid rgba(130, 160, 255, 0.18)',
    borderRadius: 18,
    color: '#e8f0ff',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  eyebrow: {
    color: '#8ea5d9',
    fontSize: 12,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    margin: 0,
  },
  title: {
    fontSize: 18,
    margin: '2px 0 0',
  },
  subtitle: {
    color: '#aab8d5',
    margin: '4px 0 0',
  },
  meta: {
    color: '#9ba9c9',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 1.4fr) repeat(6, minmax(150px, 1fr))',
    gap: 10,
    overflowX: 'auto',
  },
  card: {
    minWidth: 150,
    border: '1px solid',
    borderRadius: 14,
    padding: 12,
    background: 'rgba(14, 23, 45, 0.86)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
  },
  heroCard: {
    minWidth: 240,
    background: 'radial-gradient(circle at top left, rgba(255,92,122,0.18), rgba(14,23,45,0.9) 55%)',
  },
  cardTopline: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 13,
    color: '#b9c6e6',
  },
  valueRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 8,
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 1,
    fontWeight: 800,
  },
  heroValue: {
    fontSize: 46,
  },
  unit: {
    color: '#93a1c5',
    fontSize: 12,
  },
  sparkline: {
    width: '100%',
    marginTop: 8,
    display: 'block',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#8d9abc',
    fontSize: 11,
    gap: 8,
    marginTop: 6,
  },
  note: {
    color: '#8d9abc',
    fontSize: 11,
    marginTop: 6,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid',
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(255,255,255,0.04)',
    whiteSpace: 'nowrap',
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  clockGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  clockBadge: {
    display: 'grid',
    gap: 2,
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    background: 'rgba(255,255,255,0.035)',
  },
  clockLabel: {
    color: '#9eb0d6',
    fontSize: 12,
  },
  clockDetail: {
    color: '#8391b5',
    fontSize: 11,
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: '160px 1fr',
    gap: 14,
  },
  thumbnailBox: {
    minHeight: 150,
    border: '1px dashed rgba(142, 165, 217, 0.45)',
    borderRadius: 14,
    padding: 10,
    display: 'grid',
    alignContent: 'center',
    gap: 8,
    textAlign: 'center',
  },
  thumbnailPlaceholder: {
    minHeight: 88,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 10,
    background: 'radial-gradient(circle, rgba(255,166,77,0.28), rgba(255,92,122,0.12) 45%, rgba(255,255,255,0.04))',
    color: '#ffd9b0',
    fontWeight: 800,
  },
  r2Key: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    color: '#8ea5d9',
    fontSize: 10,
  },
  detailList: {
    display: 'grid',
    gap: 8,
    margin: 0,
  },
  detailRow: {
    display: 'grid',
    gridTemplateColumns: '150px 1fr',
    gap: 10,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    paddingBottom: 6,
  },
  detailTerm: {
    color: '#8ea5d9',
    fontSize: 12,
  },
  detailValue: {
    margin: 0,
    color: '#e8f0ff',
    fontSize: 13,
  },
  linksRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  muted: {
    color: '#8391b5',
  },
} satisfies Record<string, CSSProperties>;
