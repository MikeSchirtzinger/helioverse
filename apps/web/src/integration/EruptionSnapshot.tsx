/**
 * EruptionSnapshot.tsx — real, per-instrument imagery for a selected solar event.
 *
 * Every card stays on its named Helioviewer channel. An HTTP-200 image can still
 * be an eclipse/black frame, so decoded same-origin frames are sampled before
 * they are revealed. Unusable frames retry a bounded set of earlier times on
 * that same channel; they are never replaced with another instrument or with a
 * fabricated fallback.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  hasSolarSignalPixels,
  normalizeHelioviewerDate,
  solarImageCandidates,
} from '@/scene/solar-imagery';

type SnapKind = 'cme' | 'flare';
type FrameStatus = 'loading' | 'ready' | 'unavailable';

interface ImageSource {
  /** Helioviewer source id, verified against the live data-source registry. */
  id: number;
  /** Exact observatory/instrument/channel label shown to people. */
  name: string;
  /** What this view contributes to event monitoring. */
  view: string;
}

interface FrameState {
  candidateIndex: number;
  imageUrl: string | null;
  observedAt: string | null;
  status: FrameStatus;
}

interface ClosestFrame {
  id: string;
  observedAt: string;
}

const CME_SOURCES: readonly ImageSource[] = [
  { id: 11, name: 'SDO/AIA 193 Å', view: 'Source-region context' },
  { id: 4, name: 'SOHO/LASCO C2', view: 'Inner-corona view' },
  { id: 5, name: 'SOHO/LASCO C3', view: 'Wide-corona view' },
];

const FLARE_SOURCES: readonly ImageSource[] = [
  { id: 9, name: 'SDO/AIA 131 Å', view: 'Hot flare plasma' },
  { id: 11, name: 'SDO/AIA 193 Å', view: 'Coronal response' },
  { id: 13, name: 'SDO/AIA 304 Å', view: 'Chromosphere response' },
];

const IMG_SIZE = 480;
const SAMPLE_SIZE = 48;
const MAX_CANDIDATE_ATTEMPTS = 6;
/** Reject a "closest" frame that is actually from a distant archive boundary. */
const MAX_CANDIDATE_DISTANCE_MS = 45 * 60 * 1000;

function helioviewerEndpoint(path: string): string {
  if (typeof window === 'undefined') return `https://api.helioviewer.org/v2/${path}/`;
  return `${window.location.origin}/hv-api/v2/${path}/`;
}

function closestImageUrl(dateIso: string, sourceId: number): string {
  const url = new URL(helioviewerEndpoint('getClosestImage'));
  url.searchParams.set('date', dateIso);
  url.searchParams.set('sourceId', String(sourceId));
  return url.toString();
}

function downloadImageUrl(id: string): string {
  const url = new URL(helioviewerEndpoint('downloadImage'));
  url.searchParams.set('id', id);
  url.searchParams.set('width', String(IMG_SIZE));
  url.searchParams.set('type', 'png');
  return url.toString();
}

/** Explicit UTC stamp, e.g. "2026-06-03 11:48 UTC". */
function formatUtc(dateIso: string): string {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return `${dateIso} UTC`;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Ask for the exact event time first, then reuse the scene's proven rollback
 * schedule. De-duplication avoids spending two attempts on the same bucket.
 */
function boundedCandidates(dateIso: string): string[] {
  return [...new Set([dateIso, ...solarImageCandidates(dateIso)])]
    .slice(0, MAX_CANDIDATE_ATTEMPTS);
}

function frameIsNearCandidate(observedAt: string, candidateIso: string): boolean {
  const observedMs = Date.parse(observedAt);
  const candidateMs = Date.parse(candidateIso);
  return Number.isFinite(observedMs)
    && Number.isFinite(candidateMs)
    && Math.abs(observedMs - candidateMs) <= MAX_CANDIDATE_DISTANCE_MS;
}

async function closestFrame(
  candidateIso: string,
  sourceId: number,
  signal: AbortSignal,
): Promise<ClosestFrame | null> {
  try {
    const response = await fetch(closestImageUrl(candidateIso, sourceId), {
      signal,
      mode: 'cors',
    });
    if (!response.ok) return null;
    const payload = await response.json() as { id?: unknown; date?: unknown };
    const id = typeof payload.id === 'string' || typeof payload.id === 'number'
      ? String(payload.id)
      : null;
    const observedAt = normalizeHelioviewerDate(payload.date);
    return id && observedAt ? { id, observedAt } : null;
  } catch {
    return null;
  }
}

/** Load one immutable real frame into a same-origin blob URL with cancellation. */
async function downloadFrame(
  frameId: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(downloadImageUrl(frameId), {
      signal,
      mode: 'cors',
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (signal.aborted || blob.size === 0) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function loadDecodedImage(url: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }

    const image = new Image();
    image.decoding = 'async';
    const finish = (value: HTMLImageElement | null) => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', handleAbort);
      resolve(value);
    };
    const handleAbort = () => {
      image.removeAttribute('src');
      finish(null);
    };
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    signal.addEventListener('abort', handleAbort, { once: true });
    image.src = url;
  });
}

