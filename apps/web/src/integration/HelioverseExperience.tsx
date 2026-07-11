import { useEffect, useMemo, useRef, useState } from 'react';
import { CurrentConditions } from '@/features/conditions/CurrentConditions';
import { useUserLocation } from '@/features/conditions/use-user-location';
import { LearningPanel } from '@/features/learn/LearningPanel';
import { CAUSAL_STEPS, getCausalStep, type CausalStepId } from '@/features/learn/knowledge';
import { useDonkiFeeds } from '@/features/live/use-donki-feeds';
import { useLiveCmes } from '@/features/live/use-live-cmes';
import { useSwpcNow } from '@/features/live/use-swpc-now';
import { PredictionLab } from '@/features/model/PredictionLab';
import {
  CANVAS_LAYERS,
  DEFAULT_CANVAS_LAYERS,
  SOLAR_FILTERS,
  type CanvasCme,
  type CanvasInteractionMode,
  type CanvasLayers,
  type SolarFilter,
  type SwpcNow,
} from '@/scene/canvas-contract';
import { CanvasTimeBar } from '@/scene/CanvasTimeBar';
import { createSceneBundle, type SceneFoundation } from '@/scene/scene-data';
import type { CmeEventData } from '@/scene/types';
import type { LiveScene } from '@/scene/live-cmes';
import { DonkiEventFeed } from './DonkiEventFeed';
import { SceneStage, type ImpactSummary } from './SceneStage';
import { CmeDetail, FlareDetail, LiveCmeDetail, LiveCmeList, StormEventsList } from './scene-events';
import { JUNE_2026_STORM, primaryCme as replayPrimaryCme } from './storm-scenario';

type SceneMode = 'live' | 'replay';
type PanelId = 'now' | 'events' | 'learn' | 'model';

const isoOf = (unix: number): string => new Date(unix * 1000).toISOString().replace('.000Z', 'Z');
const nowIso = (): string => new Date().toISOString().replace('.000Z', 'Z');

