import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  DEFAULT_CANVAS_LAYERS,
  HELIO_CANVAS_CLASSNAMES,
  INITIAL_CANVAS_CAPABILITY,
  rendererCapability,
  type AuroraGridPoint,
  type CanvasLayers,
  type HelioCanvasCapability,
  type HelioCanvasProps,
} from './canvas-contract';

/**
 * Extends the base canvas props with the live OVATION aurora probability grid.
 */
interface HelioCanvasLiveProps extends HelioCanvasProps {
  /** Live OVATION aurora probability grid. Empty/undefined shows an explicit unavailable label; no synthetic oval is substituted. */
  auroraGrid?: AuroraGridPoint[] | null;
  /** Measured L1 solar-wind bulk speed (km/s, NOAA SWPC). Parameterizes the labelled Parker geometry. */
  solarWindSpeedKms?: number | null;
  /** Shue boundary state. null means the honest unavailable state. */
  magnetosphereState?: import('./magnetosphere').MagnetosphereState | null;
  /**
   * Per-frame screen position (CSS px, relative to the canvas top-left) of the
   * currently selected CME's travelling front — or its Sun-surface source beacon
   * before eruption. `visible` is false when nothing is selected or the anchor is
   * off-screen / hidden (e.g. the magnetosphere view). Lets the integration layer
   * pin an on-canvas inspector popover to the object without `scene/` importing it.
   */
  onAnchorChange?: (xPx: number, yPx: number, visible: boolean) => void;
  /** Timeline playback state. When false, decorative body rotation + solar-wind
   * drift freeze, so a paused clock yields a genuinely still scene. */
  isPlaying?: boolean;
  /** Freeze the measured solar frame while a fast journey clock is advancing. */
  freezeSolarImagery?: boolean;
  /** Right rail open? Drives the minimap's default right-side inset so it tucks
   * beside the rail when open and hugs the edge when closed. */
  rightRailOpen?: boolean;
}
import { clamp, disposeObject3D, positionCamera, shortEventId } from './canvas-helpers';
import {
  applyRealEarthTexture,
  applySolarFilter,
  applySunActivity,
  createCmeVisuals,
  createEarthFocus,
  createEarthGlow,
  createMagnetosphere,
  createPlanetSystem,
  createSpaceGradientTexture,
  createStarField,
  createSunObservationSphere,
  createSunGlow,
  sunPaletteEmissive,
  updateCmeVisuals,
  updateEarthFocus,
  updateMagnetosphere,
  updatePlanetSystem,
  type CmeVisuals,
  type EarthFocus,
  type MagnetosphereVisuals,
  type PlanetSystem,
  type SunVisuals,
} from './canvas-effects';
import { createDomLabel, createLabelRenderer, type DomLabel } from './canvas-labels';
import { cmeFrontRadiusKm, geomagneticActivity } from './cme-propagation';
import { cmeSpeedColorCss } from './cme-style';
import { AU_KM } from './constants';
import { goesSunState } from './goes-xray';
import { useGoesXray } from './use-goes-xray';
import { MiniMap } from './MiniMap';
import { stormMagnetosphere } from './magnetosphere';
import { loadSunTexture } from './solar-imagery';
import { createDefaultCameraState, createScaleState } from './camera';
import { requestGpuAdapter } from './detect';
import { computeParkerGrid } from './parker-grid';
import { createParkerGridLines, createRenderer, createSceneObjects } from './scene-setup';

type HelioRenderer = WebGPURenderer | THREE.WebGLRenderer;

const IMAGERY_SETTLE_MS = 450;

interface PointerState {
  primaryId: number | null;
  points: Map<number, { x: number; y: number }>;
  x: number;
  y: number;
  downX: number;
  downY: number;
  moved: boolean;
  pinchDistance: number | null;
}

const SUN_FILTER_LABELS: Record<NonNullable<HelioCanvasLiveProps['controls']['solarFilter']>, string> = {
  visible: 'HMI continuum',
  sdo131: 'AIA 131 Å',
  sdo304: 'AIA 304 Å',
  sdo171: 'AIA 171 Å',
  sdo193: 'AIA 193 Å',
  sdo211: 'AIA 211 Å',
  magnetogram: 'HMI magnetogram',
};