/** Sample a decoded, same-origin image without displaying a black frame. */
function loadedImageHasSignal(image: HTMLImageElement): boolean {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return false;
  const sample = document.createElement('canvas');
  sample.width = SAMPLE_SIZE;
  sample.height = SAMPLE_SIZE;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) return false;

  try {
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return hasSolarSignalPixels(
      context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data,
    );
  } catch {
    // A tainted/unreadable image cannot be verified and must not be presented.
    return false;
  }
}

const INITIAL_FRAME: FrameState = {
  candidateIndex: 0,
  imageUrl: null,
  observedAt: null,
  status: 'loading',
};

function EventImageCard({
  dateIso,
  label,
  source,
}: {
  dateIso: string;
  label: string;
  source: ImageSource;
}) {
  const candidates = useMemo(() => boundedCandidates(dateIso), [dateIso]);
  const [frame, setFrame] = useState<FrameState>(INITIAL_FRAME);
  const requestedUtc = formatUtc(dateIso);

  useEffect(() => {
    const controller = new AbortController();
    const objectUrls = new Set<string>();
    const sourceId = source.id;
    setFrame(INITIAL_FRAME);

    void (async () => {
      const attemptedFrameIds = new Set<string>();
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        if (controller.signal.aborted) return;
        setFrame({ candidateIndex, imageUrl: null, observedAt: null, status: 'loading' });

        const candidateIso = candidates[candidateIndex] ?? dateIso;
        const closest = await closestFrame(candidateIso, sourceId, controller.signal);
        if (controller.signal.aborted) return;
        if (
          !closest
          || attemptedFrameIds.has(closest.id)
          || !frameIsNearCandidate(closest.observedAt, candidateIso)
        ) continue;
        attemptedFrameIds.add(closest.id);

        const imageUrl = await downloadFrame(closest.id, controller.signal);
        if (controller.signal.aborted) {
          if (imageUrl) URL.revokeObjectURL(imageUrl);
          return;
        }
        if (!imageUrl) continue;
        objectUrls.add(imageUrl);

        const image = await loadDecodedImage(imageUrl, controller.signal);
        if (controller.signal.aborted) return;
        if (!image || !loadedImageHasSignal(image)) {
          objectUrls.delete(imageUrl);
          URL.revokeObjectURL(imageUrl);
          continue;
        }

        setFrame({
          candidateIndex,
          imageUrl,
          observedAt: closest.observedAt,
          status: 'ready',
        });
        return;
      }

      if (!controller.signal.aborted) {
        setFrame({
          candidateIndex: Math.max(0, candidates.length - 1),
          imageUrl: null,
          observedAt: null,
          status: 'unavailable',
        });
      }
    })();

    return () => {
      controller.abort();
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [candidates, dateIso, source.id]);

  const observedUtc = frame.observedAt ? formatUtc(frame.observedAt) : null;
  const alt = observedUtc
    ? `Real ${source.name} instrument imagery observed ${observedUtc} for ${label}; event requested ${requestedUtc}.`
    : '';

  return (
    <figure className="hv-erupt-snap__card" data-source-id={source.id} role="listitem">
      <div className="hv-erupt-snap__frame" data-status={frame.status}>
        {frame.status === 'ready' && frame.imageUrl ? (
          <img
            className="hv-erupt-snap__image"
            src={frame.imageUrl}
            alt={alt}
            width={IMG_SIZE}
            height={IMG_SIZE}
            decoding="async"
          />
        ) : null}

        {frame.status === 'loading' ? (
          <div className="hv-erupt-snap__status" role="status">
            Loading real {source.name} imagery…
          </div>
        ) : null}

        {frame.status === 'unavailable' ? (
          <div className="hv-erupt-snap__status hv-erupt-snap__status--unavailable" role="status">
            <span aria-hidden="true">☉</span>
            <span>
              No verified real {source.name} frame is available near the requested UTC.
            </span>
          </div>
        ) : null}
      </div>

      <figcaption className="hv-erupt-snap__caption">
        <strong>Real {source.name} imagery</strong>
        <span>{source.view}</span>
        <time dateTime={dateIso}>Event requested {requestedUtc}</time>
        {observedUtc && frame.observedAt ? (
          <small>
            <time dateTime={frame.observedAt}>Frame observed {observedUtc}</time>
          </small>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** A horizontally scrollable set of real instrument views for one event. */
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
  const requestedUtc = formatUtc(dateIso);

  return (
    <section
      className="hv-erupt-snap"
      aria-label={`Real instrument imagery for ${label}, requested ${requestedUtc}`}
    >
      <div
        className="hv-erupt-snap__rail"
        role="list"
        tabIndex={0}
        aria-label={`${label} instrument views. Swipe or use the left and right arrow keys to review each instrument.`}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          event.currentTarget.scrollBy({
            left: direction * Math.max(240, event.currentTarget.clientWidth * 0.72),
            behavior: 'smooth',
          });
        }}
      >
        {sources.map((source) => (
          <EventImageCard
            key={`${kind}:${label}:${dateIso}:${source.id}`}
            dateIso={dateIso}
            label={label}
            source={source}
          />
        ))}
      </div>
    </section>
  );
}