function fmtUtc(iso: string | null | undefined): string {
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

function liveAuroraSummary(swpc: SwpcNow | null): ImpactSummary {
  if (!swpc?.auroraGrid?.length) {
    return {
      eyebrow: 'Aurora nowcast',
      title: 'OVATION grid unavailable',
      line: 'No probability surface is substituted while the NOAA model output is missing.',
    };
  }
  return {
    eyebrow: 'Aurora nowcast',
    title: swpc.auroraEdgeLatDeg == null
      ? 'Measured-driven probability surface'
      : `10% oval edge near ${swpc.auroraEdgeLatDeg.toFixed(0)}° N`,
    line: `NOAA OVATION input ${fmtUtc(swpc.ovation_observed_at)} → forecast ${fmtUtc(swpc.ovation_forecast_at)} · modelled`,
  };
}

function replayImpactSummary(): ImpactSummary {
  const scenario = JUNE_2026_STORM;
  return {
    eyebrow: 'Historical Earth outcome',
    title: `${scenario.outcome.stormLevel} · historical outcome`,
    line: `Forecast was ${scenario.outcome.predictedLevel}; observed shock ${fmtUtc(replayPrimaryCme(scenario).actualEtaIso)}`,
  };
}

function historicalLiveAuroraSummary(): ImpactSummary {
  return {
    eyebrow: 'Historical event time',
    title: 'Current OVATION withheld',
    line: 'NOAA publishes a latest-only grid; it cannot be assigned to this scrubbed event time.',
  };
}

function makeSceneFoundation(epochUnix: number): SceneFoundation {
  const scene = createSceneBundle(epochUnix, [], null, 'L1 monitor');
  return {
    ...scene,
    parkerGridDefaults: {
      // Geometry is created at a neutral seed speed then immediately hidden or
      // rebuilt from a measured RTSW speed by HelioCanvas. It is never surfaced
      // as a measurement.
      speed_kms: 400,
      isDegraded: true,
    },
  };
}

function defaultLiveTimelineWindow(): { start: string; end: string } {
  const now = Date.now();
  return {
    start: new Date(now - 7 * 86_400_000).toISOString(),
    end: new Date(now + 4 * 86_400_000).toISOString(),
  };
}

export function HelioverseExperience() {
  const scenario = JUNE_2026_STORM;
  const bootUnix = useRef(Math.floor(Date.now() / 1000)).current;
  const sceneFoundation = useMemo(() => makeSceneFoundation(bootUnix), [bootUnix]);

  const [sceneMode, setSceneMode] = useState<SceneMode>('live');
  const [selectedTimeIso, setSelectedTimeIso] = useState(nowIso);
  const [followNow, setFollowNow] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<CausalStepId>('sun');
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>('solar-focus');
  const [solarFilter, setSolarFilter] = useState<SolarFilter>('sdo193');
  const [layers, setLayers] = useState<CanvasLayers>(DEFAULT_CANVAS_LAYERS);
  const [activePanel, setActivePanel] = useState<PanelId>('now');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeedHoursPerSecond, setPlaybackSpeedHoursPerSecond] = useState(6);
  const selectedTimeRef = useRef(selectedTimeIso);
  selectedTimeRef.current = selectedTimeIso;

  const userLocation = useUserLocation();
  const swpc = useSwpcNow();
  const live = useLiveCmes();
  const donki = useDonkiFeeds();
  const liveScene = live.scene;

  // A live clock follows wall time until the user deliberately scrubs away.
  useEffect(() => {
    if (sceneMode !== 'live' || !followNow || isPlaying) return undefined;
    const sync = () => setSelectedTimeIso(nowIso());
    sync();
    const timer = window.setInterval(sync, 30_000);
    return () => window.clearInterval(timer);
  }, [sceneMode, followNow, isPlaying]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [drawerOpen]);

  useEffect(() => {
    setIsPlaying(false);
    if (sceneMode === 'live') {
      setSelectedTimeIso(nowIso());
      setFollowNow(true);
      setSelectedId(null);
    } else {
      setSelectedTimeIso(scenario.defaultClockIso);
      setFollowNow(false);
      setSelectedId(scenario.primaryCmeId);
    }
  }, [sceneMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const replayCmes = useMemo<CanvasCme[]>(
    () => scenario.cmes.map((cme) => ({ event: cme, label: cme.name, color: cme.color })),
    [scenario],
  );

  // A quiet or unreachable live feed stays a quiet/unavailable LIVE scene.
  // It never swaps in a historical replay without the user's explicit choice.
  const liveCmes = useMemo(() => {
    if (!liveScene) return [];
    const selected = liveScene.views.find((view) => view.canvas.event.id === selectedId);
    if (!selected || liveScene.cmes.some((cme) => cme.event.id === selected.canvas.event.id)) return liveScene.cmes;
    // Selecting a ledger-only CME promotes it into the capped scene without
    // increasing GPU load or hiding it behind an apparently inert selection.
    return liveScene.cmes.length > 0
      ? [...liveScene.cmes.slice(0, -1), selected.canvas]
      : [selected.canvas];
  }, [liveScene, selectedId]);
  const cmes = sceneMode === 'live' ? liveCmes : replayCmes;
  const primaryId = sceneMode === 'live' ? (liveScene?.primaryId ?? null) : scenario.primaryCmeId;
  const primaryEvent: CmeEventData | null = sceneMode === 'live'
    ? (liveScene?.primaryEvent ?? null)
    : replayPrimaryCme(scenario);
  const liveWindow = defaultLiveTimelineWindow();
  const windowStartIso = sceneMode === 'live' ? (liveScene?.windowStartIso ?? liveWindow.start) : scenario.windowStartIso;
  const windowEndIso = sceneMode === 'live' ? (liveScene?.windowEndIso ?? liveWindow.end) : scenario.windowEndIso;
  const milestones = sceneMode === 'live' ? (liveScene?.milestones ?? []) : scenario.milestones;
  const timelineEvent = primaryEvent ?? cmes[0]?.event ?? null;
  const windowEndRef = useRef(windowEndIso);
  windowEndRef.current = windowEndIso;

  // One shared clock drives both the desktop and mobile controls. Keeping the
  // advancement here prevents hidden duplicate timebars from racing each other.
  useEffect(() => {
    if (!isPlaying) return undefined;
    let frame = 0;
    let last = performance.now();
    const advance = (now: number) => {
      const elapsedSeconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      const endMs = Date.parse(windowEndRef.current);
      const currentMs = Date.parse(selectedTimeRef.current);
      const nextMs = Math.min(endMs, currentMs + elapsedSeconds * playbackSpeedHoursPerSecond * 3_600_000);
      const nextIso = new Date(nextMs).toISOString().replace('.000Z', 'Z');
      selectedTimeRef.current = nextIso;
      setSelectedTimeIso(nextIso);
      if (nextMs >= endMs) setIsPlaying(false);
      else frame = window.requestAnimationFrame(advance);
    };
    frame = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(frame);
  }, [isPlaying, playbackSpeedHoursPerSecond]);

  const liveSceneState = live.loading
    ? 'loading DONKI events'
    : live.error
      ? 'DONKI event feed unavailable'
      : liveScene
        ? `${liveScene.shown} of ${liveScene.totalDetected} CMEs drawn`
        : 'quiet Sun · no renderable CME in 7 days';
  const statusLine = sceneMode === 'live'
    ? `LIVE EVENT LAYER · ${liveSceneState}`
    : `HISTORICAL REPLAY · ${scenario.name}`;

  const selectedLiveView = liveScene?.views.find((view) => view.canvas.event.id === selectedId) ?? null;
  const selectedReplayCme = scenario.cmes.find((cme) => cme.id === selectedId) ?? null;
  const selectedReplayFlare = scenario.flares.find((flare) => flare.id === selectedId) ?? null;

  const selectEvent = (id: string | null) => {
    setSelectedId(id);
    if (!id) return;
    setActivePanel('events');
    if (sceneMode === 'live') {
      const view = liveScene?.views.find((item) => item.canvas.event.id === id);
      if (view) {
        setSelectedTimeIso(isoOf(view.canvas.event.liftoff_unix));
        setFollowNow(false);
      }
    } else {
      const flare = scenario.flares.find((item) => item.id === id);
      const cme = scenario.cmes.find((item) => item.id === id);
      if (flare) setSelectedTimeIso(flare.peakIso);
      if (cme) setSelectedTimeIso(isoOf(cme.liftoff_unix));
    }
  };

  const selectStep = (id: CausalStepId) => {
    const step = getCausalStep(id);
    setActiveStep(id);
    setInteractionMode(step.cameraMode);
    if (step.solarFilter) setSolarFilter(step.solarFilter);
    if (sceneMode === 'live' && ['l1', 'coupling', 'magnetosphere', 'aurora'].includes(id)) {
      // NOAA's public RTSW/OVATION surfaces are latest-only. Earth-space stages
      // return to wall-clock now instead of painting today's inputs onto a
      // scrubbed historical event frame.
      setFollowNow(true);
      setSelectedTimeIso(nowIso());
      setSelectedId(null);
    }
  };

  const openPanel = (panel: PanelId) => {
    setActivePanel(panel);
    setDrawerOpen(true);
  };

  const selectedStep = getCausalStep(activeStep);
  const hasRtsw = swpc.data?.mag_measured_at != null || swpc.data?.plasma_measured_at != null;
  const currentBz = swpc.data?.bz_nt;
  const currentFeedsApply = sceneMode === 'live' && followNow;

  const setJourneyPlaying = (playing: boolean) => {
    if (playing) {
      const endMs = Date.parse(windowEndIso);
      if (Date.parse(selectedTimeIso) >= endMs - 1_000) {
        selectedTimeRef.current = windowStartIso;
        setSelectedTimeIso(windowStartIso);
      }
      setFollowNow(false);
    }
    setIsPlaying(playing);
  };

  const timeline = timelineEvent ? (
    <CanvasTimeBar
      key={`${sceneMode}-${timelineEvent.id}`}
      windowStartIso={windowStartIso}
      windowEndIso={windowEndIso}
      valueIso={selectedTimeIso}
      onChange={(value) => {
        setSelectedTimeIso(value);
        setFollowNow(false);
      }}
      playing={isPlaying}
      speedHoursPerSecond={playbackSpeedHoursPerSecond}
      onPlayingChange={setJourneyPlaying}
      onSpeedChange={setPlaybackSpeedHoursPerSecond}
      milestones={milestones}
      event={timelineEvent}
      regionLabel={sceneMode === 'live' ? 'NASA DONKI event' : scenario.region}
    />
  ) : null;

  return (
    <main className="hx-app" data-drawer-open={drawerOpen} data-mode={sceneMode} data-step={activeStep} data-follow-now={currentFeedsApply}>
      <a className="hx-skip" href="#hx-instrument-panel">Skip to instrument data</a>

      <SceneStage
        scene={sceneFoundation}
        cmes={cmes}
        valueIso={selectedTimeIso}
        selectedId={selectedId}
        interactionMode={interactionMode}
        solarFilter={solarFilter}
        layers={layers}
        onSelectEvent={selectEvent}
        auroraGrid={currentFeedsApply ? swpc.data?.auroraGrid : null}
        solarWindSpeedKms={currentFeedsApply ? swpc.data?.speed_kms ?? null : null}
        solarWindDensity={currentFeedsApply ? swpc.data?.density ?? null : null}
        solarWindBzNt={currentFeedsApply ? swpc.data?.bz_nt ?? null : null}
        allowEventModelMagnetosphere={sceneMode === 'replay'}
        primaryEventId={primaryId}
        primaryEvent={primaryEvent}
        impactSummary={sceneMode === 'live' ? (currentFeedsApply ? liveAuroraSummary(swpc.data) : historicalLiveAuroraSummary()) : replayImpactSummary()}
        statusLine={statusLine}
        isPlaying={isPlaying || (sceneMode === 'live' && followNow)}
        freezeSolarImagery={isPlaying}
        rightRailOpen={drawerOpen}
      />

      <header className="hx-header">
        <div className="hx-brand">
          <span className="hx-mark" aria-hidden="true" />
          <div><h1 id="hv-scene-title">HELIOVERSE</h1><p>Sun → field → aurora</p></div>
        </div>
        <div className="hx-mode-switch" role="group" aria-label="Scene time source">
          <button type="button" className={sceneMode === 'live' ? 'is-active' : ''} aria-pressed={sceneMode === 'live'} onClick={() => setSceneMode('live')}>
            <span aria-hidden="true" /> Live
          </button>
          <button type="button" className={sceneMode === 'replay' ? 'is-active' : ''} aria-pressed={sceneMode === 'replay'} onClick={() => setSceneMode('replay')}>
            Replay
          </button>
        </div>
        <button type="button" className="hx-data-clock" onClick={() => openPanel('now')} data-live={currentFeedsApply && hasRtsw}>
          <span>{currentFeedsApply ? (hasRtsw ? `${swpc.data?.mag_source ?? swpc.data?.plasma_source ?? 'RTSW'} measured` : 'L1 unavailable') : sceneMode === 'replay' ? 'Historical replay' : 'Historical event time'}</span>
          <strong>{currentFeedsApply ? 'NOW' : fmtUtc(selectedTimeIso)}</strong>
        </button>
      </header>

      <nav className="hx-chain" aria-label="Sun to aurora causal chain">
        {CAUSAL_STEPS.map((step) => (
          <button key={step.id} type="button" className={activeStep === step.id ? 'is-active' : ''} aria-current={activeStep === step.id ? 'step' : undefined} onClick={() => selectStep(step.id)}>
            <span>{step.index}</span><strong>{step.shortLabel}</strong>
          </button>
        ))}
      </nav>

      <section key={activeStep} className="hx-scene-caption" aria-live="polite">
        <div className="hx-scene-caption-context"><span>{selectedStep.index}</span><p>{selectedStep.question}</p></div>
        <strong>{selectedStep.title}</strong>
        <div className="hx-scene-caption-actions">
          {timelineEvent ? (
            <button type="button" className="hx-journey-toggle" aria-pressed={isPlaying} aria-label={isPlaying ? 'Pause journey' : 'Play journey'} onClick={() => setJourneyPlaying(!isPlaying)}>
              <span className="hx-action-label-long">{isPlaying ? 'Pause journey' : 'Play journey'}</span>
              <span className="hx-action-label-short" aria-hidden="true">{isPlaying ? 'Pause' : 'Play'}</span>
            </button>
          ) : null}
          <button type="button" aria-label="Explain this stage" onClick={() => openPanel('learn')}>
            <span className="hx-action-label-long">Explain stage</span>
            <span className="hx-action-label-short" aria-hidden="true">Explain</span>
          </button>
        </div>
      </section>

      {!drawerOpen ? (
        <div className="hx-gesture-hint" aria-hidden="true">
          <span className="hx-gesture-hint--pointer">Drag to orbit · scroll to zoom</span>
          <span className="hx-gesture-hint--touch">Drag to orbit · pinch to zoom</span>
        </div>
      ) : null}

      <button type="button" className="hx-now-peek" onClick={() => openPanel('now')} data-state={currentBz == null ? 'missing' : currentBz < 0 ? 'south' : 'north'}>
        <span>Bz {currentBz == null ? 'unavailable' : `${currentBz.toFixed(1)} nT`}</span>
        <strong>{swpc.data?.speed_kms == null ? 'Wind unavailable' : `${Math.round(swpc.data.speed_kms)} km/s solar wind`}</strong>
        <em>{currentBz == null ? 'measurement withheld' : currentBz < 0 ? 'southward coupling possible' : 'northward coupling restricted'}</em>
      </button>

      <details className="hx-scene-tools">
        <summary aria-label="Open scene display controls">Display</summary>
        <div>
          <fieldset>
            <legend>Solar observation</legend>
            {SOLAR_FILTERS.map((filter) => (
              <button key={filter.id} type="button" className={solarFilter === filter.id ? 'is-active' : ''} title={filter.hint} onClick={() => setSolarFilter(filter.id)}>{filter.label}</button>
            ))}
          </fieldset>
          <fieldset>
            <legend>Grounded layers</legend>
            {CANVAS_LAYERS.map((layer) => (
              <button key={layer.key} type="button" className={layers[layer.key] ? 'is-active' : ''} aria-pressed={layers[layer.key]} title={layer.hint} onClick={() => setLayers((current) => ({ ...current, [layer.key]: !current[layer.key] }))}>{layer.label}</button>
            ))}
          </fieldset>
        </div>
      </details>

      {sceneMode === 'live' && !followNow ? (
        <button type="button" className="hx-return-live" onClick={() => { setFollowNow(true); setSelectedTimeIso(nowIso()); }}>
          Return to current time
        </button>
      ) : null}

      {timeline ? <div className="hx-timeline hx-timeline--desktop">{timeline}</div> : null}

      <aside id="hx-instrument-panel" className="hx-drawer" data-open={drawerOpen} aria-label="Helioverse instrument panel">
        <header className="hx-drawer-head">
          <div className="hx-panel-tabs" role="tablist" aria-label="Instrument views">
            {(['now', 'events', 'learn', 'model'] as const).map((panel) => (
              <button key={panel} type="button" role="tab" aria-selected={activePanel === panel} className={activePanel === panel ? 'is-active' : ''} onClick={() => setActivePanel(panel)}>
                {panel === 'now' ? 'Now' : panel === 'events' ? 'Events' : panel === 'learn' ? 'Learn' : 'Model'}
              </button>
            ))}
          </div>
          <button type="button" className="hx-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close instrument panel">×</button>
        </header>
        <div className="hx-drawer-body" role="tabpanel">
          {activePanel === 'now' ? <CurrentConditions swpc={swpc.data} error={swpc.error} receivedAt={swpc.updatedAt} location={userLocation} /> : null}
          {activePanel === 'events' ? (
            <EventsPanel
              mode={sceneMode}
              liveScene={liveScene}
              liveLoading={live.loading}
              liveError={live.error}
              liveWindowLabel={live.windowLabel}
              selectedId={selectedId}
              onSelect={selectEvent}
              selectedLiveView={selectedLiveView}
              selectedReplayCme={selectedReplayCme}
              selectedReplayFlare={selectedReplayFlare}
              flares={donki.flares}
              shocks={donki.ips}
              storms={donki.gst}
              donkiLoading={donki.loading}
              donkiError={donki.error}
              timeline={timeline}
            />
          ) : null}
          {activePanel === 'learn' ? (
            <LearningPanel
              activeStep={activeStep}
              onStepChange={(step) => { selectStep(step); }}
              onExit={() => setDrawerOpen(false)}
            />
          ) : null}
          {activePanel === 'model' ? <PredictionLab cmes={donki.cmes} shocks={donki.ips} storms={donki.gst} loading={donki.loading} error={donki.error} /> : null}
        </div>
      </aside>

      {!drawerOpen ? <button type="button" className="hx-open-drawer" onClick={() => setDrawerOpen(true)}>Open instrument</button> : null}

      <nav className="hx-mobile-nav" aria-label="Instrument navigation">
        {(['now', 'events', 'learn', 'model'] as const).map((panel) => (
          <button key={panel} type="button" className={drawerOpen && activePanel === panel ? 'is-active' : ''} onClick={() => openPanel(panel)}>
            <span aria-hidden="true">{panel === 'now' ? '01' : panel === 'events' ? '02' : panel === 'learn' ? '03' : '04'}</span>
            {panel === 'now' ? 'Now' : panel === 'events' ? 'Events' : panel === 'learn' ? 'Learn' : 'Model'}
          </button>
        ))}
      </nav>
    </main>
  );
}

function EventsPanel({
  mode,
  liveScene,
  liveLoading,
  liveError,
  liveWindowLabel,
  selectedId,
  onSelect,
  selectedLiveView,
  selectedReplayCme,
  selectedReplayFlare,
  flares,
  shocks,
  storms,
  donkiLoading,
  donkiError,
  timeline,
}: {
  mode: SceneMode;
  liveScene: LiveScene | null;
  liveLoading: boolean;
  liveError: string | null;
  liveWindowLabel: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  selectedLiveView: LiveScene['views'][number] | null;
  selectedReplayCme: (typeof JUNE_2026_STORM.cmes)[number] | null;
  selectedReplayFlare: (typeof JUNE_2026_STORM.flares)[number] | null;
  flares: Parameters<typeof DonkiEventFeed>[0]['flares'];
  shocks: Parameters<typeof DonkiEventFeed>[0]['ips'];
  storms: Parameters<typeof DonkiEventFeed>[0]['gst'];
  donkiLoading: boolean;
  donkiError: string | null;
  timeline: React.ReactNode;
}) {
  return (
    <section className="hx-events">
      <div className="hx-panel-intro">
        <p className="hx-kicker">Event ledger</p>
        <h2>{mode === 'live' ? 'What the Sun has launched' : 'A resolved storm, replayed honestly'}</h2>
        <p>{mode === 'live' ? 'Measured detections become modelled fronts only when DONKI provides usable speed and direction.' : 'Every outcome is historical. Replay never appears as current conditions.'}</p>
      </div>

      {timeline ? <div className="hx-timeline hx-timeline--mobile">{timeline}</div> : null}

      {mode === 'live' ? (
        liveScene ? (
          <>
            <LiveCmeList views={liveScene.views} selectedId={selectedId} primaryId={liveScene.primaryId} totalDetected={liveScene.totalDetected} shown={liveScene.shown} windowLabel={liveWindowLabel} onSelect={(id) => onSelect(id)} />
            {selectedLiveView ? <LiveCmeDetail view={selectedLiveView} /> : null}
          </>
        ) : (
          <div className="hx-empty">
            <strong>{liveLoading ? 'Fetching NASA DONKI…' : liveError ? 'DONKI events unavailable.' : 'No renderable CMEs in the live window.'}</strong>
            <span>{liveError ?? (liveLoading ? 'The scene stays empty until measured kinematics arrive.' : 'A quiet Sun is real data, not a missing demo.')}</span>
          </div>
        )
      ) : (
        <>
          <StormEventsList selectedId={selectedId} onSelect={(id) => onSelect(id)} />
          {selectedReplayCme ? <CmeDetail cme={selectedReplayCme} /> : selectedReplayFlare ? (
            <FlareDetail flare={selectedReplayFlare} cme={JUNE_2026_STORM.cmes.find((cme) => cme.id === selectedReplayFlare.cmeId) ?? null} onSelect={(id) => onSelect(id)} />
          ) : null}
        </>
      )}

      <div className="hx-live-ledger">
        <header><h3>Observed activity · 30 days</h3><span>{donkiLoading ? 'refreshing…' : 'NASA DONKI'}</span></header>
        <DonkiEventFeed flares={flares} ips={shocks} gst={storms} loading={donkiLoading} error={donkiError} />
      </div>
    </section>
  );
}
