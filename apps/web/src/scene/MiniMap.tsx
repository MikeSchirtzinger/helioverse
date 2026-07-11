/**
 * scene/MiniMap.tsx — Linear-distance inner-heliosphere map (top-down ecliptic plane).
 *
 * The hero 3D view is log-compressed for legibility; THIS is the honest one.
 * Hand-rolled SVG (no deps), Sun-centred, with a LINEAR radial scale: Earth sits
 * at true 1 AU and every in-flight CME front is drawn at its true heliocentric
 * radius (`cmeFrontRadiusKm`) and true angular width (`halfAngle_deg`), advancing
 * with the same master clock. Because the radial axis is linear in real distance,
 * the closing speed between two fronts is visually truthful — which is what makes
 * the cannibal-CME coalescence projection (`predictMerges`) readable here.
 *
 * Top-down ecliptic projection ⇒ the azimuth is heliographic longitude and
 * latitude is flattened; each arc is annotated with its apex latitude so a
 * high-latitude CME (which mostly misses Earth) is not mistaken for an in-plane one.
 *
 * The panel is DRAGGABLE (grab the header) and RESIZABLE (bottom-right handle),
 * defaulting to the lower-right of the stage — tucked beside the right rail when
 * it's open, hugging the edge when closed. Position + size persist to localStorage
 * so it stays where the user puts it across reloads.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CanvasCme } from './canvas-contract';
import { cmeFrontRadiusKm, hasErupted } from './cme-propagation';
import { AU_KM } from './constants';
import { clamp } from './canvas-helpers';
import { cmeSpeedColorCss, cmeMassKg, cmeMassScale } from './cme-style';
import { predictMerges } from './coalescence';
import type { GoesSunState } from './goes-xray';

interface MiniMapProps {
  cmes: CanvasCme[];
  /** Master-clock time the scene renders (unix seconds). */
  timeUnix: number;
  /** Live GOES-driven Sun state, surfaced honestly in the footer. */
  sun: GoesSunState;
  /** Right rail open? Drives the default right-side inset so the minimap tucks
   * beside the rail when open and hugs the edge when closed. Has no effect once
   * the user has dragged the panel — their position wins. */
  rightRailOpen?: boolean;
}

// --- SVG geometry (viewBox units; the rendered size is `size` px) ---
const SIZE = 204;
const CX = 102;
const CY = 100;
const PLOT_R = 84;
const MAX_AU = 1.62; // show out past Earth toward Mars' orbit (~1.52 AU)
const AU_PX = PLOT_R / MAX_AU;

// --- Panel sizing bounds ---
const MIN_SIZE = 150;
const MAX_SIZE = 380;
const DEFAULT_SIZE = 204;
/** Right-rail footprint (width 366 + 12 margin + a breath) to clear when open. */
const RAIL_INSET_OPEN = 392;
const RAIL_INSET_CLOSED = 16;
const STORAGE_KEY = 'hv-minimap-state-v2';

interface PersistedState {
  left: number;
  top: number;
  size: number;
}

function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedState>;
    if (
      typeof p.left === 'number' &&
      typeof p.top === 'number' &&
      typeof p.size === 'number' &&
      Number.isFinite(p.left) &&
      Number.isFinite(p.top) &&
      Number.isFinite(p.size)
    ) {
      return { left: p.left, top: p.top, size: clamp(p.size, MIN_SIZE, MAX_SIZE) };
    }
  } catch {
    /* localStorage may be unavailable (private mode) — degrade to defaults. */
  }
  return null;
}

const auToPx = (au: number) => au * AU_PX;

/** Polar → screen, with longitude as azimuth (y up, Earth/Sun line to the right). */
function polar(rPx: number, lonDeg: number): [number, number] {
  const a = (lonDeg * Math.PI) / 180;
  return [CX + rPx * Math.cos(a), CY - rPx * Math.sin(a)];
}

