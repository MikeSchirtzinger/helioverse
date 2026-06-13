import { useMemo, useState, type ReactNode } from 'react';
import { AuroraPanel } from '@/features/aurora';
import { EventDetailPanel, MetricStrip } from '@/features/panels';
import { TimelineScrubber, type IsoUtcString, type TimelineFocusPayload, type TimelineMode } from '@/features/timeline';
import { buildFixtureDashboardModel, findDashboardEvent, formatUtc } from './adapters';
import { ScenePreview } from './ScenePreview';

export function FixtureDashboard() {
  const model = useMemo(() => buildFixtureDashboardModel(), []);
  const [selectedTimeIso, setSelectedTimeIso] = useState<IsoUtcString>(model.timeline.window.liveAtIso);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('live');
  const [focus, setFocus] = useState<TimelineFocusPayload | null>(null);
  const selectedEvent = focus ? findDashboardEvent(model, focus.eventId) : model.activeEvent;

  const onTimeChange = (timeIso: IsoUtcString, mode: TimelineMode) => {
    setSelectedTimeIso(timeIso);
    setTimelineMode(mode);
  };

  return (
    <main className="hv-dashboard" aria-label="Helioverse Wave-2 fixture dashboard">
      <ScenePreview scene={model.scene} readiness={model.readiness} />

      <section className="hv-readiness-grid" aria-label="Integration readiness indicators">
        <ReadinessCard title="B3 scene ⇄ oval tie-in" tone="ready">
          <p>{model.readiness.b3.ovalContext}</p>
          <strong>{model.readiness.b3.scorePct}% Earth-bound · predicted Kp {model.readiness.b3.predictedKp?.toFixed(1) ?? 'n/a'}</strong>
        </ReadinessCard>
        <ReadinessCard title="Ours vs NOAA timing" tone="ready">
          <p>{model.readiness.noaa.text}</p>
          <strong>OVATION forecast {formatUtc(model.snapshot.ovation.forecast_time)} · grid {model.snapshot.ovation.grid_r2_key}</strong>
        </ReadinessCard>
        <ReadinessCard title="Three clocks" tone="ready">
          <ul className="hv-clock-list">
            {model.readiness.clocks.map((clock) => (
              <li key={clock.id} className={clock.status === 'ready' ? 'is-ready' : 'is-degraded'}>
                <span>{clock.label}</span>
                <strong>{clock.text}</strong>
              </li>
            ))}
          </ul>
        </ReadinessCard>
        <ReadinessCard title="Scrub / hindcast safety" tone={model.readiness.scrubSafety.frame.leakageSafe ? 'ready' : 'degraded'}>
          <p>{model.readiness.scrubSafety.text}</p>
          <strong>Current scrubber mode: {timelineMode} · view {formatUtc(selectedTimeIso)}</strong>
        </ReadinessCard>
      </section>

      <section id="metrics-strip" className="hv-dashboard-section hv-metrics-section">
        <MetricStrip snapshot={model.snapshot} title="Fixture metric strip — Bz trigger prominent" />
      </section>

      <section className="hv-main-grid">
        <div id="aurora-panel" className="hv-dashboard-section hv-aurora-section">
          <div className="hv-section-callout">
            <span className="hv-pill hv-pill-ready">Aurora oval context</span>
            <p>
              The active Earth-coupled event <strong>{model.readiness.b3.eventId}</strong> is also listed in the aurora panel, while the measured-delay OVATION context supplies the ours-vs-NOAA readiness copy.
            </p>
          </div>
          <AuroraPanel snapshot={model.snapshot} showNoaaComparison />
        </div>

        <div className="hv-dashboard-section hv-detail-section">
          <EventDetailPanel event={selectedEvent} />
        </div>
      </section>

      <section id="timeline" className="hv-dashboard-section hv-timeline-section">
        <TimelineScrubber
          model={model.timeline}
          valueIso={selectedTimeIso}
          onTimeChange={onTimeChange}
          onFocusEvent={setFocus}
        />
        <div className="hv-hindcast-note" role="status">
          <span className="hv-pill hv-pill-ready">Honest hindcast</span>
          <p>
            Safety frame checks <strong>{formatUtc(model.readiness.scrubSafety.frame.inputsAsOfIso)}</strong>: leakageSafe={String(model.readiness.scrubSafety.frame.leakageSafe)}, selected revisions={model.readiness.scrubSafety.frame.availableKinematics.length}, active prediction={model.readiness.scrubSafety.frame.activePrediction ? 'visible' : 'withheld'}.
          </p>
        </div>
      </section>
    </main>
  );
}

function ReadinessCard({ title, tone, children }: { title: string; tone: 'ready' | 'degraded'; children: ReactNode }) {
  return (
    <article className={`hv-readiness-card ${tone === 'ready' ? 'is-ready' : 'is-degraded'}`}>
      <h2>{title}</h2>
      {children}
    </article>
  );
}
