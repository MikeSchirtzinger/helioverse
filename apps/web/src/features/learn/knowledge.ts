import type { CanvasInteractionMode, SolarFilter } from '@/scene/canvas-contract';

export type CausalStepId = 'sun' | 'transit' | 'l1' | 'coupling' | 'magnetosphere' | 'aurora';

export interface CausalStep {
  id: CausalStepId;
  index: string;
  shortLabel: string;
  title: string;
  question: string;
  plain: string;
  analogy: string;
  mechanism: string;
  timing: string;
  watch: string;
  source: string;
  provenance: 'measured' | 'modelled' | 'mixed';
  cameraMode: CanvasInteractionMode;
  solarFilter?: SolarFilter;
  keywords: string[];
}

/**
 * Helioverse's bounded SpaceWeather knowledge bank. Stable physical
 * constants are stated here; changing live values are always read from feeds.
 * Every step names the field that grounds the matching visual.
 */
export const CAUSAL_STEPS: readonly CausalStep[] = [
  {
    id: 'sun',
    index: '01',
    shortLabel: 'Sun',
    title: 'The Sun releases stored magnetic energy',
    question: 'What actually leaves the Sun?',
    plain: 'A flare is light. A CME is a cloud of magnetised plasma. A coronal hole releases a persistent fast stream. They are different events on different clocks.',
    analogy: 'Think flash, thrown ball, and steady hose: one eruption can produce more than one, but they do not travel the same way.',
    mechanism: 'Magnetic reconnection in an active region releases energy as X-rays and EUV, can launch a CME flux rope, and can accelerate energetic particles. A flare alone does not make an aurora.',
    timing: 'Flare light: about 8 minutes. CME: usually 1–4 days. Coronal-hole stream: about 2–4 days.',
    watch: 'The real SDO/Helioviewer disk, GOES 0.1–0.8 nm X-ray flux, and DONKI CME/FLR event records.',
    source: 'GOES `flux`; DONKI `classType`, `CMEAnalysis.speed/latitude/longitude/halfAngle`; Helioviewer SDO frame',
    provenance: 'measured',
    cameraMode: 'orbit',
    solarFilter: 'sdo193',
    keywords: ['sun', 'flare', 'cme', 'coronal hole', 'eruption', 'x-ray', 'active region', 'light'],
  },
  {
    id: 'transit',
    index: '02',
    shortLabel: 'Transit',
    title: 'The disturbance crosses the heliosphere',
    question: 'What happens between the Sun and Earth?',
    plain: 'The solar wind carries magnetic field outward. A CME expands and is accelerated or slowed toward the surrounding wind speed.',
    analogy: 'A fast boat pushing into a slower current loses speed; a slow object in a faster flow is carried along.',
    mechanism: 'Helioverse advances each front with a drag-based model. The launch state is anchored by measured DONKI kinematics; an ENLIL arrival, when present, anchors the Earth end. The path between them is a labelled interpolation/model output.',
    timing: 'The uncertainty in a well-observed CME arrival is commonly several hours, so an ETA is a window, not an appointment.',
    watch: 'Front distance, speed and width. Colour encodes measured launch speed; radial position is modelled; width is measured; mass is only estimated from width.',
    source: 'DONKI `CMEAnalysis.speed/halfAngle/time21_5`; WSA–ENLIL `estimatedShockArrivalTime`; DBM propagation',
    provenance: 'mixed',
    cameraMode: 'follow-event',
    keywords: ['transit', 'travel', 'propagation', 'dbm', 'enlil', 'parker spiral', 'solar wind', 'arrival', 'eta'],
  },
  {
    id: 'l1',
    index: '03',
    shortLabel: 'L1',
    title: 'Upstream spacecraft measure what is actually inbound',
    question: 'When does a forecast become a measurement?',
    plain: 'NOAA’s active real-time solar-wind spacecraft sample the flow about 1.5 million kilometres sunward of Earth. The feed names the active source; SOLAR-1, ACE or IMAP can appear. This is the first direct look at the field that will hit us.',
    analogy: 'It is a weather station upstream in a river: the water has not reached you yet, but it is now the same water.',
    mechanism: 'The measured bulk speed sets the remaining travel time. At 400 km/s the simple ballistic delay is about 62 minutes; at 800 km/s it is about 31 minutes. Public-feed latency is additional.',
    timing: 'Usually about 20–60 minutes of physical warning after the sample reaches the public feed.',
    watch: 'Bz, total field, wind speed, density, the instrument timestamp, and data age. Missing values stay unavailable.',
    source: 'NOAA RTSW active rows: `source`, `bz_gsm`, `bt`, `proton_speed`, `proton_density`, `time_tag`',
    provenance: 'measured',
    cameraMode: 'inspect',
    keywords: ['l1', 'solar-1', 'solar1', 'imap', 'ace', 'warning', 'speed', 'density', 'bz', 'sentinel', 'delay'],
  },
  {
    id: 'coupling',
    index: '04',
    shortLabel: 'Coupling',
    title: 'Southward Bz opens the coupling gate',
    question: 'Why does the direction of Bz matter?',
    plain: 'When the incoming field points south, it can reconnect with Earth’s north-pointing dayside field and transfer energy into the magnetosphere.',
    analogy: 'Opposite magnetic orientations can join like matching plug faces; the connection gives the solar wind a route into Earth’s magnetic system.',
    mechanism: 'Dayside reconnection drives the Dungey cycle. Coupling strengthens with southward field, speed and field magnitude; duration matters as much as the deepest instant.',
    timing: 'Sustained southward Bz for tens of minutes is more important than a brief spike. The full convection cycle is roughly 1–3 hours.',
    watch: 'Bz below zero, how long it stays there, speed, total field and the measured-to-modelled Newell coupling value.',
    source: 'NOAA RTSW `by_gsm/bz_gsm/proton_speed`; Newell coupling function (modelled from measured inputs)',
    provenance: 'mixed',
    cameraMode: 'magnetosphere',
    keywords: ['coupling', 'bz', 'southward', 'reconnection', 'dungey', 'newell', 'gate', 'magnetic field'],
  },
  {
    id: 'magnetosphere',
    index: '05',
    shortLabel: 'Tail',
    title: 'Earth stores the energy, then releases it',
    question: 'Why does aurora surge instead of glowing steadily?',
    plain: 'Reconnection loads energy into the magnetotail. A substorm releases that stored energy and sends electrons down field lines.',
    analogy: 'The storm is the season; a substorm is the thunderclap inside it.',
    mechanism: 'Dayside reconnection stretches tail flux during the growth phase. Nightside reconnection snaps it Earthward during expansion, forming a current wedge and accelerating particles. Dst describes the storm envelope; AE/AL or local magnetic bays identify substorm onset.',
    timing: 'Growth: often 30–60 minutes. Expansion: roughly 10–30 minutes. Recovery: about 1–2 hours.',
    watch: 'The Shue magnetopause is modelled from measured pressure and Bz. Kp is a three-hour global index and must not be treated as a minute-by-minute onset signal.',
    source: 'NOAA RTSW density/speed/Bz → Shue-1998 boundary; Kyoto `dst`; ground AE/AL when available',
    provenance: 'mixed',
    cameraMode: 'magnetosphere',
    keywords: ['magnetosphere', 'tail', 'substorm', 'storm', 'dst', 'kp', 'ring current', 'magnetopause'],
  },
  {
    id: 'aurora',
    index: '06',
    shortLabel: 'Aurora',
    title: 'Atmospheric atoms turn particle energy into light',
    question: 'Why is aurora green, red or purple?',
    plain: 'Incoming electrons excite oxygen and nitrogen. Those atoms and molecules release the energy as light at fixed wavelengths.',
    analogy: 'Each species has a spectral fingerprint. Colour is a readout of atom, altitude and collision rate—not a decorative intensity scale.',
    mechanism: 'Atomic oxygen emits green at 557.7 nm around 100–150 km. Its slower red 630.0 nm state survives mainly above about 200 km. Ionised nitrogen contributes blue/violet; energetic precipitation can make a pink lower edge.',
    timing: 'OVATION is a short nowcast of probable oval location. It is not a detector for a substorm happening over one longitude this minute.',
    watch: 'The globe heatmap uses the actual OVATION coordinate grid. Probability changes brightness/opacity only; emission colour retains its physical meaning.',
    source: 'NOAA OVATION `coordinates[][2]`; fixed O 557.7/630.0 nm and N₂⁺ emission lines',
    provenance: 'mixed',
    cameraMode: 'earth-impact',
    keywords: ['aurora', 'green', 'red', 'purple', 'oxygen', 'nitrogen', 'ovation', 'oval', 'colour', 'color', 'altitude'],
  },
] as const;

export function getCausalStep(id: CausalStepId): CausalStep {
  const match = CAUSAL_STEPS.find((step) => step.id === id) ?? CAUSAL_STEPS[0];
  if (!match) throw new Error('Helioverse causal knowledge bank is empty.');
  return match;
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'does', 'how', 'i', 'is', 'it', 'of', 'the', 'to', 'what', 'when', 'why']);

export function answerKnowledgeQuestion(question: string): CausalStep[] {
  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9+å⁺-]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  if (tokens.length === 0) return [];

  return CAUSAL_STEPS
    .map((step) => {
      const haystack = `${step.title} ${step.question} ${step.plain} ${step.mechanism} ${step.keywords.join(' ')}`.toLowerCase();
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { step, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.step);
}
