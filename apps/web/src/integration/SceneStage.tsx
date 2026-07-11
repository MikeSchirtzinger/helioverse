/**
 * SceneStage.tsx — the full-bleed heliosphere canvas for the immersive console.
 *
 * A thin presentational wrapper around HelioCanvas: it fills its container, owns
 * only display state (renderer capability), and renders the Earth-impact /
 * magnetosphere status overlays. All *control* state (camera mode, solar
 * channel, layers, master clock, selection) AND all scenario-specific data
 * (which CMEs, the primary event, the overlay/status text) are owned by the
 * console shell and threaded in, so the same stage renders either the LIVE
 * DONKI feed or the labelled June-2026 replay.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HelioCanvas } from '@/scene/HelioCanvas';
import { ScenePopover } from './ScenePopover';
import {
  rendererCapability,
  type AuroraGridPoint,
  type CanvasCme,
  type CanvasInteractionMode,
  type CanvasLayers,
  type HelioCanvasCapability,
  type SolarFilter,
} from '@/scene/canvas-contract';
import type { SceneFoundation } from '@/scene/scene-data';
import type { CmeEventData, ScaleMode } from '@/scene/types';
import { geomagneticActivity } from '@/scene/cme-propagation';
import {
  dynamicPressureNPa,
  magnetosphereFromConditions,
  stormMagnetosphere,
  type MagnetosphereState,
} from '@/scene/magnetosphere';

/** Earth-impact overlay copy (mode-specific, computed by the shell). */
export interface ImpactSummary {
  eyebrow?: string;
  title: string;
  line: string;
}

export interface SceneStageProps {
  scene: SceneFoundation;
  cmes: CanvasCme[];
  /** Master-clock value (ISO-8601 UTC). */
  valueIso: string;
  selectedId: string | null;
  interactionMode: CanvasInteractionMode;
  solarFilter: SolarFilter;
  layers: CanvasLayers;
  onSelectEvent: (id: string | null) => void;
  onCapabilityChange?: (capability: HelioCanvasCapability) => void;
  auroraGrid?: AuroraGridPoint[] | null;
  /** Measured L1 solar-wind speed (km/s) + proton density — drive the wind particles. */
  solarWindSpeedKms?: number | null;
  solarWindDensity?: number | null;
  /** Measured IMF Bz; with speed+density it drives the Shue magnetopause. */
  solarWindBzNt?: number | null;
  /** Historical replays may use the labelled event-derived proxy. Live mode should not. */
  allowEventModelMagnetosphere?: boolean;
  /** The CME that drives the camera-follow target (or null). */
  primaryEventId: string | null;
  /** Kinematics of the primary CME — may drive the labelled replay magnetosphere proxy. */
  primaryEvent: CmeEventData | null;
  /** Earth-impact overlay text, or null when there's nothing impact-worthy. */
  impactSummary: ImpactSummary | null;
  /** Provenance line shown in the bottom-left of the stage. */
  statusLine: string;
  /** Timeline playback state — when false the scene freezes decorative motion. */
  isPlaying?: boolean;
  /** Right rail open? Drives the minimap's default right-side inset. */
  rightRailOpen?: boolean;
}

// The scene only ships the honest compressed-distance model (a true 1:1 AU scale
// renders the bodies as sub-pixel dots).
const SCALE_MODE: ScaleMode = 'compressed';

