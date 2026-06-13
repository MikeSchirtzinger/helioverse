import type { CmeEventData, SceneFromFixtures } from '@/scene';
import type { DashboardReadiness } from './adapters';
import { formatUtc } from './adapters';

export interface ScenePreviewProps {
  scene: SceneFromFixtures;
  readiness: DashboardReadiness;
}

export function ScenePreview({ scene, readiness }: ScenePreviewProps) {
  const activeEvent = scene.activeEvents[0] ?? null;

  return (
    <section id="scene-viewport" className="hv-card hv-scene-card" aria-label="Fixture heliosphere scene preview">
      <header className="hv-section-header">
        <div>
          <p className="hv-eyebrow">Scene status / preview</p>
          <h1>Earth-coupled heliosphere fixture dashboard</h1>
        </div>
        <div className="hv-status-stack" aria-label="Scene readiness">
          <span className="hv-pill hv-pill-ready">Scene data ready</span>
          <span className="hv-pill">WebGPU primary · WebGL2 fallback</span>
        </div>
      </header>

      <div className="hv-scene-layout">
        <div className="hv-orbit-preview" role="img" aria-label="Sun to Earth CME cone preview">
          <svg viewBox="0 0 720 320" className="hv-orbit-svg">
            <defs>
              <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#fff7ad" />
                <stop offset="48%" stopColor="#f97316" />
                <stop offset="100%" stopColor="#7c2d12" />
              </radialGradient>
              <radialGradient id="earthGlow" cx="40%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#bae6fd" />
                <stop offset="52%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#0f172a" />
              </radialGradient>
              <linearGradient id="cmeCone" x1="0%" x2="100%">
                <stop offset="0%" stopColor="rgba(251, 191, 36, 0.7)" />
                <stop offset="65%" stopColor="rgba(249, 115, 22, 0.22)" />
                <stop offset="100%" stopColor="rgba(56, 189, 248, 0.28)" />
              </linearGradient>
              <filter id="softGlow">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <path d="M108 160 C220 84 360 74 626 160" className="hv-parker-line" />
            <path d="M108 160 C236 224 394 232 626 160" className="hv-parker-line hv-parker-line-two" />
            <path d="M130 142 L606 88 L638 160 L606 232 L130 178 Z" fill="url(#cmeCone)" stroke="rgba(251, 191, 36, 0.36)" strokeWidth="2" />
            <circle cx="108" cy="160" r="50" fill="url(#sunGlow)" filter="url(#softGlow)" />
            <circle cx="602" cy="160" r="13" className="hv-l1-dot" />
            <circle cx="638" cy="160" r="27" fill="url(#earthGlow)" />
            <circle cx="638" cy="160" r="42" className="hv-aurora-ring" />
            <path d="M616 141 C632 126 653 133 664 151" className="hv-magnetopause" />
            <text x="80" y="238" className="hv-svg-label">Sun · 304Å fixture</text>
            <text x="570" y="128" className="hv-svg-label">L1</text>
            <text x="608" y="226" className="hv-svg-label">Earth + oval</text>
            <text x="246" y="62" className="hv-svg-title">{activeEvent ? shortId(activeEvent.id) : 'No active event'}</text>
          </svg>
        </div>

        <div className="hv-scene-readout">
          <Readout label="Epoch" value={new Date(scene.epoch_unix * 1000).toISOString().replace('.000Z', 'Z')} />
          <Readout label="Earth distance" value={`${(scene.earth.position.r_km / 149_597_870).toFixed(2)} AU`} />
          <Readout label="L1 craft" value={`${scene.l1.spacecraft} · ${(scene.l1.earthDistance_km / 1_000_000).toFixed(2)} Mkm upstream`} />
          <Readout label="Parker grid" value={`${scene.parkerGridDefaults.speed_kms.toFixed(0)} km/s · ${scene.parkerGridDefaults.isDegraded ? 'degraded' : 'measured'}`} />
          {activeEvent ? <EventReadout event={activeEvent} readiness={readiness} /> : null}
        </div>
      </div>
    </section>
  );
}

function EventReadout({ event, readiness }: { event: CmeEventData; readiness: DashboardReadiness }) {
  return (
    <div className="hv-b3-box">
      <p className="hv-eyebrow">B3 tie-in readiness</p>
      <h2>{readiness.b3.label}</h2>
      <p>
        Earth-coupled active event <strong>{shortId(event.id)}</strong> is rendered as a CME cone in-scene and lights the same Earth/oval context used by the aurora panel.
      </p>
      <div className="hv-mini-grid">
        <span>Earth-bound {readiness.b3.scorePct}%</span>
        <span>{event.speed_kms.toFixed(0)} km/s</span>
        <span>{event.halfAngle_deg.toFixed(0)}° cone</span>
        <span>{event.isHalo ? 'halo CME' : 'partial CME'}</span>
      </div>
      <small>Arrival window: {readiness.b3.arrivalWindow}</small>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="hv-readout">
      <span>{label}</span>
      <strong>{formatUtc(value)}</strong>
    </div>
  );
}

function shortId(eventId: string): string {
  return eventId.split('Z-')[1] ?? eventId;
}