/** Sample an arc at constant radius from lon a→b into an SVG path string. */
function arcPath(rPx: number, lonA: number, lonB: number): string {
  const steps = 24;
  let d = '';
  for (let i = 0; i <= steps; i += 1) {
    const lon = lonA + ((lonB - lonA) * i) / steps;
    const [x, y] = polar(rPx, lon);
    d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

export function MiniMap({ cmes, timeUnix, sun, rightRailOpen = false }: MiniMapProps) {
  const persisted = useMemo(loadState, []);
  const [open, setOpen] = useState(true);
  const [size, setSize] = useState<number>(persisted?.size ?? DEFAULT_SIZE);
  // `pos` is null until measured (default right-side placement); a persisted
  // position restores immediately so the panel never flashes to centre.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(
    persisted ? { left: persisted.left, top: persisted.top } : null,
  );
  // Once the user drags, stop auto-repositioning on rail/viewport changes.
  const [userMoved, setUserMoved] = useState<boolean>(!!persisted);

  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origSize: number } | null>(null);

  // Persist position + size so the panel stays where the user put it.
  useEffect(() => {
    if (!pos) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: pos.left, top: pos.top, size }));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [pos, size]);

  // Default placement: lower-right of the stage, clearing the right rail when
  // open. Recomputes on rail/size changes only while the user hasn't dragged.
  const computeDefault = useCallback((): { left: number; top: number } | null => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!parent) return null;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const panelW = panel.offsetWidth || size + 18;
    const panelH = panel.offsetHeight || size + 104;
    const dockH = parseFloat(getComputedStyle(parent).getPropertyValue('--hv-dock-h')) || 150;
    const rightInset = rightRailOpen ? RAIL_INSET_OPEN : RAIL_INSET_CLOSED;
    const left = clamp(pw - panelW - rightInset, 8, Math.max(8, pw - panelW - 8));
    const top = clamp(ph - panelH - dockH - 16, 8, Math.max(8, ph - panelH - 8));
    return { left, top };
  }, [rightRailOpen, size]);

  useLayoutEffect(() => {
    if (userMoved) return;
    const next = computeDefault();
    if (next) setPos(next);
  }, [userMoved, computeDefault]);

  // Keep a user-placed panel on-screen when the viewport shrinks.
  useEffect(() => {
    if (!userMoved) return;
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const onResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const pw = parent.clientWidth;
      const ph = parent.clientHeight;
      setPos((cur) =>
        cur
          ? {
              left: clamp(cur.left, 0, Math.max(0, pw - panel.offsetWidth)),
              top: clamp(cur.top, 0, Math.max(0, ph - panel.offsetHeight)),
            }
          : cur,
      );
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [userMoved]);

  // --- Drag (by header) ---
  const onDragMove = useCallback((event: PointerEvent) => {
    const d = dragRef.current;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!d || !panel || !parent) return;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const left = clamp(d.origLeft + (event.clientX - d.startX), 0, Math.max(0, pw - panel.offsetWidth));
    const top = clamp(d.origTop + (event.clientY - d.startY), 0, Math.max(0, ph - panel.offsetHeight));
    setPos({ left, top });
  }, []);

  const onDragUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
  }, [onDragMove]);

  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Ignore the close button / non-primary buttons.
      if ((event.target as HTMLElement).closest('button')) return;
      if (event.button !== 0) return;
      setUserMoved(true);
      const cur = pos ?? computeDefault() ?? { left: 0, top: 0 };
      dragRef.current = { startX: event.clientX, startY: event.clientY, origLeft: cur.left, origTop: cur.top };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragUp);
    },
    [pos, computeDefault, onDragMove, onDragUp],
  );

  // --- Resize (bottom-right handle) ---
  const onResizeMove = useCallback((event: PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    // Dragging down-right grows; use the larger of dx/dy so it stays square-ish.
    const dx = event.clientX - r.startX;
    const dy = event.clientY - r.startY;
    setSize(clamp(r.origSize + Math.max(dx, dy), MIN_SIZE, MAX_SIZE));
  }, []);

  const onResizeUp = useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onResizeUp);
  }, [onResizeMove]);

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      resizeRef.current = { startX: event.clientX, startY: event.clientY, origSize: size };
      window.addEventListener('pointermove', onResizeMove);
      window.addEventListener('pointerup', onResizeUp);
    },
    [size, onResizeMove, onResizeUp],
  );

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragUp);
      window.removeEventListener('pointermove', onResizeMove);
      window.removeEventListener('pointerup', onResizeUp);
    },
    [onDragMove, onDragUp, onResizeMove, onResizeUp],
  );

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cmes) map.set(c.event.id, c.label);
    return map;
  }, [cmes]);

  // Merge projection depends only on the kinematics, not the clock.
  const merges = useMemo(() => predictMerges(cmes.map((c) => c.event)), [cmes]);

  // Per-CME geometry at the current clock (true radius from the same DBM the 3D
  // front uses — the radial axis is LINEAR, so motion here is to scale).
  const fronts = cmes
    .filter((c) => hasErupted(c.event, timeUnix))
    .map((c) => {
      const e = c.event;
      const rAu = cmeFrontRadiusKm(e, timeUnix) / AU_KM;
      const color = cmeSpeedColorCss(e.speed_kms);
      const width = 1.6 + cmeMassScale(cmeMassKg(e)) * 1.6; // stroke encodes mass
      const half = clamp(e.halfAngle_deg, 6, 80);
      return { id: e.id, lon: e.sourcePosition.lon_deg, lat: e.sourcePosition.lat_deg, rAu, color, width, half, label: c.label };
    });

  // A placement to use when the panel is collapsed or unmeasured — lower-right.
  const dockH = parseFloat(getComputedStyle(panelRef.current?.parentElement ?? document.documentElement).getPropertyValue('--hv-dock-h')) || 150;
  const rightInset = rightRailOpen ? RAIL_INSET_OPEN : RAIL_INSET_CLOSED;
  const fallbackLeft = Math.max(8, (panelRef.current?.parentElement?.clientWidth ?? 1200) - 150 - rightInset);
  const fallbackTop = Math.max(8, (panelRef.current?.parentElement?.clientHeight ?? 700) - 40 - dockH - 16);
  const placedPos = pos ?? { left: fallbackLeft, top: fallbackTop };

  if (!open) {
    return (
      <button
        type="button"
        className="hv-minimap-tab"
        ref={panelRef as React.RefObject<HTMLButtonElement>}
        onClick={() => setOpen(true)}
        style={{ ...tabStyle, left: placedPos.left, top: placedPos.top }}
        title="Show the linear-distance inner-heliosphere map"
      >
        ▣ Inner heliosphere
      </button>
    );
  }

  const earthR = auToPx(1);
  const ringAus = [0.5, 1, 1.5];

  return (
    <section
      ref={panelRef}
      className="hv-minimap"
      style={{ ...panelStyle, left: placedPos.left, top: placedPos.top, width: size + 18 }}
      aria-label="Linear-distance inner-heliosphere map (ecliptic plane)"
    >
      <header
        style={headStyle}
        onPointerDown={onHeaderPointerDown}
        title="Drag to move the minimap"
      >
        <span style={{ fontWeight: 700, letterSpacing: '0.04em', cursor: 'grab' }}>INNER HELIOSPHERE</span>
        <span style={{ color: 'rgba(180,200,230,0.6)', fontSize: 9 }}>top-down · linear AU</span>
        <button type="button" onClick={() => setOpen(false)} style={closeStyle} aria-label="Hide minimap" title="Hide minimap">
          ×
        </button>
      </header>

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Top-down ecliptic map of CME fronts at true radial distance"
        style={{ display: 'block' }}
      >
        {/* radial guide rings + AU ticks */}
        {ringAus.map((au) => {
          const r = auToPx(au);
          const earth = au === 1;
          return (
            <g key={au}>
              <circle
                cx={CX}
                cy={CY}
                r={r}
                fill="none"
                stroke={earth ? 'rgba(127,212,255,0.7)' : 'rgba(120,150,200,0.25)'}
                strokeWidth={earth ? 1.2 : 0.8}
                strokeDasharray={earth ? undefined : '2 3'}
              />
              <text x={CX + 2} y={CY - r - 1} fill="rgba(170,195,230,0.7)" fontSize={7} fontFamily="ui-monospace, monospace">
                {au} AU
              </text>
            </g>
          );
        })}

        {/* Sun–Earth reference line + Earth */}
        <line x1={CX} y1={CY} x2={CX + earthR} y2={CY} stroke="rgba(127,212,255,0.35)" strokeWidth={0.8} strokeDasharray="1 2" />
        {(() => {
          const [ex, ey] = polar(earthR, 0);
          return (
            <g>
              <circle cx={ex} cy={ey} r={3.2} fill="#7fd4ff" />
              <text x={ex + 5} y={ey + 3} fill="#aee4ff" fontSize={8} fontWeight={700}>
                Earth
              </text>
            </g>
          );
        })()}

        {/* merge projection markers (dashed ring at the predicted overtake radius) */}
        {merges.map((m) => {
          const r = auToPx(Math.min(MAX_AU, m.radiusAu));
          const leadLon = cmes.find((c) => c.event.id === m.leadId)?.event.sourcePosition.lon_deg ?? 0;
          const [mx, my] = polar(r, leadLon);
          const tone = m.beforeEarth ? '#ffd24a' : 'rgba(200,170,120,0.8)';
          return (
            <g key={`${m.leadId}-${m.chaseId}`}>
              <circle cx={CX} cy={CY} r={r} fill="none" stroke={tone} strokeWidth={1} strokeDasharray="3 2" opacity={0.85} />
              <circle cx={mx} cy={my} r={2.6} fill={tone} />
              <text x={mx + 4} y={my - 3} fill={tone} fontSize={7.5} fontWeight={700}>
                merge ~{m.radiusAu.toFixed(2)} AU
              </text>
            </g>
          );
        })}

        {/* CME fronts: arc at true radius, spanning true angular width */}
        {fronts.map((f) => {
          const r = auToPx(Math.min(MAX_AU, f.rAu));
          const [tx, ty] = polar(r, f.lon);
          return (
            <g key={f.id}>
              {/* trajectory spoke */}
              <line {...spoke(f.lon, r)} stroke={f.color} strokeWidth={0.6} opacity={0.4} />
              {/* the front arc (true half-angle either side of the apex longitude) */}
              <path d={arcPath(r, f.lon - f.half, f.lon + f.half)} fill="none" stroke={f.color} strokeWidth={f.width} strokeLinecap="round" opacity={0.92}>
                <title>{`${f.label} — ${f.rAu.toFixed(2)} AU, apex lat ${f.lat.toFixed(0)}°, ±${f.half.toFixed(0)}°`}</title>
              </path>
              {/* apex marker */}
              <circle cx={tx} cy={ty} r={1.8} fill={f.color} />
            </g>
          );
        })}

        {/* Sun */}
        <circle cx={CX} cy={CY} r={4} fill="#ffcf85" />
        <circle cx={CX} cy={CY} r={6.5} fill="none" stroke="rgba(255,207,133,0.4)" strokeWidth={1} />
      </svg>

      {/* coalescence read-out */}
      <div style={readoutStyle}>
        {merges.length === 0 ? (
          <span style={{ color: 'rgba(170,195,230,0.6)' }}>No co-directional CME merge projected before 1 AU.</span>
        ) : (
          merges.map((m) => (
            <div key={`${m.leadId}-${m.chaseId}`} style={{ color: m.beforeEarth ? '#ffd24a' : 'rgba(200,180,140,0.85)' }}>
              {short(labelById.get(m.chaseId))} overtakes {short(labelById.get(m.leadId))} · likely merge ~{m.radiusAu.toFixed(2)} AU
              {m.beforeEarth ? ' (before Earth)' : ' (past Earth)'} · T+{Math.round(m.tPlusH)}h
            </div>
          ))
        )}
      </div>

      {/* GOES Sun provenance — honest baseline label when no live flux */}
      <div style={{ ...goesStyle, color: sun.hasData && sun.activity >= 0.5 ? '#ffb14d' : 'rgba(170,195,230,0.7)' }}>
        ☀ {sun.note}
      </div>

      {/* Resize handle — bottom-right corner, draggable to scale the panel. */}
      <button
        type="button"
        onPointerDown={onResizePointerDown}
        style={resizeHandleStyle}
        aria-label="Resize minimap"
        title="Drag to resize"
      />
    </section>
  );
}

