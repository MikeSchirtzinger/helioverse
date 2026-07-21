import { useEffect, useMemo, useRef, useState } from 'react';
import { CurrentConditions } from '@/features/conditions/CurrentConditions';
import { useUserLocation } from '@/features/conditions/use-user-location';
import { LearningPanel } from '@/features/learn/LearningPanel';
import { getCausalStep, type CausalStepId } from '@/features/learn/knowledge';
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
import { CanvasTimeBar, type TimeBarMilestone } from '@/scene/CanvasTimeBar';
import { createSceneBundle, type SceneFoundation } from '@/scene/scene-data';
import type { DonkiCme, DonkiFlare } from '@/scene/donki-feeds';
import type { CmeEventData } from '@/scene/types';
import { buildLiveCmeMilestones, type LiveCmeView, type LiveScene } from '@/scene/live-cmes';
import { DonkiEventFeed } from './DonkiEventFeed';
import { SceneStage, type ImpactSummary } from './SceneStage';
import {
  CmeDetail,
  FlareDetail,
  LiveCmeDetail,
  LiveCmeList,
  LiveCmeObservationDetail,
  LiveFlareDetail,
  StormEventsList,
} from './scene-events';
import { JUNE_2026_STORM, primaryCme as replayPrimaryCme } from './storm-scenario';

type SceneMode = 'live' | 'replay';
type PanelId = 'now' | 'events' | 'learn' | 'model';

const MONITOR_VIEWS: ReadonlyArray<{ step: CausalStepId; short: string; label: string }> = [
  { step: 'sun', short: 'SUN', label: 'Sun' },
  { step: 'transit', short: 'CME', label: 'CME track' },
  { step: 'l1', short: 'L1', label: 'L1 / Earth' },
  { step: 'aurora', short: 'OV', label: 'Aurora' },
];

const EMPTY_DONKI_CMES: readonly DonkiCme[] = [];

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

function monitorViewActive(step: CausalStepId, activeStep: CausalStepId): boolean {
  if (step === 'l1') return ['l1', 'coupling', 'magnetosphere'].includes(activeStep);
  return step === activeStep;
}

function impactWatchTitle(view: LiveCmeView): string {
  switch (view.donki.earthImpactClassification) {
    case 'direct': return view.arrivalIso ? `Model ETA · ${fmtUtc(view.arrivalIso)}` : 'Direct Earth arrival modelled';
    case 'glancing': return view.arrivalIso ? `Glancing ETA · ${fmtUtc(view.arrivalIso)}` : 'Glancing Earth arrival modelled';
    case 'minor': return view.arrivalIso ? `Minor-impact ETA · ${fmtUtc(view.arrivalIso)}` : 'Minor Earth impact modelled';
    case 'none': return 'No Earth shock ETA in this model run';
    case 'unavailable': return 'Earth-arrival model unavailable';
  }
}