function sunObservationLabel(filter: keyof typeof SUN_FILTER_LABELS, observedAt: string | null): string {
  if (!observedAt) return `${SUN_FILTER_LABELS[filter]} · measured frame`;
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return `${SUN_FILTER_LABELS[filter]} · measured frame`;
  const stamp = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${SUN_FILTER_LABELS[filter]} · ${stamp} UTC`;
}

/** Live references the layer/imagery effects need after the scene is built. */
interface ToggleTargets {
  parkerGrid: THREE.Object3D | null;
  /**
   * DOM element for the Parker-spiral unavailable notice. It is shown only
   * when no measured RTSW wind speed exists; no default spiral is displayed.
   */
  parkerFallbackEl: HTMLElement | null;
  /** CSS2D object visibility is authoritative; CSS2DRenderer rewrites display. */
  parkerFallbackLabel: THREE.Object3D | null;
  cones: THREE.Object3D[];
  orbitRings: THREE.Object3D | null;
  sunSurface: THREE.Mesh | null;
  /**
   * DOM label shown over the Sun when real-imagery is enabled but no SDO/
   * Helioviewer disk has loaded (loading or unavailable). The honest empty
   * state — never a silent dark sphere (R4/R5 fix).
   */
  sunImageryEl: HTMLElement | null;
  /** CSS2D object paired with `sunImageryEl`; hide this, not only its DOM node. */
  sunImageryLabel: THREE.Object3D | null;
  /** Secondary line in the normal Sun label; carries the actual frame clock. */
  sunObservationSub: HTMLElement | null;
}

export function HelioCanvas({
  scene: sceneData,
  cmes,
  primaryEventId,
  selectedEventId,
  onSelectEvent,
  controls,
  className,
  labelledBy,
  describedBy,
  onCapabilityChange,
  auroraGrid,
  solarWindSpeedKms,
  magnetosphereState,
  onAnchorChange,
  isPlaying = false,
  freezeSolarImagery = false,
  rightRailOpen = false,
}: HelioCanvasLiveProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<HelioRenderer | null>(null);
  const capabilityCallbackRef = useRef(onCapabilityChange);
  const sunFxRef = useRef<{ core: THREE.MeshStandardMaterial; visuals: SunVisuals } | null>(null);
  const toggleRef = useRef<ToggleTargets | null>(null);
  const timeRef = useRef(0);
  const selectRef = useRef(onSelectEvent);
  selectRef.current = onSelectEvent;
  const anchorRef = useRef(onAnchorChange);
  anchorRef.current = onAnchorChange;
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  const selectedRef = useRef<string | null | undefined>(selectedEventId);
  selectedRef.current = selectedEventId;
  const [capability, setCapability] = useState<HelioCanvasCapability>(INITIAL_CANVAS_CAPABILITY);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [builtTick, setBuiltTick] = useState(0);
  // Stores the scale state after each build so the parker-grid rebuild effect
  // can recompute spiral positions without triggering a full scene rebuild.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scaleRef = useRef<any>(null);

  const reducedMotion = controls.reducedMotion ?? prefersReducedMotion;
  const solarFilter = controls.solarFilter ?? 'sdo171';
  const layers: CanvasLayers = controls.layers ?? DEFAULT_CANVAS_LAYERS;
  const timeUnix = controls.timeUnix ?? sceneData.epoch_unix;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  // Ref so the animation loop always sees the latest grid without scene rebuild.
  const auroraGridRef = useRef(auroraGrid);
  auroraGridRef.current = auroraGrid;
  const magnetosphereStateRef = useRef(magnetosphereState);
  magnetosphereStateRef.current = magnetosphereState;

  // Live GOES soft X-ray flux → real Sun activity at the scrubbed time. No live
  // sample (e.g. the older replay window) ⇒ neutral baseline, surfaced honestly.
  const goesSamples = useGoesXray();
  const sunState = useMemo(() => goesSunState(goesSamples, timeUnix), [goesSamples, timeUnix]);
  const goesLogRef = useRef<string>('');

  const primaryEvent = useMemo(() => {
    const found = cmes.find((cme) => cme.event.id === primaryEventId) ?? cmes[cmes.length - 1];
    return found?.event ?? null;
  }, [cmes, primaryEventId]);

  capabilityCallbackRef.current = onCapabilityChange;

  useEffect(() => {
    timeRef.current = timeUnix;
  }, [timeUnix]);

  // Recolour the Sun to the active filter AND drive its brightness + active-
  // halo brightness from the measured GOES X-ray flux. Re-runs on filter change,
  // activity change, and after each (re)build (builtTick) once sunFxRef is set.
  useEffect(() => {
    const fx = sunFxRef.current;
    if (!fx) return;
    applySolarFilter(fx.core, fx.visuals, solarFilter);
    applySunActivity(fx.core, fx.visuals, sunState.activity, sunPaletteEmissive(solarFilter));
  }, [solarFilter, sunState.activity, builtTick]);

  // A2 verification: log the flux → brightness mapping whenever the resolved
  // GOES class changes, so the Sun's brightness is provably tracking real flux.
  useEffect(() => {
    const tag = `${sunState.note}|${solarFilter}`;
    if (goesLogRef.current === tag) return;
    goesLogRef.current = tag;
    const factor = 1 + Math.min(1.5, sunState.activity) * 0.6;
    const base = sunPaletteEmissive(solarFilter);
    console.info(
      `[GOES→Sun] ${sunState.note} · flux=${sunState.flux ?? 'n/a'} · activity=${sunState.activity.toFixed(2)} → emissive ×${factor.toFixed(2)} (=${(base * factor).toFixed(2)})`,
    );
  }, [sunState, solarFilter]);

  // A4 verification: the 3D front, the minimap arc, and this log all read the
  // SAME cmeFrontRadiusKm — there is no per-CME easing. Sample r(t) to show it is
  // monotone and consistent (the minimap then plots it on a LINEAR radial axis).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    for (const cme of cmes) {
      const t0 = cme.event.liftoff_unix;
      const rows = [6, 24, 48]
        .map((h) => `${h}h:${(cmeFrontRadiusKm(cme.event, t0 + h * 3600) / AU_KM).toFixed(3)}AU`)
        .join(' ');
      console.debug(`[CME kinematics] ${cme.label} v=${cme.event.speed_kms}km/s ${rows}`);
    }
  }, [cmes]);

  const activeLabel = useMemo(
    () => (primaryEvent ? shortEventId(primaryEvent.id) : 'quiet heliosphere'),
    [primaryEvent],
  );

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // Apply layer visibility whenever the toggles change.
  useEffect(() => {
    const t = toggleRef.current;
    if (!t) return;
    // The magnetosphere view is an Earth-space close-up — keep the wide-system
    // solar wind and body labels out of it regardless of layer toggles.
    const inCloseEarth = controls.interactionMode === 'magnetosphere' || controls.interactionMode === 'earth-impact';
    if (t.parkerGrid) t.parkerGrid.visible = layers.magneticField && !inCloseEarth;
    t.cones.forEach((cone) => (cone.visible = layers.cmeCone && !inCloseEarth));
    if (t.orbitRings) t.orbitRings.visible = layers.orbits && !inCloseEarth;
    // DOM labels are toggled per-frame in the animation loop (they react to the
    // live layer state, the camera, selection, and cursor proximity).
  }, [layers, builtTick, controls.interactionMode]);

  // PROVENANCE A1: rebuild the Parker-spiral field-line grid whenever the
  // measured L1 solar-wind speed changes. The winding angle φ(r) = −(Ω/v)·r
  // encodes the actual speed; using a constant here would be fabrication.
  // When no live speed is available every line is removed. The group retains
  // only an explicit unavailable label; no default spiral can look measured.
  useEffect(() => {
    const t = toggleRef.current;
    const scale = scaleRef.current;
    if (!t?.parkerGrid || !scale) return;

    const isLive = typeof solarWindSpeedKms === 'number' && solarWindSpeedKms > 0;

    // Dispose old spiral geometries/materials, keeping the fallback label child.
    const grid = t.parkerGrid as THREE.Group;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyStyle = (t.parkerGrid as any)._applyStyle as ((g: THREE.Object3D) => void) | undefined;
    const toRemove: THREE.Object3D[] = grid.children.filter((c) => c instanceof THREE.Line);
    for (const child of toRemove) {
      grid.remove(child);
      if ('geometry' in child) (child as THREE.Line).geometry.dispose();
      if ('material' in child) {
        const mat = (child as THREE.Line).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    }

    // Build fresh spirals only from the measured speed.
    if (isLive) {
      const newGrid = computeParkerGrid(solarWindSpeedKms);
      const newGroup = createParkerGridLines(newGrid, scale);
      for (const child of [...newGroup.children]) {
        newGroup.remove(child);
        grid.add(child);
      }
      if (applyStyle) applyStyle(grid);
    }
    grid.userData.hasData = isLive;

    // Update provenance label: visible when falling back to default.
    if (t.parkerFallbackEl) {
      if (isLive) {
        t.parkerFallbackEl.textContent = `Parker spiral · modelled from ${Math.round(solarWindSpeedKms)} km/s L1 speed`;
        if (t.parkerFallbackLabel) t.parkerFallbackLabel.visible = true;
      } else {
        t.parkerFallbackEl.textContent = 'Parker spiral unavailable — no current RTSW speed';
        if (t.parkerFallbackLabel) t.parkerFallbackLabel.visible = true;
      }
    }
  }, [solarWindSpeedKms, builtTick]);

  // Swap in real SDO/Helioviewer imagery for the selected time + channel. While
  // a fast journey is playing, retain the last observed frame instead of
  // launching/cancelling a new image request on every animation tick.
  const imageryTimeRef = useRef(timeUnix);
  if (!freezeSolarImagery) imageryTimeRef.current = timeUnix;
  const imageryTimeUnix = freezeSolarImagery ? imageryTimeRef.current : timeUnix;
  const imageryBucket = Math.floor(imageryTimeUnix / 720);
  useEffect(() => {
    const surface = toggleRef.current?.sunSurface ?? null;
    const imageryEl = toggleRef.current?.sunImageryEl ?? null;
    const imageryLabel = toggleRef.current?.sunImageryLabel ?? null;
    if (!surface) return undefined;
    const systemScaleView = controls.interactionMode !== 'magnetosphere' && controls.interactionMode !== 'earth-impact';
    if (!systemScaleView) {
      surface.visible = false;
      if (imageryLabel) imageryLabel.visible = false;
      return undefined;
    }
    if (!layers.realImagery) {
      surface.visible = false;
      // Imagery layer off → hide the unavailable label too (the user chose to
      // see the neutral occluder, not an error state).
      if (imageryLabel) imageryLabel.visible = false;
      return undefined;
    }
    // Real-imagery on but no disk loaded yet → show the honest label until a
    // real frame lands (R4/R5: never a silent dark sphere).
    if (imageryEl && imageryLabel && !surface.visible) {
      imageryEl.textContent = `Loading measured ${SUN_FILTER_LABELS[solarFilter]} frame…`;
      imageryEl.dataset.state = 'loading';
      imageryEl.setAttribute('aria-hidden', 'false');
      imageryLabel.visible = true;
    }
    if (!Number.isFinite(imageryTimeUnix)) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const dateIso = new Date(imageryTimeUnix * 1000).toISOString().replace('.000Z', 'Z');
      void loadSunTexture({ dateIso, filter: solarFilter }, controller.signal).then((texture) => {
        if (controller.signal.aborted) {
          texture?.dispose();
          return;
        }
        const current = toggleRef.current?.sunSurface ?? null;
        const currentImageryEl = toggleRef.current?.sunImageryEl ?? null;
        const currentImageryLabel = toggleRef.current?.sunImageryLabel ?? null;
        const currentObservationSub = toggleRef.current?.sunObservationSub ?? null;
        if (!current) {
          texture?.dispose();
          return;
        }
        // Transient miss -> keep the last good disk; the build path owns the honest
        // hidden ("imagery unavailable") state, so we never flash a fake Sun.
        // Only when we have NEVER loaded a disk does the label stay visible.
        if (!texture) {
          if (currentImageryEl && currentImageryLabel && !current.visible) {
            currentImageryEl.textContent = `${SUN_FILTER_LABELS[solarFilter]} unavailable at the selected time`;
            currentImageryEl.dataset.state = 'unavailable';
            currentImageryLabel.visible = true;
          }
          return;
        }
        const material = current.material as THREE.MeshBasicMaterial;
        const previous = material.map;
        material.map = texture;
        material.needsUpdate = true;
        current.visible = true;
        if (currentObservationSub) {
          const observedAt = typeof texture.userData.observedAt === 'string' ? texture.userData.observedAt : null;
          currentObservationSub.textContent = sunObservationLabel(solarFilter, observedAt);
        }
        if (currentImageryEl && currentImageryLabel) {
          currentImageryEl.dataset.state = 'loaded';
          currentImageryEl.setAttribute('aria-hidden', 'true');
          currentImageryLabel.visible = false;
        }
        if (previous) previous.dispose();
      });
    }, freezeSolarImagery ? 0 : IMAGERY_SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [solarFilter, layers.realImagery, imageryBucket, builtTick, freezeSolarImagery, controls.interactionMode, imageryTimeUnix]);

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;
    const canvas = canvasRef.current;
    const host = hostRef.current;

    if (!canvas || !host) return undefined;

    const publishCapability = (next: HelioCanvasCapability) => {
      if (cancelled) return;
      setCapability(next);
      capabilityCallbackRef.current?.(next);
    };

    const pointer: PointerState = {
      primaryId: null,
      points: new Map(),
      x: 0,
      y: 0,
      downX: 0,
      downY: 0,
      moved: false,
      pinchDistance: null,
    };
    const isSolarFocus = controls.interactionMode === 'solar-focus';
    const isEarthImpact = controls.interactionMode === 'earth-impact';
    const isMagnetosphere = controls.interactionMode === 'magnetosphere';
    const cameraState = createDefaultCameraState();
    if (isSolarFocus) {
      cameraState.azimuth_deg = 0;
      cameraState.polar_deg = 10;
      cameraState.distance = 2.45;
    } else if (isEarthImpact) {
      cameraState.azimuth_deg = 196;
      cameraState.polar_deg = 15;
      cameraState.distance = 2.3;
    } else if (isMagnetosphere) {
      cameraState.azimuth_deg = 214;
      cameraState.polar_deg = 24;
      cameraState.distance = 8.5;
    } else {
      cameraState.azimuth_deg = controls.interactionMode === 'follow-event' ? 34 : 42;
      cameraState.polar_deg = controls.interactionMode === 'inspect' ? 18 : 28;
      cameraState.distance = controls.interactionMode === 'follow-event' ? 5.2 : 9.2;
    }
    const minZoom = isSolarFocus ? 1.15 : isEarthImpact ? 0.9 : isMagnetosphere ? 2.6 : 2.1;

    const run = async () => {
      publishCapability(INITIAL_CANVAS_CAPABILITY);

      let renderer: HelioRenderer;
      let isWebGpu: boolean;

      try {
        // Dev/debug escape hatch: ?hv-force-webgl=1 or localStorage flag forces
        // the WebGL2 path (e.g. when a WebGPU readback is needed for screenshots).
        const forceWebGl =
          (typeof localStorage !== 'undefined' && localStorage.getItem('hv-force-webgl') === '1') ||
          (typeof location !== 'undefined' && location.search.includes('hv-force-webgl'));
        const gpuProbe = await requestGpuAdapter();
        const preferGpu = !forceWebGl && gpuProbe.adapter !== null;
        const created = await createRenderer(canvas, preferGpu);
        renderer = created.renderer;
        isWebGpu = created.isWebGpu && preferGpu;
      } catch (error) {
        console.warn('HelioCanvas renderer creation failed', error);
        publishCapability(rendererCapability('none', 'Renderer creation failed before WebGL2 fallback could initialize.'));
        return;
      }

      if (cancelled) {
        renderer.dispose();
        return;
      }

      rendererRef.current = renderer;
      publishCapability(rendererCapability(isWebGpu ? 'webgpu' : 'webgl2'));

      const initialTime = timeRef.current || sceneData.epoch_unix;
      const initialLayers = layersRef.current;
      const scale = createScaleState(controls.scaleMode);
      // Seed with measured speed when already available. When it is not, a
      // neutral value is used only to satisfy scene construction and every line
      // is removed before the first frame can render.
      const initialWindSpeed = typeof solarWindSpeedKms === 'number' && solarWindSpeedKms > 0
        ? solarWindSpeedKms
        : null;
      const parkerGrid = computeParkerGrid(initialWindSpeed ?? sceneData.parkerGridDefaults.speed_kms);
      scaleRef.current = scale;
      const objects = createSceneObjects(sceneData.sun, sceneData.earth, sceneData.l1, parkerGrid, scale);
      const { scene, sun, earth, l1 } = objects;
      // At heliosphere scale the physical Earth–L1 separation collapses below
      // the marker diameter. Keep the point out of the general scene and show
      // it only in the dedicated upstream-monitor inspection view.
      l1.visible = controls.interactionMode === 'inspect';
      if (initialWindSpeed == null) {
        for (const child of [...objects.parkerGrid.children]) {
          objects.parkerGrid.remove(child);
          if (child instanceof THREE.Line) {
            child.geometry.dispose();
            const material = child.material;
            if (Array.isArray(material)) material.forEach((item) => item.dispose());
            else material.dispose();
          }
        }
      }
      scene.fog = new THREE.FogExp2(0x05091a, 0.04);
      scene.background = createSpaceGradientTexture();

      // PROVENANCE: the Sun's observed hemisphere is ALWAYS the real SDO/
      // Helioviewer frame, reprojected onto `sunSurface` below. The core is only
      // a neutral dark volume behind it — never procedural solar structure.
      // If real imagery is unavailable it stays dark and an honest label shows.
      const sunMaterial = sun.material as THREE.MeshStandardMaterial;
      sunMaterial.map = null;
      sunMaterial.emissiveMap = null;
      sunMaterial.color.setHex(0x0b0b12);
      sunMaterial.emissive.setHex(0x0a0a14);
      sunMaterial.emissiveIntensity = 0.5;
      sunMaterial.roughness = 1;
      sunMaterial.needsUpdate = true;
      sun.geometry.computeBoundingSphere();
      const sunRadius = sun.geometry.boundingSphere?.radius ?? 0.5;

      const earthMat = earth.material as THREE.MeshStandardMaterial;
      earthMat.color.set(0xffffff);
      earthMat.emissive.set(0x0a1a33);
      earthMat.emissiveIntensity = 0.3;
      applyRealEarthTexture(earthMat);

      const applyParkerGridStyle = (group: THREE.Object3D) => {
        const lines = group.children.filter((c): c is THREE.Line => c instanceof THREE.Line);
        lines.forEach((line, index) => {
          const material = line.material as THREE.LineBasicMaterial;
          material.transparent = true;
          material.depthWrite = false;
          material.blending = THREE.AdditiveBlending;
          material.opacity = 0.42;
          const hue = 0.54 + (index / Math.max(1, lines.length - 1)) * 0.16;
          material.color = new THREE.Color().setHSL(hue, 0.72, 0.62);
        });
      };
      applyParkerGridStyle(objects.parkerGrid);

      // PROVENANCE A1: DOM label attached to the parker grid group.
      // Carries only an unavailable message until a measured RTSW speed arrives.
      const parkerFallbackLabel = createDomLabel(
        initialWindSpeed == null
          ? 'Parker spiral unavailable — waiting for current RTSW speed'
          : `Parker spiral · modelled from ${Math.round(initialWindSpeed)} km/s L1 speed`,
        { kind: 'l1', accent: '#aac8ff' },
      );
      // Position at the outer edge of the spiral grid (near 1 AU on the ecliptic).
      parkerFallbackLabel.object.position.set(0.02, 0.08, 0);
      objects.parkerGrid.add(parkerFallbackLabel.object);

      parkerFallbackLabel.object.visible = true;
      objects.parkerGrid.userData.hasData = initialWindSpeed != null;
      objects.parkerGrid.visible = initialLayers.magneticField;

      const sunPointLight = objects.lights.getObjectByName('sun-light') as THREE.PointLight | null;
      if (sunPointLight) {
        sunPointLight.intensity = 3.4;
        sunPointLight.color = new THREE.Color(0xffe7c2);
      }
      const ambientLight = objects.lights.getObjectByName('ambient') as THREE.AmbientLight | null;
      if (ambientLight) {
        ambientLight.intensity = 0.7;
        ambientLight.color = new THREE.Color(0x2a3a66);
      }

      const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 120);
      const earthPosition = earth.position.clone();
      const earthRadius = Math.max(0.055, (earth.geometry.boundingSphere?.radius ?? 0.02) * 1.45);
      const cameraTarget = new THREE.Vector3();
      if (isSolarFocus) {
        cameraTarget.set(0, 0, 0);
      } else if (isEarthImpact || isMagnetosphere || controls.interactionMode === 'inspect') {
        cameraTarget.copy(earthPosition);
      } else if (controls.interactionMode === 'follow-event' && primaryEvent) {
        cameraTarget.set(earthPosition.x * 0.62, earthPosition.y, earthPosition.z * 0.4);
      } else {
        cameraTarget.set(earthPosition.x * 0.42, 0, 0);
      }

      // Static starfield: an orientation reference only — it does not rotate.
      const starField = createStarField(reducedMotion ? 420 : 980, 19, 23);
      // One travelling front per CME, each with a clickable DOM name label.
      const cmeVisualsList: CmeVisuals[] = [];
      const cones: THREE.Object3D[] = [];
      const pickables: THREE.Object3D[] = [];
      const cmeLabels: Array<{ ref: DomLabel; visuals: CmeVisuals }> = [];
      for (const cme of cmes) {
        const visuals = createCmeVisuals(cme.event, scale);
        if (!visuals) continue;
        visuals.cone.visible = initialLayers.cmeCone;
        scene.add(visuals.group);
        cmeVisualsList.push(visuals);
        cones.push(visuals.cone);
        pickables.push(visuals.pickSphere, visuals.beacon);
        // Label accent matches the speed-driven cloud colour (A3 consistency).
        const accent = cmeSpeedColorCss(cme.event.speed_kms);
        const labelRef = createDomLabel(cme.label, {
          kind: 'cme',
          accent,
          onClick: () => selectRef.current?.(cme.event.id),
        });
        scene.add(labelRef.object);
        cmeLabels.push({ ref: labelRef, visuals });
      }

      const sunVisuals: SunVisuals = createSunGlow(sunRadius);
      const sunFxTargets = { core: sunMaterial, visuals: sunVisuals };
      sunFxRef.current = sunFxTargets;
      applySolarFilter(sunMaterial, sunVisuals, solarFilter);

      const sunSurface = createSunObservationSphere(sunRadius);
      // PROVENANCE R4/R5: honest "imagery unavailable" label over the Sun.
      // Shown whenever real-imagery is enabled but no SDO/Helioviewer disk has
      // loaded yet (loading or feed failure). The Sun core is an intentional
      // dark occluder behind the real disk; without this label a failed/late
      // load reads as a silent near-black sphere — exactly the synthetic-looking
      // state the prime directive forbids. We never fall back to a fabricated
      // Sun; the label + dark occluder IS the honest empty state.
      const sunImageryLabel = createDomLabel('Loading measured solar frame…', {
        kind: 'sun',
        accent: '#ffcf85',
      });
      sunImageryLabel.object.position.set(0, sunRadius + 0.34, 0);
      scene.add(sunImageryLabel.object);
      const showSunImageryLabel = (show: boolean) => {
        sunImageryLabel.object.visible = show;
      };
      // Disk starts hidden → show the honest label until a real frame lands.
      showSunImageryLabel(initialLayers.realImagery);
      // The post-build imagery effect owns all Helioviewer network requests so
      // every load has a timer, AbortController, and cleanup path.

      const earthGlow = createEarthGlow(earthRadius);
      earthGlow.position.copy(earthPosition);

      const planetSystem: PlanetSystem = createPlanetSystem(scale, initialTime);
      planetSystem.orbitRings.visible = initialLayers.orbits;
      planetSystem.group.visible = !isSolarFocus;

      // DOM overlay label layer (CSS2DRenderer): real, clickable HTML labels that
      // sit over the canvas rather than being painted into it.
      const labelRenderer = createLabelRenderer(host.clientWidth || 320, host.clientHeight || 280);
      host.appendChild(labelRenderer.domElement);

      // Anchor bodies — always available, shown subtly (brighten on hover via CSS).
      const sunLabelRef = createDomLabel('Sun', { kind: 'sun', accent: '#ffcf85' });
      sunLabelRef.sub.textContent = '';
      sunLabelRef.object.position.set(0, sunRadius + 0.16, 0);
      scene.add(sunLabelRef.object);
      const earthLabelRef = createDomLabel('Earth', { kind: 'earth', accent: '#7fd4ff' });
      earthLabelRef.object.position.set(earthPosition.x, earthPosition.y + earthRadius * 3, earthPosition.z);
      scene.add(earthLabelRef.object);
      const l1LabelRef = createDomLabel(sceneData.l1.spacecraft || 'L1', { kind: 'l1', accent: '#7ddf64' });
      l1LabelRef.object.position.copy(l1.position).add(new THREE.Vector3(0, 0.12, 0));
      scene.add(l1LabelRef.object);

      // The other planets are context, not the subject: their labels stay hidden
      // until the cursor is near them (handled per-frame), so they don't clutter.
      const planetLabels: Array<{ ref: DomLabel; container: THREE.Object3D }> = [];
      for (const body of planetSystem.bodies) {
        const labelRef = createDomLabel(body.label, { kind: 'planet', accent: '#9fb4d6' });
        labelRef.object.position.set(0, 0.08, 0);
        body.container.add(labelRef.object);
        planetLabels.push({ ref: labelRef, container: body.container });
      }

      const sunDir = earthPosition.clone().negate().normalize();
      const earthFocus: EarthFocus | null = isEarthImpact
        ? createEarthFocus(0.62, sunDir)
        : null;
      if (earthFocus) {
        earthFocus.group.position.copy(earthPosition);
        // A different spatial scale is now authoritative. Remove heliosphere
        // furniture that would imply CME/orbit distances inside this close-up.
        planetSystem.group.visible = false;
        sun.visible = false;
        sunVisuals.group.visible = false;
        earthGlow.visible = false;
        sunSurface.visible = false;
        for (const visuals of cmeVisualsList) visuals.group.visible = false;
      }

      // Magnetosphere view: an Earth-centred, Sun-aligned magnetopause + belt
      // structure built in Earth radii. 1 Re → RE_UNIT scene units.
      const RE_UNIT = 0.16;
      const magnetosphere: MagnetosphereVisuals | null = isMagnetosphere ? createMagnetosphere() : null;
      if (magnetosphere) {
        magnetosphere.group.position.copy(earthPosition);
        magnetosphere.group.scale.setScalar(RE_UNIT);
        // Orient so the magnetopause nose (+X) points at the Sun and the
        // magnetic axis (+Y) stays vertical.
        const xAxis = sunDir.clone();
        const zAxis = new THREE.Vector3().crossVectors(xAxis, new THREE.Vector3(0, 1, 0)).normalize();
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
        magnetosphere.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
        // Declutter the wide-system objects for the close Earth-space view.
        planetSystem.group.visible = false;
        sun.visible = false;
        sunVisuals.group.visible = false;
        earthGlow.visible = false;
        sunSurface.visible = false;
        for (const visuals of cmeVisualsList) visuals.group.visible = false;
      }

      scene.add(starField);
      scene.add(planetSystem.group);
      scene.add(sunVisuals.group);
      scene.add(sunSurface);
      scene.add(earthGlow);
      if (earthFocus) scene.add(earthFocus.group);
      if (magnetosphere) scene.add(magnetosphere.group);

      const toggleTargets: ToggleTargets = {
        parkerGrid: objects.parkerGrid,
        parkerFallbackEl: parkerFallbackLabel.el,
        parkerFallbackLabel: parkerFallbackLabel.object,
        cones,
        orbitRings: planetSystem.orbitRings,
        sunSurface,
        sunImageryEl: sunImageryLabel.el,
        sunImageryLabel: sunImageryLabel.object,
        sunObservationSub: sunLabelRef.sub,
      };
      toggleRef.current = toggleTargets;
      // Store the style applicator so the parker rebuild effect can reuse it.
      // Closure over the const is fine — it's stable for the build lifetime.
      (objects.parkerGrid as THREE.Object3D & { _applyStyle?: (g: THREE.Object3D) => void })._applyStyle = applyParkerGridStyle;
      if (!cancelled) setBuiltTick((tick) => tick + 1);

      const resize = () => {
        const rect = host.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width));
        const height = Math.max(280, Math.floor(rect.height));
        const mobileViewport = window.matchMedia('(max-width: 720px)').matches;
        const dprCap = reducedMotion ? 1.25 : mobileViewport ? 1.4 : 1.8;
        const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
        renderer.setPixelRatio(dpr);
        renderer.setSize(width, height, false);
        labelRenderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      window.addEventListener('resize', resize);
      resize();

      const raycaster = new THREE.Raycaster();
      const tryPick = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(pickables, false);
        const hit = hits.find((intersection) => intersection.object.userData?.eventId);
        selectRef.current?.((hit?.object.userData?.eventId as string | undefined) ?? null);
      };

      // Cursor position in client coords — used to reveal nearby planet labels.
      const hover = { x: 0, y: 0, inside: false };

      const currentPinchDistance = (): number | null => {
        const points = [...pointer.points.values()];
        if (points.length < 2) return null;
        const first = points[0];
        const second = points[1];
        if (!first || !second) return null;
        return Math.hypot(second.x - first.x, second.y - first.y);
      };

      const onPointerDown = (event: PointerEvent) => {
        pointer.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointer.points.size === 1) {
          pointer.primaryId = event.pointerId;
          pointer.x = event.clientX;
          pointer.y = event.clientY;
          pointer.downX = event.clientX;
          pointer.downY = event.clientY;
          pointer.moved = false;
          pointer.pinchDistance = null;
        } else {
          pointer.moved = true;
          pointer.pinchDistance = currentPinchDistance();
        }
        canvas.setPointerCapture(event.pointerId);
      };

      const onPointerMove = (event: PointerEvent) => {
        hover.x = event.clientX;
        hover.y = event.clientY;
        hover.inside = true;
        if (!pointer.points.has(event.pointerId)) return;
        pointer.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointer.points.size >= 2) {
          const distance = currentPinchDistance();
          if (distance && pointer.pinchDistance && Math.abs(distance - pointer.pinchDistance) > 0.5) {
            cameraState.distance = clamp(cameraState.distance * (pointer.pinchDistance / distance), minZoom, 18);
            pointer.moved = true;
          }
          pointer.pinchDistance = distance;
          return;
        }
        if (pointer.primaryId !== event.pointerId) return;
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        if (Math.hypot(event.clientX - pointer.downX, event.clientY - pointer.downY) > 5) pointer.moved = true;
        const orbitFactor = controls.interactionMode === 'inspect' ? 0.08 : 0.14;
        cameraState.azimuth_deg = (cameraState.azimuth_deg - dx * orbitFactor + 360) % 360;
        cameraState.polar_deg = clamp(cameraState.polar_deg + dy * orbitFactor, -58, 76);
      };

      const finishPointer = (event: PointerEvent, allowPick: boolean) => {
        const wasTap = allowPick && pointer.points.size === 1 && pointer.primaryId === event.pointerId && !pointer.moved;
        pointer.points.delete(event.pointerId);
        if (wasTap) tryPick(event.clientX, event.clientY);
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        if (pointer.points.size === 0) {
          pointer.primaryId = null;
          pointer.pinchDistance = null;
          pointer.moved = false;
          return;
        }
        const next = pointer.points.entries().next().value as [number, { x: number; y: number }] | undefined;
        if (next) {
          pointer.primaryId = next[0];
          pointer.x = next[1].x;
          pointer.y = next[1].y;
          pointer.downX = next[1].x;
          pointer.downY = next[1].y;
          pointer.pinchDistance = null;
        }
      };

      const onPointerUp = (event: PointerEvent) => finishPointer(event, true);
      const onPointerCancel = (event: PointerEvent) => finishPointer(event, false);

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const factor = event.deltaY > 0 ? 1.08 : 0.92;
        cameraState.distance = clamp(cameraState.distance * factor, minZoom, 18);
      };

      const onKeyDown = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        if (key === 'arrowleft') cameraState.azimuth_deg = (cameraState.azimuth_deg - 4 + 360) % 360;
        if (key === 'arrowright') cameraState.azimuth_deg = (cameraState.azimuth_deg + 4) % 360;
        if (key === 'arrowup') cameraState.polar_deg = clamp(cameraState.polar_deg + 3, -58, 76);
        if (key === 'arrowdown') cameraState.polar_deg = clamp(cameraState.polar_deg - 3, -58, 76);
        if (key === '+' || key === '=') cameraState.distance = clamp(cameraState.distance * 0.9, minZoom, 18);
        if (key === '-' || key === '_') cameraState.distance = clamp(cameraState.distance * 1.1, minZoom, 18);
        if (key === '0') {
          if (isSolarFocus) {
            cameraState.azimuth_deg = 0;
            cameraState.polar_deg = 10;
            cameraState.distance = 2.45;
          } else if (isEarthImpact) {
            cameraState.azimuth_deg = 196;
            cameraState.polar_deg = 15;
            cameraState.distance = 2.3;
          } else if (isMagnetosphere) {
            cameraState.azimuth_deg = 214;
            cameraState.polar_deg = 24;
            cameraState.distance = 8.5;
          } else {
            cameraState.azimuth_deg = controls.interactionMode === 'follow-event' ? 34 : 42;
            cameraState.polar_deg = controls.interactionMode === 'inspect' ? 18 : 28;
            cameraState.distance = controls.interactionMode === 'follow-event' ? 5.2 : 9.2;
          }
        }
      };

      const onPointerLeave = () => {
        hover.inside = false;
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerCancel);
      canvas.addEventListener('pointerleave', onPointerLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('keydown', onKeyDown);

      const clock = new THREE.Clock();
      const labelTmp = new THREE.Vector3();
      const anchorTmp = new THREE.Vector3();
      const inMag = isMagnetosphere;
      const inCloseEarth = isMagnetosphere || isEarthImpact;
      const cmeFrontByEvent = new Map<string, THREE.Vector3>();

      // Place + contextually show the DOM labels each frame.
      const updateLabels = () => {
        const labelsOn = layersRef.current.labels && !inMag && !isEarthImpact;
        // CSS2DRenderer owns each label element's `display` style. Reassert the
        // science state on the Three object every frame so a loaded real disk
        // can never retain the earlier "imagery unavailable" loading label.
        const imageryUnavailable = layersRef.current.realImagery && !sunSurface.visible && !inMag && !isEarthImpact;
        if (!sunSurface.visible) sunLabelRef.sub.textContent = '';
        sunImageryLabel.object.visible = imageryUnavailable;
        camera.updateMatrixWorld();
        const rect = canvas.getBoundingClientRect();
        const hx = hover.x - rect.left;
        const hy = hover.y - rect.top;

        sunLabelRef.object.visible = labelsOn && controls.interactionMode !== 'inspect';
        // Earth and L1 are visually inseparable in the log-compressed system
        // view. In L1 inspection the planet itself remains visible while the
        // one useful label identifies the upstream monitor without collision.
        earthLabelRef.object.visible = labelsOn && controls.interactionMode !== 'inspect';
        l1LabelRef.object.visible = labelsOn && controls.interactionMode === 'inspect';

        // Other planets: revealed only when the cursor is near their dot.
        for (const { ref, container } of planetLabels) {
          if (!labelsOn) {
            ref.object.visible = false;
            continue;
          }
          ref.object.visible = true;
          container.getWorldPosition(labelTmp).project(camera);
          const onScreen = labelTmp.z < 1;
          const sx = (labelTmp.x * 0.5 + 0.5) * rect.width;
          const sy = (-labelTmp.y * 0.5 + 0.5) * rect.height;
          const near = hover.inside && onScreen && Math.hypot(sx - hx, sy - hy) < 84;
          ref.el.classList.toggle('is-revealed', near);
        }

        // CME labels ride the front; only the selected one is emphasised.
        const selectedId = selectedRef.current;
        // The repurposed "Front data" layer (was "Event box") shows a measured
        // readout on each live front instead of the old sci-fi wireframe cage.
        const showReadout = layersRef.current.boundingBox;
        const tNow = timeRef.current || sceneData.epoch_unix;
        for (const { ref, visuals } of cmeLabels) {
          const front = cmeFrontByEvent.get(visuals.event.id);
          const keyEvent = visuals.event.id === selectedId || visuals.event.id === primaryEventId;
          const live = labelsOn && !!front && (keyEvent || showReadout);
          ref.object.visible = live;
          // Keep selection state correct even while hidden (pre-eruption).
          ref.el.classList.toggle('is-selected', visuals.event.id === selectedId);
          if (live && front) {
            const off = 0.14 + front.length() * 0.05;
            ref.object.position.set(front.x, front.y + off, front.z);
            // Angular width is MEASURED (DONKI); leading-edge distance is MODELLED
            // (DBM) — same source as the front position itself.
            ref.sub.textContent = showReadout
              ? `${Math.round(visuals.event.halfAngle_deg * 2)}° wide · ${(cmeFrontRadiusKm(visuals.event, tNow) / AU_KM).toFixed(2)} AU`
              : '';
          } else {
            ref.sub.textContent = '';
          }
        }

        // Pin point for the on-canvas inspector popover: the selected CME's
        // front, or its Sun-surface source beacon before it has erupted. The
        // integration layer positions the popover from these screen px — the
        // scene only reports geometry, never the popover's content.
        if (anchorRef.current) {
          let anchored = false;
          if (selectedId && !inMag) {
            for (const { visuals } of cmeLabels) {
              if (visuals.event.id !== selectedId) continue;
              const front = cmeFrontByEvent.get(visuals.event.id);
              if (front) anchorTmp.copy(front);
              else visuals.beacon.getWorldPosition(anchorTmp);
              anchored = true;
              break;
            }
          }
          if (!anchored) {
            anchorRef.current(0, 0, false);
          } else {
            anchorTmp.project(camera);
            const onScreen =
              anchorTmp.z < 1 &&
              anchorTmp.x >= -1 &&
              anchorTmp.x <= 1 &&
              anchorTmp.y >= -1 &&
              anchorTmp.y <= 1;
            anchorRef.current(
              (anchorTmp.x * 0.5 + 0.5) * rect.width,
              (-anchorTmp.y * 0.5 + 0.5) * rect.height,
              onScreen,
            );
          }
        }
      };

      const animate = () => {
        if (cancelled) return;
        const delta = Math.min(clock.getDelta(), 0.05);
        const t = timeRef.current || sceneData.epoch_unix;
        const activity = primaryEvent ? geomagneticActivity(primaryEvent, t) : 0;
        const selected = selectedRef.current;

        updatePlanetSystem(planetSystem, t);
        cmeFrontByEvent.clear();
        for (const visuals of cmeVisualsList) {
          if (inCloseEarth) {
            // Close Earth views use Earth radii / globe coordinates. A
            // heliocentric CME front has no meaningful place at this scale.
            visuals.group.visible = false;
            continue;
          }
          // Every displayed CME propagates independently through the operational
          // Sun→Earth domain. The live-scene filter removes departed fronts;
          // DONKI/ENLIL does not justify visually merging separate fronts here.
          const front = updateCmeVisuals(visuals, t, visuals.event.id === selected);
          if (front && isSolarFocus && front.length() > 1.1) {
            visuals.cloud.visible = false;
            visuals.glow.visible = false;
            visuals.pickSphere.visible = false;
            continue;
          }
          if (front) cmeFrontByEvent.set(visuals.event.id, front);
        }
        // Dim the static starfield while CME plasma is in flight so the bold
        // plasma clouds read as the unmistakable subject (stars are only an
        // orientation reference, not data).
        (starField.material as THREE.PointsMaterial).opacity = cmeFrontByEvent.size > 0 ? 0.34 : 0.85;
        if (earthFocus) updateEarthFocus(earthFocus, auroraGridRef.current);
        if (magnetosphere) {
          const suppliedState = magnetosphereStateRef.current;
          const state = suppliedState === undefined ? stormMagnetosphere(activity) : suppliedState;
          magnetosphere.group.visible = state != null;
          if (state) updateMagnetosphere(magnetosphere, state);
          if (!reducedMotion) magnetosphere.group.getObjectByName('magnetosphere-earth')?.rotateY(delta * 0.05);
        }

        // Decorative body rotation runs ONLY while the clock is
        // advancing (playing). Paused ⇒ the scene is genuinely still, so a paused
        // timeline never looks like a live, moving stream. Time-based motion (CME
        // fronts, planet positions) is already frozen because `t` is frozen.
        if (playingRef.current && !reducedMotion) {
          sun.rotation.y += delta * 0.08;
          earth.rotation.y += delta * 0.45;
          l1.rotation.y -= delta * 1.2;
        }

        positionCamera(camera, {
          target: cameraTarget,
          azimuthDeg: cameraState.azimuth_deg,
          polarDeg: cameraState.polar_deg,
          distance: cameraState.distance,
        });
        renderer.render(scene, camera);
        updateLabels();
        labelRenderer.render(scene, camera);
        frameId = window.requestAnimationFrame(animate);
      };

      animate();

      return () => {
        window.removeEventListener('resize', resize);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('keydown', onKeyDown);
        resizeObserver?.disconnect();
        if (frameId) window.cancelAnimationFrame(frameId);
        labelRenderer.domElement.remove();
        // A superseded async build can finish after its replacement. Never let
        // that stale cleanup clear refs owned by the newer live scene.
        if (toggleRef.current === toggleTargets) toggleRef.current = null;
        if (scene.background instanceof THREE.Texture) scene.background.dispose();
        disposeObject3D(scene);
        renderer.dispose();
        if (rendererRef.current === renderer) rendererRef.current = null;
        if (sunFxRef.current === sunFxTargets) sunFxRef.current = null;
      };
    };

    let cleanup: (() => void) | undefined;
    void run().then((dispose) => {
      cleanup = dispose;
      if (cancelled) cleanup?.();
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmes, primaryEvent, controls.interactionMode, controls.scaleMode, reducedMotion, sceneData]);

  return (
    <div
      ref={hostRef}
      className={`${HELIO_CANVAS_CLASSNAMES.root}${className ? ` ${className}` : ''}`}
      data-renderer={capability.path}
      data-scale={controls.scaleMode}
      data-mode={controls.interactionMode}
    >
      <canvas
        ref={canvasRef}
        className={HELIO_CANVAS_CLASSNAMES.canvas}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={`Interactive heliosphere canvas, active event ${activeLabel}. Click a CME to inspect it.`}
        role="img"
        tabIndex={0}
      />
      {/* The true-scale heliosphere map is useful only in system/transit views.
          Earth-space close-ups use a different scale and hide it explicitly. */}
      {controls.interactionMode !== 'solar-focus' && controls.interactionMode !== 'magnetosphere' && controls.interactionMode !== 'earth-impact' ? (
        <MiniMap cmes={cmes} timeUnix={timeUnix} sun={sunState} rightRailOpen={rightRailOpen} />
      ) : null}

    </div>
  );
}