function spoke(lon: number, r: number): { x1: number; y1: number; x2: number; y2: number } {
  const [x2, y2] = polar(r, lon);
  return { x1: CX, y1: CY, x2, y2 };
}

function short(label: string | undefined): string {
  if (!label) return 'CME';
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

// --- inline styles (kept out of CSS so the console's stage rules can't hide it) ---
const panelStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 7,
  padding: '8px 9px 9px',
  borderRadius: 12,
  border: '1px solid rgba(120,150,200,0.28)',
  background: 'rgba(8,13,28,0.78)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  color: '#e7eefb',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fontSize: 11,
  boxShadow: '0 16px 40px rgba(2,6,18,0.5)',
  pointerEvents: 'auto',
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 7,
  marginBottom: 4,
  fontSize: 10.5,
  cursor: 'grab',
  userSelect: 'none',
};

const closeStyle: CSSProperties = {
  marginLeft: 'auto',
  border: '1px solid rgba(120,150,200,0.3)',
  background: 'transparent',
  color: 'rgba(200,215,240,0.8)',
  width: 18,
  height: 18,
  borderRadius: 6,
  cursor: 'pointer',
  lineHeight: 1,
  fontSize: 13,
};

const readoutStyle: CSSProperties = {
  marginTop: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 9.5,
  lineHeight: 1.3,
};

const goesStyle: CSSProperties = {
  marginTop: 5,
  paddingTop: 5,
  borderTop: '1px solid rgba(120,150,200,0.18)',
  fontSize: 9.5,
  fontFamily: 'ui-monospace, monospace',
};

const tabStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 7,
  padding: '6px 10px',
  borderRadius: 10,
  border: '1px solid rgba(120,150,200,0.3)',
  background: 'rgba(8,13,28,0.8)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  color: '#cfe0ff',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  pointerEvents: 'auto',
};

const resizeHandleStyle: CSSProperties = {
  position: 'absolute',
  right: 2,
  bottom: 2,
  width: 16,
  height: 16,
  padding: 0,
  border: 0,
  background: 'transparent',
  cursor: 'nwse-resize',
  // A subtle L-shaped corner affordance drawn in CSS so it's visible but quiet.
  backgroundImage:
    'linear-gradient(135deg, transparent 50%, rgba(150,175,215,0.55) 50%, rgba(150,175,215,0.55) 62%, transparent 62%, transparent 75%, rgba(150,175,215,0.55) 75%, rgba(150,175,215,0.55) 87%, transparent 87%)',
};
