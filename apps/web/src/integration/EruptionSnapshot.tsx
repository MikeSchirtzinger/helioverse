/**
 * EruptionSnapshot.tsx — a real Helioviewer thumbnail of the Sun at the moment a
 * selected event erupted (B2).
 *
 * Reuses the same `/hv-api` Helioviewer reverse-proxy + `takeScreenshot` PNG
 * pattern that `scene/solar-imagery.ts` uses for the 3D Sun disk (read-only
 * reference — this file does not import or edit scene code, it replicates the
 * proven call). CMEs are visible in the LASCO coronagraph field of view, so a
 * CME snapshot prefers LASCO C2 → C3, falling back to the AIA 193 Å disk; a
 * flare snapshot prefers the on-disk AIA channels. Every source is a REAL frame
 * nearest the requested time. If none load, an honest "no frame available"
 * state is shown — never a fabricated image.
 */
import { useEffect, useState } from 'react';

type SnapKind = 'cme' | 'flare';

interface SourceTry {
  /** Helioviewer source id. */
  id: number;
  /** Human label shown in the caption. */
  name: string;
  /** arcsec/pixel framing the instrument's field of view in IMG_SIZE px. */
  imageScale: number;
}

// CMEs live in the coronagraph field of view: try LASCO C2 (inner) then C3
// (wide), then the AIA 193 Å disk as a last-resort on-disk context frame.
const CME_SOURCES: SourceTry[] = [
  { id: 4, name: 'LASCO C2', imageScale: 24 },
  { id: 5, name: 'LASCO C3', imageScale: 112 },
  { id: 11, name: 'AIA 193 Å', imageScale: 5 },
];

// Flares are on-disk brightenings: the AIA EUV disk shows them best.
const FLARE_SOURCES: SourceTry[] = [
  { id: 11, name: 'AIA 193 Å', imageScale: 5 },
  { id: 13, name: 'AIA 304 Å', imageScale: 5 },
  { id: 4, name: 'LASCO C2', imageScale: 24 },
];

const IMG_SIZE = 480;

/** Build a Helioviewer `takeScreenshot` PNG URL through the same-origin /hv-api proxy. */
function snapshotUrl(dateIso: string, src: SourceTry): string {
  const origin =
    typeof window !== 'undefined' && window.location ? window.location.origin : 'https://api.helioviewer.org';
  const url = new URL(`${origin}/hv-api/v2/takeScreenshot/`);
  url.searchParams.set('date', dateIso);
  url.searchParams.set('imageScale', String(src.imageScale));
  url.searchParams.set('layers', `[${src.id},1,100]`);
  url.searchParams.set('x0', '0');
  url.searchParams.set('y0', '0');
  url.searchParams.set('width', String(IMG_SIZE));
  url.searchParams.set('height', String(IMG_SIZE));
  url.searchParams.set('display', 'true');
  url.searchParams.set('watermark', 'false');
  return url.toString();
}

/** Compact UTC stamp: "Jun 03 11:48Z". */
function fmt(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return dateIso;
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mon} ${day} ${hh}:${mm}Z`;
}

const FRAME_STYLE: React.CSSProperties = {
  position: 'relative',
  margin: '10px 0 0',
  borderRadius: 10,
  overflow: 'hidden',
  border: '1px solid var(--hv-hairline)',
  background: 'oklch(6% 0.02 268)',
  aspectRatio: '1 / 1',
};

/**
 * A real solar-imagery thumbnail at `dateIso` for the selected `label`.
 * `kind` picks the instrument preference order. Falls through the source list on
 * load failure and ends on an honest unavailable state if nothing is available.
 */
export function EruptionSnapshot({
  dateIso,
  label,
  kind = 'cme',
}: {
  dateIso: string;
  label: string;
  kind?: SnapKind;
}) {
  const sources = kind === 'flare' ? FLARE_SOURCES : CME_SOURCES;
  const [tryIdx, setTryIdx] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ok' | 'failed'>('loading');

  // Restart the source chain whenever the event (time) or kind changes.
  useEffect(() => {
    setTryIdx(0);
    setStatus('loading');
  }, [dateIso, kind]);

  const current = sources[tryIdx];
  const src = current ? snapshotUrl(dateIso, current) : null;
  const stamp = fmt(dateIso);

  return (
    <figure className="hv-erupt-snap" aria-label={`Eruption snapshot — ${label}`} style={{ margin: 0 }}>
      <div style={FRAME_STYLE}>
        {src && status !== 'failed' ? (
          <img
            key={src}
            src={src}
            alt={`Real ${current!.name} solar imagery nearest ${stamp} (${label} eruption)`}
            width={IMG_SIZE}
            height={IMG_SIZE}
            decoding="async"
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: status === 'ok' ? 1 : 0,
              transition: 'opacity 0.25s ease-out',
            }}
            onLoad={() => setStatus('ok')}
            onError={() => {
              if (tryIdx + 1 < sources.length) {
                setTryIdx(tryIdx + 1);
                setStatus('loading');
              } else {
                setStatus('failed');
              }
            }}
          />
        ) : null}

        {status === 'loading' ? (
          <div style={OVERLAY_STYLE}>
            <span style={{ fontSize: 11, color: 'var(--hv-muted)' }}>Loading {current?.name ?? 'imagery'}…</span>
          </div>
        ) : null}

        {status === 'failed' ? (
          <div style={OVERLAY_STYLE}>
            <span aria-hidden="true" style={{ fontSize: 22, opacity: 0.5 }}>☉</span>
            <span style={{ fontSize: 11, color: 'var(--hv-muted)', textAlign: 'center', maxWidth: '85%' }}>
              No coronagraph / disk frame available near {stamp}.
            </span>
          </div>
        ) : null}
      </div>

      <figcaption
        style={{
          marginTop: 5,
          fontSize: 10.5,
          color: 'var(--hv-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span>
          {status === 'ok' && current ? `Real ${current.name}` : 'Eruption snapshot'} · {stamp}
        </span>
        <span style={{ color: 'var(--hv-cyan)' }}>Helioviewer / SDO · LASCO</span>
      </figcaption>
    </figure>
  );
}

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 12,
};