function possibleKpLabel(view: LiveCmeView): string {
  const range = view.donki.predictedKpRange;
  if (!range) return 'unavailable';
  return range.min === range.max ? `${range.max}` : `${range.min}–${range.max}`;
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
    eyebrow: 'Selected event time',
    title: 'Current OVATION withheld',
    line: 'NOAA publishes a latest-only grid; it cannot be assigned to the selected event time.',
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
  const [activeStep, setActiveStep] = useState<CausalStepId>('transit');
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>('follow-event');
  const [solarFilter, setSolarFilter] = useState<SolarFilter>('sdo193');
  const [layers, setLayers] = useState<CanvasLayers>(DEFAULT_CANVAS_LAYERS);
  const [activePanel, setActivePanel] = useState<PanelId>('now');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeedHoursPerSecond, setPlaybackSpeedHoursPerSecond] = useState(6);
  const displayMenuRef = useRef<HTMLDetailsElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerOpenerRef = useRef<HTMLElement | null>(null);
  const selectedTimeRef = useRef(selectedTimeIso);
  selectedTimeRef.current = selectedTimeIso;

  const userLocation = useUserLocation();
  const swpc = useSwpcNow();
  const live = useLiveCmes();
  const donki = useDonkiFeeds();
  const liveScene = live.scene;
  const liveObservations = live.observations ?? EMPTY_DONKI_CMES;

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
      if (event.key !== 'Escape') return;
      setDrawerOpen(false);
      window.requestAnimationFrame(() => drawerOpenerRef.current?.focus());
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const frame = window.requestAnimationFrame(() => drawerCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [drawerOpen]);

  useEffect(() => {
    const lightDismissDisplay = (event: PointerEvent) => {
      const menu = displayMenuRef.current;
      if (!menu?.open || menu.contains(event.target as Node)) return;
      menu.open = false;
    };
    const closeDisplayOnEscape = (event: KeyboardEvent) => {
      const menu = displayMenuRef.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', lightDismissDisplay, true);
    window.addEventListener('keydown', closeDisplayOnEscape);
    return () => {
      document.removeEventListener('pointerdown', lightDismissDisplay, true);
      window.removeEventListener('keydown', closeDisplayOnEscape);
    };
  }, []);

  useEffect(() => {
    setIsPlaying(false);
    if (sceneMode === 'live') {
      setSelectedTimeIso(nowIso());
      setFollowNow(true);
      setSelectedId(null);
      setActiveStep('transit');
      setInteractionMode('follow-event');
    } else {
      setSelectedTimeIso(scenario.defaultClockIso);
      setFollowNow(false);
      setSelectedId(scenario.primaryCmeId);
      setActiveStep('transit');
      setInteractionMode('follow-event');
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
  const selectedLiveView = liveScene?.views.find((view) => view.canvas.event.id === selectedId) ?? null;
  const selectedLiveCme = sceneMode === 'live'
    ? liveObservations.find((cme) => cme.activityID === selectedId) ?? null
    : null;
  const selectedLiveFlare = sceneMode === 'live'
    ? donki.flares?.find((flare) => flare.id === selectedId) ?? null
    : null;
  const primaryLiveView = liveScene?.views.find((view) => view.canvas.event.id === liveScene?.primaryId) ?? null;
  const selectedReplayCme = scenario.cmes.find((cme) => cme.id === selectedId) ?? null;
  const selectedReplayFlare = scenario.flares.find((flare) => flare.id === selectedId) ?? null;
  const selectedReplayTimelineCme = selectedReplayCme
    ?? scenario.cmes.find((cme) => cme.flareId === selectedReplayFlare?.id)
    ?? null;
  const watchView = selectedLiveView
    ?? primaryLiveView
    ?? liveScene?.views.find((view) => view.arrivalIso != null)
    ?? liveScene?.views[0]
    ?? null;
  const liveWindow = defaultLiveTimelineWindow();
  const windowStartIso = sceneMode === 'live' ? (liveScene?.windowStartIso ?? liveWindow.start) : scenario.windowStartIso;
  const windowEndIso = sceneMode === 'live' ? (liveScene?.windowEndIso ?? liveWindow.end) : scenario.windowEndIso;
  const liveFlareMilestones = useMemo<TimeBarMilestone[]>(() => {
    const startMs = Date.parse(windowStartIso);
    const endMs = Date.parse(windowEndIso);
    return (donki.flares ?? []).flatMap((flare) => {
      const timeIso = flare.peakTime ?? flare.beginTime ?? flare.time;
      const timeMs = Date.parse(timeIso);
      if (!Number.isFinite(timeMs) || timeMs < startMs || timeMs > endMs) return [];
      return [{
        id: `${flare.id}-flare`,
        eventId: flare.id,
        label: flare.classType ? `${flare.classType} flare` : 'Solar flare',
        timeIso,
        kind: 'flare' as const,
        detail: `Observed solar flare${flare.sourceLocation ? ` at ${flare.sourceLocation}` : ''}; open for verified SDO instrument imagery.`,
      }];
    });
  }, [donki.flares, windowEndIso, windowStartIso]);
  const liveCmeMilestones = useMemo(
    () => buildLiveCmeMilestones(liveObservations),
    [liveObservations],
  );
  const milestones = sceneMode === 'live'
    ? [...liveCmeMilestones, ...liveFlareMilestones]
      .sort((a, b) => Date.parse(a.timeIso) - Date.parse(b.timeIso))
    : scenario.milestones;
  const timelineEvent = sceneMode === 'live'
    ? selectedLiveFlare || (selectedLiveCme && !selectedLiveView)
      ? null
      : (selectedLiveView?.canvas.event ?? primaryEvent ?? cmes[0]?.event ?? liveScene?.timelineAnchorEvent ?? null)
    : (selectedReplayTimelineCme ?? primaryEvent ?? cmes[0]?.event ?? null);
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
      : liveObservations.length > 0
        ? `${liveScene?.shown ?? 0} of ${liveObservations.length} observed CMEs drawn${liveScene ? '' : ' · reconstruction incomplete'}`
        : 'quiet Sun · no CME observed in 7 days';
  const statusLine = sceneMode === 'live'
    ? `LIVE EVENT LAYER · ${liveSceneState}`
    : `HISTORICAL REPLAY · ${scenario.name}`;

  const rememberDrawerOpener = () => {
    if (!drawerOpen && document.activeElement instanceof HTMLElement) {
      drawerOpenerRef.current = document.activeElement;
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    window.requestAnimationFrame(() => drawerOpenerRef.current?.focus());
  };

  const selectEvent = (id: string | null, timeOverride?: string) => {
    setSelectedId(id);
    if (!id) {
      if (drawerOpen) {
        window.requestAnimationFrame(() => document.querySelector<HTMLElement>('#hx-events-tab')?.focus());
      }
      return;
    }
    setIsPlaying(false);
    rememberDrawerOpener();
    setActivePanel('events');
    setDrawerOpen(true);
    displayMenuRef.current?.removeAttribute('open');
    if (sceneMode === 'live') {
      const view = liveScene?.views.find((item) => item.canvas.event.id === id);
      const observation = liveObservations.find((item) => item.activityID === id);
      const flare = donki.flares?.find((item) => item.id === id);
      if (view) {
        setSelectedTimeIso(timeOverride ?? isoOf(view.canvas.event.liftoff_unix));
        setFollowNow(false);
        setActiveStep('transit');
        setInteractionMode('follow-event');
      } else if (observation) {
        const observationTime = timeOverride ?? observation.startTime;
        if (Number.isFinite(Date.parse(observationTime))) setSelectedTimeIso(observationTime);
        setFollowNow(false);
        setActiveStep('sun');
        setInteractionMode('solar-focus');
      }
      if (flare) {
        const flareTime = timeOverride ?? flare.peakTime ?? flare.beginTime ?? flare.time;
        if (Number.isFinite(Date.parse(flareTime))) setSelectedTimeIso(flareTime);
        setFollowNow(false);
        setActiveStep('sun');
        setInteractionMode('solar-focus');
      }
    } else {
      const flare = scenario.flares.find((item) => item.id === id);
      const cme = scenario.cmes.find((item) => item.id === id);
      if (flare) {
        setSelectedTimeIso(timeOverride ?? flare.peakIso);
        setActiveStep('sun');
        setInteractionMode('solar-focus');
      }
      if (cme) {
        setSelectedTimeIso(timeOverride ?? isoOf(cme.liftoff_unix));
        setActiveStep('transit');
        setInteractionMode('follow-event');
      }
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
    rememberDrawerOpener();
    setActivePanel(panel);
    setDrawerOpen(true);
    displayMenuRef.current?.removeAttribute('open');
  };

  const hasRtsw = swpc.data?.mag_measured_at != null || swpc.data?.plasma_measured_at != null;
  const currentBz = swpc.data?.bz_nt;
  const currentFeedsApply = sceneMode === 'live' && followNow;

  const setJourneyPlaying = (playing: boolean) => {
    if (sceneMode !== 'replay') return;
    if (playing) {
      const endMs = Date.parse(windowEndIso);
      if (Date.parse(selectedTimeIso) >= endMs - 1_000) {
        selectedTimeRef.current = windowStartIso;
        setSelectedTimeIso(windowStartIso);
      }
      setFollowNow(false);
      setActiveStep('transit');
      setInteractionMode('follow-event');
    }
    setIsPlaying(playing);
  };

  const timeline = timelineEvent || milestones.length > 0 ? (
    <CanvasTimeBar
      key={`${sceneMode}-${timelineEvent?.id ?? 'event-ledger'}`}
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
      playbackEnabled={sceneMode === 'replay'}
      mode={sceneMode}
      onMilestoneSelect={(milestone: TimeBarMilestone) => {
        if (milestone.eventId) selectEvent(milestone.eventId, milestone.timeIso);
        else openPanel('events');
      }}
      milestones={milestones}
      event={timelineEvent}
      regionLabel={sceneMode === 'live' ? 'NASA DONKI event' : scenario.region}
    />
  ) : null;

  return (
    <main className="hx-app" data-drawer-open={drawerOpen} data-mode={sceneMode} data-step={activeStep} data-follow-now={currentFeedsApply}>
      <a
        className="hx-skip"
        href="#hx-instrument-panel"
        onClick={(event) => {
          event.preventDefault();
          openPanel('now');
        }}
      >
        Skip to instrument data
      </a>

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
          <div><h1 id="hv-scene-title">HELIOVERSE</h1><p>Live space-weather monitor</p></div>
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
          <span>{currentFeedsApply ? (hasRtsw ? `${swpc.data?.mag_source ?? swpc.data?.plasma_source ?? 'RTSW'} measured` : 'L1 unavailable') : sceneMode === 'replay' ? 'Historical replay' : 'Selected event time'}</span>
          <strong>{currentFeedsApply ? 'NOW' : fmtUtc(selectedTimeIso)}</strong>
        </button>
      </header>

      <nav className="hx-chain" aria-label="Monitor views">
        {MONITOR_VIEWS.map((view) => {
          const isActive = monitorViewActive(view.step, activeStep);
          return (
          <button key={view.step} type="button" className={isActive ? 'is-active' : ''} aria-current={isActive ? 'page' : undefined} onClick={() => selectStep(view.step)}>
            <span>{view.short}</span><strong>{view.label}</strong>
          </button>
          );
        })}
      </nav>

      <section className={`hx-event-watch${watchView || sceneMode === 'replay' ? '' : ' is-empty'}`} aria-live="polite">
        <p className="hx-kicker">{selectedLiveView ? 'Selected event' : sceneMode === 'live' ? 'Earth arrival watch' : 'Historical replay'}</p>
        {sceneMode === 'live' ? (
          watchView ? (
            <>
              <strong>{impactWatchTitle(watchView)}</strong>
              <div className="hx-event-watch__facts">
                <span><em>Measured speed</em>{Math.round(watchView.canvas.event.speed_kms)} km/s</span>
                <span><em>Possible Kp</em>{possibleKpLabel(watchView)}</span>
              </div>
              <button type="button" onClick={() => selectEvent(watchView.canvas.event.id)}>View event images</button>
            </>
          ) : (
            <>
              <strong>{live.loading ? 'Scanning recent solar activity…' : live.error ? 'Event feed unavailable' : 'No renderable CME in the 7-day window'}</strong>
              <button type="button" onClick={() => openPanel('events')}>Open event ledger</button>
            </>
          )
        ) : (
          <>
            <strong>{scenario.name}</strong>
            <div className="hx-event-watch__facts">
              <span><em>Observed outcome</em>{scenario.outcome.stormLevel}</span>
              <span><em>Forecast</em>{scenario.outcome.predictedLevel}</span>
            </div>
            <button type="button" onClick={() => selectEvent(selectedReplayCme?.id ?? scenario.primaryCmeId)}>View event images</button>
          </>
        )}
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

      <details ref={displayMenuRef} className="hx-scene-tools">
        <summary aria-label="Open scene display controls">Display</summary>
        <div>
          <fieldset>
            <legend>Solar imagery</legend>
            {SOLAR_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={solarFilter === filter.id ? 'is-active' : ''}
                aria-pressed={solarFilter === filter.id}
                title={filter.hint}
                onClick={() => {
                  setSolarFilter(filter.id);
                  setActiveStep('sun');
                  setInteractionMode('solar-focus');
                }}
              >
                {filter.label}
              </button>
            ))}
            <p className="hx-scene-tools__hint">{SOLAR_FILTERS.find((filter) => filter.id === solarFilter)?.hint}</p>
          </fieldset>
          <fieldset>
            <legend>Scene overlays</legend>
            {CANVAS_LAYERS.map((layer) => (
              <button key={layer.key} type="button" className={layers[layer.key] ? 'is-active' : ''} aria-pressed={layers[layer.key]} title={layer.hint} onClick={() => setLayers((current) => ({ ...current, [layer.key]: !current[layer.key] }))}>{layer.label}</button>
            ))}
          </fieldset>
        </div>
      </details>

      {sceneMode === 'live' && !followNow ? (
        <button type="button" className="hx-return-live" onClick={() => {
          setFollowNow(true);
          setSelectedTimeIso(nowIso());
          setSelectedId(null);
          setIsPlaying(false);
          setActiveStep('transit');
          setInteractionMode('follow-event');
        }}>
          Return to current time
        </button>
      ) : null}

      {timeline ? <div className="hx-timeline hx-timeline--dock">{timeline}</div> : null}

      <aside
        id="hx-instrument-panel"
        className="hx-drawer"
        data-open={drawerOpen}
        aria-label="Helioverse instrument panel"
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <header className="hx-drawer-head">
          <div className="hx-panel-tabs" role="tablist" aria-label="Instrument views">
            {(['now', 'events', 'learn', 'model'] as const).map((panel) => (
              <button id={`hx-${panel}-tab`} key={panel} type="button" role="tab" aria-selected={activePanel === panel} className={activePanel === panel ? 'is-active' : ''} onClick={() => setActivePanel(panel)}>
                {panel === 'now' ? 'Now' : panel === 'events' ? 'Events' : panel === 'learn' ? 'Learn' : 'Model'}
              </button>
            ))}
          </div>
          <button ref={drawerCloseRef} type="button" className="hx-drawer-close" onClick={closeDrawer} aria-label="Close instrument panel">×</button>
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
              selectedLiveCme={selectedLiveCme}
              selectedLiveFlare={selectedLiveFlare}
              liveObservations={liveObservations}
              selectedReplayCme={selectedReplayCme}
              selectedReplayFlare={selectedReplayFlare}
              flares={donki.flares}
              shocks={donki.ips}
              storms={donki.gst}
              donkiLoading={donki.loading}
              donkiError={donki.error}
            />
          ) : null}
          {activePanel === 'learn' ? (
            <LearningPanel
              activeStep={activeStep}
              onStepChange={(step) => { selectStep(step); }}
              onExit={closeDrawer}
            />
          ) : null}
          {activePanel === 'model' ? <PredictionLab cmes={donki.cmes} shocks={donki.ips} storms={donki.gst} loading={donki.loading} error={donki.error} /> : null}
        </div>
      </aside>

      {!drawerOpen ? (
        <nav className="hx-quick-actions" aria-label="Open monitor panels">
          <button type="button" onClick={() => openPanel('events')}>Events</button>
          <button type="button" onClick={() => openPanel('learn')}>Learn</button>
        </nav>
      ) : null}

      <nav className="hx-mobile-nav" aria-label="Instrument navigation">
        {(['now', 'events', 'learn'] as const).map((panel) => (
          <button key={panel} type="button" className={drawerOpen && activePanel === panel ? 'is-active' : ''} onClick={() => openPanel(panel)}>
            <span aria-hidden="true">{panel === 'now' ? 'LIVE' : panel === 'events' ? 'LOG' : '?'}</span>
            {panel === 'now' ? 'Now' : panel === 'events' ? 'Events' : 'Learn'}
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
  selectedLiveCme,
  selectedLiveFlare,
  liveObservations,
  selectedReplayCme,
  selectedReplayFlare,
  flares,
  shocks,
  storms,
  donkiLoading,
  donkiError,
}: {
  mode: SceneMode;
  liveScene: LiveScene | null;
  liveLoading: boolean;
  liveError: string | null;
  liveWindowLabel: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  selectedLiveView: LiveScene['views'][number] | null;
  selectedLiveCme: DonkiCme | null;
  selectedLiveFlare: DonkiFlare | null;
  liveObservations: readonly DonkiCme[];
  selectedReplayCme: (typeof JUNE_2026_STORM.cmes)[number] | null;
  selectedReplayFlare: (typeof JUNE_2026_STORM.flares)[number] | null;
  flares: Parameters<typeof DonkiEventFeed>[0]['flares'];
  shocks: Parameters<typeof DonkiEventFeed>[0]['ips'];
  storms: Parameters<typeof DonkiEventFeed>[0]['gst'];
  donkiLoading: boolean;
  donkiError: string | null;
}) {
  return (
    <section className="hx-events">
      <div className="hx-panel-intro">
        <p className="hx-kicker">Event monitor</p>
        <h2>{mode === 'live' ? 'Solar launches and Earth arrivals' : 'Historical storm replay'}</h2>
        <p>{mode === 'live' ? 'Launch imagery and measured speed stay separate from modelled Earth-arrival and possible-Kp forecasts.' : 'Observed outcomes and modelled forecasts remain labelled separately.'}</p>
      </div>

      {mode === 'live' ? (
        selectedLiveFlare ? (
          <div className="hx-selected-event">
            <button type="button" className="hx-event-back" onClick={() => onSelect(null)}>← All live events</button>
            <LiveFlareDetail flare={selectedLiveFlare} />
          </div>
        ) : selectedLiveCme ? (
          <div className="hx-selected-event">
            <button type="button" className="hx-event-back" onClick={() => onSelect(null)}>← All live events</button>
            {selectedLiveView
              ? <LiveCmeDetail view={selectedLiveView} />
              : <LiveCmeObservationDetail cme={selectedLiveCme} />}
          </div>
        ) : liveObservations.length > 0 ? (
          <LiveCmeList
            observations={liveObservations}
            views={liveScene?.views ?? []}
            selectedId={selectedId}
            primaryId={liveScene?.primaryId ?? null}
            totalDetected={liveObservations.length}
            shown={liveScene?.shown ?? 0}
            windowLabel={liveWindowLabel}
            onSelect={(id) => onSelect(id)}
          />
        ) : (
          <div className="hx-empty">
            <strong>{liveLoading ? 'Fetching NASA DONKI…' : liveError ? 'DONKI events unavailable.' : 'No CMEs observed in the live window.'}</strong>
            <span>{liveError ?? (liveLoading ? 'The scene stays empty until measured kinematics arrive.' : 'A quiet Sun is real data, not a missing demo.')}</span>
          </div>
        )
      ) : (
        selectedReplayCme || selectedReplayFlare ? (
          <div className="hx-selected-event">
            <button type="button" className="hx-event-back" onClick={() => onSelect(null)}>← All replay events</button>
            {selectedReplayCme ? <CmeDetail cme={selectedReplayCme} /> : selectedReplayFlare ? (
            <FlareDetail flare={selectedReplayFlare} cme={JUNE_2026_STORM.cmes.find((cme) => cme.id === selectedReplayFlare.cmeId) ?? null} onSelect={(id) => onSelect(id)} />
            ) : null}
          </div>
        ) : (
          <StormEventsList selectedId={selectedId} onSelect={(id) => onSelect(id)} />
        )
      )}

      <div className="hx-live-ledger">
        <header><h3>Observed activity · 30 days</h3><span>{donkiLoading ? 'refreshing…' : 'NASA DONKI'}</span></header>
        <DonkiEventFeed
          flares={flares}
          ips={shocks}
          gst={storms}
          loading={donkiLoading}
          error={donkiError}
          onSelectFlare={mode === 'live' ? (flare) => onSelect(flare.id) : undefined}
          selectedFlareId={mode === 'live' ? selectedLiveFlare?.id ?? null : undefined}
        />
      </div>
    </section>
  );
}