export function SceneStage({
  scene,
  cmes,
  valueIso,
  selectedId,
  interactionMode,
  solarFilter,
  layers,
  onSelectEvent,
  onCapabilityChange,
  auroraGrid,
  solarWindSpeedKms,
  solarWindDensity,
  solarWindBzNt,
  allowEventModelMagnetosphere = true,
  primaryEventId,
  primaryEvent,
  impactSummary,
  statusLine,
  isPlaying = false,
  rightRailOpen = false,
}: SceneStageProps) {
  const [capability, setCapability] = useState<HelioCanvasCapability>(() => rendererCapability('initializing'));

  // The selected CME (replay or live) gets an on-canvas inspector popover pinned
  // to its 3D position. Flares have no distinct 3D object of their own — their
  // real source is the active region the CME beacon already sits on — so only a
  // selected CME resolves here; a selected flare keeps its right-rail detail.
  const selectedCme = useMemo<CanvasCme | null>(
    () => cmes.find((c) => c.event.id === selectedId) ?? null,
    [cmes, selectedId],
  );

  // The popover is positioned imperatively from HelioCanvas's per-frame anchor so
  // it can follow a moving front at 60fps without re-rendering React each frame.
  // Sizes are cached on selection/resize; the per-frame handler is pure math.
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ pw: 300, ph: 380, hw: 0, hh: 0, dock: 150 });

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = popoverRef.current;
      const host = wrap?.parentElement as HTMLElement | null;
      if (!wrap || !host) return;
      const card = wrap.firstElementChild as HTMLElement | null;
      if (card) {
        sizeRef.current.pw = card.offsetWidth;
        sizeRef.current.ph = card.offsetHeight;
      }
      sizeRef.current.hw = host.clientWidth;
      sizeRef.current.hh = host.clientHeight;
      const dock = parseFloat(getComputedStyle(host).getPropertyValue('--hv-dock-h'));
      if (Number.isFinite(dock)) sizeRef.current.dock = dock;
    };
    measure();
    const wrap = popoverRef.current;
    const host = wrap?.parentElement ?? null;
    const ro = new ResizeObserver(measure);
    if (host) ro.observe(host);
    if (wrap) ro.observe(wrap);
    return () => ro.disconnect();
  }, [selectedId]);

  const handleAnchor = useCallback((xPx: number, yPx: number, visible: boolean) => {
    const wrap = popoverRef.current;
    if (!wrap) return;
    // Show only when the canvas reports an on-screen anchor AND content is mounted
    // (the conditional child below renders only when a CME is selected).
    if (!visible || !wrap.firstElementChild) {
      if (wrap.dataset.show !== 'false') wrap.dataset.show = 'false';
      return;
    }
    const { pw, ph, hw, hh, dock } = sizeRef.current;
    const gap = 18;
    const margin = 12;
    // Prefer the right of the object; flip left if it would overflow the stage.
    let flip = false;
    let x = xPx + gap;
    if (x + pw > hw - margin) {
      x = xPx - gap - pw;
      flip = true;
    }
    x = Math.max(margin, Math.min(x, hw - pw - margin));
    // Centre vertically on the object, clamped under the top bar / above the dock.
    let y = yPx - ph / 2;
    y = Math.max(60, Math.min(y, hh - ph - (dock + 16)));
    wrap.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    if (wrap.dataset.flip !== (flip ? 'true' : 'false')) wrap.dataset.flip = flip ? 'true' : 'false';
    if (wrap.dataset.show !== 'true') wrap.dataset.show = 'true';
  }, []);

  const timeUnix = Math.floor(Date.parse(valueIso) / 1000);
  const canvasControls = useMemo(
    () => ({ scaleMode: SCALE_MODE, interactionMode, solarFilter, layers, timeUnix }),
    [interactionMode, solarFilter, layers, timeUnix],
  );

  // Magnetosphere state at the current clock (Shue 1998), driven by the primary
  // CME's geomagnetic-activity curve — modeled, not in-situ L1 plasma. Quiet
  // when no CME drives the scene.
  const mag = useMemo<MagnetosphereState | null>(() => {
    if (
      solarWindSpeedKms != null && solarWindSpeedKms > 0 &&
      solarWindDensity != null && solarWindDensity >= 0 &&
      solarWindBzNt != null
    ) {
      return magnetosphereFromConditions(
        dynamicPressureNPa(solarWindDensity, solarWindSpeedKms),
        solarWindBzNt,
        false,
      );
    }
    if (allowEventModelMagnetosphere && primaryEvent) {
      return stormMagnetosphere(geomagneticActivity(primaryEvent, timeUnix));
    }
    return null;
  }, [allowEventModelMagnetosphere, primaryEvent, solarWindBzNt, solarWindDensity, solarWindSpeedKms, timeUnix]);

  const handleCapability = (next: HelioCanvasCapability) => {
    setCapability(next);
    onCapabilityChange?.(next);
  };

  return (
    <div className="hv-stage">
      <HelioCanvas
        scene={scene}
        cmes={cmes}
        primaryEventId={primaryEventId}
        selectedEventId={selectedId}
        onSelectEvent={onSelectEvent}
        controls={canvasControls}
        labelledBy="hv-scene-title"
        onCapabilityChange={handleCapability}
        auroraGrid={auroraGrid}
        solarWindSpeedKms={solarWindSpeedKms}
        magnetosphereState={mag}
        onAnchorChange={handleAnchor}
        isPlaying={isPlaying}
        rightRailOpen={rightRailOpen}
      />

      {/* On-canvas inspector for the selected CME, pinned to its 3D position by
          handleAnchor. Always mounted (stable ref); content + visibility track
          the selection. The card stays interactive; the wrapper never blocks
          canvas drags (pointer-events handled in CSS). */}
      <div ref={popoverRef} className="hv-scene-popover-wrap" data-show="false" data-flip="false">
        {selectedCme ? <ScenePopover cme={selectedCme} onClose={() => onSelectEvent(null)} /> : null}
      </div>

      {interactionMode === 'earth-impact' && impactSummary ? (
        <div className="hv-impact-overlay" role="status">
          <p className="hv-eyebrow">{impactSummary.eyebrow ?? 'Earth outcome'}</p>
          <strong>{impactSummary.title}</strong>
          <span>{impactSummary.line}</span>
        </div>
      ) : null}
      {interactionMode === 'magnetosphere' ? (
        <div className="hv-impact-overlay" role="status">
          <p className="hv-eyebrow">Magnetosphere · Shue 1998</p>
          {mag ? (
            <>
              <strong style={mag.insideGeo ? { color: 'var(--sev-extreme)' } : undefined}>
                {mag.insideGeo
                  ? `Magnetopause inside GEO — ${mag.standoffRe.toFixed(1)} Rₑ`
                  : `Standoff ${mag.standoffRe.toFixed(1)} Rₑ`}
              </strong>
              <span>
                P<sub>dyn</sub> {mag.pdyn_nPa.toFixed(1)} nPa · Bz {mag.bz_nt.toFixed(1)} nT ·{' '}
                {mag.derived ? 'modelled from the labelled replay event' : 'Shue model from measured RTSW plasma + Bz'}
              </span>
            </>
          ) : (
            <><strong>Boundary unavailable</strong><span>Current Bz, speed and density are required; no proxy is drawn.</span></>
          )}
        </div>
      ) : null}

      <div className="hv-stage-status" aria-live="polite">
        <span className="hv-stage-status-renderer" data-path={capability.path}>
          {capability.label}
        </span>
        <span title="Heliocentric distance uses the disclosed logarithmic mapping. Solid Sun and planet spheres share one km→scene-radius ratio; locator glows are markers.">
          log-compressed distance · body diameters proportional
        </span>
        {/* PROVENANCE: the full ion→sprite quantum + DBM note is kept as a
            tooltip so the bottom-centre status stays a single readable line;
            the detail is still surfaced, just not as a wall of text. */}
        <span title="plasma = est. ions (DONKI width→mass); 1 dot ≈ 2×10³⁶ protons · position/speed modelled (DBM) · colour = measured speed">
          {statusLine}
        </span>
      </div>
    </div>
  );
}
