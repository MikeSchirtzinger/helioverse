import * as THREE from 'three';
import type { CmeEventData, ScaleState } from './types';
import type { AuroraGridPoint, SolarFilter } from './canvas-contract';
import { AU_KM } from './constants';
import { helioToSceneCartesian, objectSceneRadius } from './camera';
import { clamp, eventPulseSeed, seededRandom } from './canvas-helpers';
import { ALL_PLANETS, ORBIT_PLANETS, PLANET_ELEMENTS, PLANET_RADII_KM, planetHelioPoint, planetOrbitPoints, type PlanetName } from './ephemeris';
import { cmeFrontPoint, cmeFrontRadiusKm, cmeFrontSpeedKms, hasErupted } from './cme-propagation';
import { ionsFromMass } from './donki-feeds';
import { cmeSpeedColor, cmeMassKg, cmeMassScale } from './cme-style';
import {
  GEO_RE,
  QUIET_STANDOFF_RE,
  shueAlpha,
  shueRadiusRe,
  type MagnetosphereState,
} from './magnetosphere';
import { createDomLabel, type DomLabel } from './canvas-labels';

// ---------------------------------------------------------------------------
// CME particle cloud — absolute, disclosed constants
// IONS_PER_SPRITE: one sprite represents this many protons (order-of-magnitude,
//   derived from est. mass via Vourlidas 2010). Absolute across all scenes.
// CME_SPRITE_CAP / CME_SPRITE_MIN: hard limits so slow hardware stays OK.
// ---------------------------------------------------------------------------
export const IONS_PER_SPRITE = 2e36;
export const CME_SPRITE_CAP = 900;
export const CME_SPRITE_MIN = 80;

// SHEATH: outermost 12 % of the radial band — compressed density front.
const CME_SHEATH_FRAC = 0.12;
// Fraction of sprites placed in the sheath (the rest fill the inner ejecta).
const CME_SHEATH_SPRITE_FRAC = 0.25;

export interface CmeVisuals {
  group: THREE.Group;
  /** Translucent measured angular-width envelope (toggleable, default off). */
  cone: THREE.Mesh;
  /** Plasma particle cloud, positioned radially from the Sun. */
  cloud: THREE.Points;
  /** Eruption-source beacon on the Sun. */
  beacon: THREE.Mesh;
  /** Soft glow at the front. */
  glow: THREE.Sprite;
  /** Invisible click target tracking the front (userData.eventId). */
  pickSphere: THREE.Mesh;
  event: CmeEventData;
  scale: ScaleState;
  /** Baseline size multiplier from the CME's mass (mass → size). */
  massScale: number;
  /** Per-sprite fractional position within the radial band [0..1] — preserved across frames. */
  spriteFractions: Float32Array;
  /** Number of active sprites (≤ CME_SPRITE_CAP). */
  spriteCount: number;
  /** r_back_km at creation (trailing edge, km from Sun centre). */
  rBackKm: number;
}

export interface SunVisuals {
  group: THREE.Group;
  chromosphere: THREE.Mesh;
}

type GradientStop = [number, string];

/**
 * Generate a soft radial-gradient billboard texture. Used for additive glows
 * (sun corona, atmospheres, impact flares) so the scene reads as luminous
 * energy rather than flat-shaded geometry — and works identically on the
 * WebGPU and WebGL2 paths.
 */
export function createRadialSpriteTexture(stops: GradientStop[], size = 256): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Vertical deep-space gradient used as the scene backdrop. */
export function createSpaceGradientTexture(): THREE.Texture {
  const width = 8;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0a1430');
    gradient.addColorStop(0.4, '#070d22');
    gradient.addColorStop(0.72, '#04081a');
    gradient.addColorStop(1, '#01030c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A measured-driven visual halo around the real solar disk. It is deliberately
 * radial and structure-free: GOES X-ray flux controls brightness, but no flare
 * position or coronal feature is invented.
 */
export function createSunGlow(radius: number): SunVisuals {
  const group = new THREE.Group();
  group.name = 'sun-observation-shell';

  const chromosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.025, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0xff7b2e,
      transparent: true,
      opacity: 0.055,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  chromosphere.name = 'sun-chromosphere';
  group.add(chromosphere);

  return { group, chromosphere };
}

/**
 * Drive the Sun's brightness from MEASURED GOES soft X-ray activity
 * (0 quiet … ~1.5 large X-class; see `goes-xray.ts`). Called only
 * when the activity (or filter) changes — there is no per-frame oscillation.
 * `baseEmissive` is the current solar-filter palette's emissive intensity, which
 * the GOES factor multiplies. At activity 0 (quiet OR no data) the Sun sits at
 * its neutral baseline; no spatial flare feature is synthesized.
 */
export function applySunActivity(
  core: THREE.MeshStandardMaterial,
  visuals: SunVisuals,
  activity: number,
  baseEmissive: number,
): void {
  const a = clamp(activity, 0, 1.5);
  core.emissiveIntensity = baseEmissive * (1 + a * 0.6);

  // A thin 3D shell—not a billboard—brightens with measured flux. It carries
  // no invented surface structure and stays identical across WebGPU/WebGL.
  (visuals.chromosphere.material as THREE.MeshBasicMaterial).opacity = 0.045 + a * 0.035;
}

/** Emissive-intensity base for a solar filter — multiplied by GOES activity. */
export function sunPaletteEmissive(filter: SolarFilter): number {
  return (SOLAR_PALETTES[filter] ?? SOLAR_PALETTES.visible).emissiveIntensity;
}

/**
 * 3D observation surface carrying the real SDO/Helioviewer frame. The texture
 * is reprojected onto the measured Earth-facing hemisphere; the unseen far
 * side remains dark. Unlike the retired billboard, this object never turns to
 * face the camera, so orbiting reveals a real sphere instead of a flat card.
 */
export function createSunObservationSphere(radius: number): THREE.Mesh {
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.006, 96, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: true,
      depthWrite: true,
      fog: false,
    }),
  );
  surface.name = 'sun-real-observation-sphere';
  surface.renderOrder = 6;
  surface.userData = {
    provenance: 'Earth-facing hemisphere = measured Helioviewer/SDO; far side unavailable',
  };
  surface.visible = false;
  return surface;
}

/** Soft additive atmosphere halo billboarded around a planet. */
export function createEarthGlow(earthRadius: number): THREE.Sprite {
  const texture = createRadialSpriteTexture([
    [0, 'rgba(150,214,255,0.85)'],
    [0.32, 'rgba(76,150,255,0.4)'],
    [0.7, 'rgba(40,92,220,0.08)'],
    [1, 'rgba(40,92,220,0)'],
  ]);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.8,
      fog: false,
    }),
  );
  sprite.name = 'earth-atmosphere';
  sprite.scale.setScalar(earthRadius * 6);
  return sprite;
}

// The decorative nebula field was removed: it encoded nothing measured. The
// starfield stays as a STATIC orientation reference only (no motion).

export function createStarField(count = 900, radius = 18, seed = 42): THREE.Points {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const r = radius * (0.56 + random() * 0.44);
    const idx = i * 3;

    positions[idx] = r * Math.sin(phi) * Math.cos(theta);
    positions[idx + 1] = r * Math.cos(phi) * 0.62;
    positions[idx + 2] = r * Math.sin(phi) * Math.sin(theta);

    // ~14% of stars are brighter "hero" stars so the field has visual hierarchy.
    const hero = random() > 0.86;
    const warmth = random();
    const lift = hero ? 0.18 : 0;
    colors[idx] = Math.min(1, 0.58 + warmth * 0.36 + lift);
    colors[idx + 1] = Math.min(1, 0.68 + warmth * 0.25 + lift);
    colors[idx + 2] = Math.min(1, 0.86 + random() * 0.14 + lift);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.05,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(geometry, material);
  stars.name = 'instrument-starfield';
  return stars;
}

/** Unit direction from Sun centre toward a heliographic lon/lat. */
function directionFromHelio(lonDeg: number, latDeg: number): THREE.Vector3 {
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const lat = THREE.MathUtils.degToRad(latDeg);
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(cosLat * Math.cos(lon), Math.sin(lat), cosLat * Math.sin(lon)).normalize();
}

/** Orient a +Y cone so its apex sits at the Sun and it opens along `dir`. */
function orientConeAlong(cone: THREE.Mesh, dir: THREE.Vector3, length: number): void {
  cone.geometry.translate(0, -length / 2, 0); // tip → origin, opens toward −Y
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
}

/**
 * Time-driven CME: a quiet plasma density cloud that travels from the eruption
 * site outward as the scene clock advances (the cloud grows and
 * fades with distance — dissipation), an (off-by-default) angular envelope, and a
 * source beacon. The name label + its measured front readout are DOM overlays
 * managed by HelioCanvas, not part of this group. `updateCmeVisuals(_, unix, _)`
 * does the moving.
 */
export function createCmeVisuals(
  event: CmeEventData | null,
  scale: ScaleState,
): CmeVisuals | null {
  if (!event) return null;

  const auScene = scale.toSceneUnits(AU_KM);
  const seed = eventPulseSeed(event);
  const random = seededRandom(seed);
  const sourceDir = directionFromHelio(event.sourcePosition.lon_deg, event.sourcePosition.lat_deg);
  const speedColor = cmeSpeedColor(event.speed_kms);
  const massScale = cmeMassScale(cmeMassKg(event));

  const group = new THREE.Group();
  group.name = 'earth-coupled-cme';
  group.userData = { seed, eventId: event.id };

  // ---------------------------------------------------------------------------
  // Angular-width cone (DONKI, measured) — the real apex spread.
  // ---------------------------------------------------------------------------
  const coneLength = Math.max(1.35, auScene * 1.04);
  const halfAngle = THREE.MathUtils.degToRad(clamp(event.halfAngle_deg, 1, 89));
  const coneRadius = Math.tan(halfAngle) * coneLength;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(coneRadius, coneLength, 96, 1, true),
    new THREE.MeshBasicMaterial({
      color: speedColor,
      transparent: true,
      opacity: event.isHalo ? 0.06 : 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  cone.name = 'cme-angular-width-cone';
  cone.userData = { label: 'Angular-width cone (DONKI, measured)' };
  orientConeAlong(cone, sourceDir, coneLength);
  group.add(cone);

  // Source beacon on the Sun surface.
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  beacon.name = 'cme-source-beacon';
  beacon.userData = { eventId: event.id };
  const surf = helioToSceneCartesian({ ...event.sourcePosition }, scale.mode);
  beacon.position.set(surf.x, surf.y, surf.z);
  group.add(beacon);

  // ---------------------------------------------------------------------------
  // DATA-DRIVEN PARTICLE CLOUD
  // Sprite COUNT = est. ion budget / IONS_PER_SPRITE (absolute, same every scene).
  // estIons: from event.estIons if present, else derived via ionsFromMass(cmeMassKg(event)).
  // Both are ORDER-OF-MAGNITUDE estimates from the Vourlidas 2010 CME mass–width
  // relation — DONKI has no mass field.
  // ---------------------------------------------------------------------------
  const estIons = (event as { estIons?: number }).estIons ?? ionsFromMass(cmeMassKg(event));
  const nSprites = Math.max(CME_SPRITE_MIN, Math.min(CME_SPRITE_CAP, Math.round(estIons / IONS_PER_SPRITE)));

  const R1_KM_LOCAL = 21.5 * 6.957e5;

  // Pre-allocate to CAP; setDrawRange limits active sprites to nSprites.
  const positions = new Float32Array(CME_SPRITE_CAP * 3);
  const colors = new Float32Array(CME_SPRITE_CAP * 3);
  const spriteFractions = new Float32Array(CME_SPRITE_CAP);
  const spriteConeLon = new Float32Array(CME_SPRITE_CAP);
  const spriteConeLat = new Float32Array(CME_SPRITE_CAP);

  const nSheath = Math.round(nSprites * CME_SHEATH_SPRITE_FRAC);

  for (let i = 0; i < CME_SPRITE_CAP; i += 1) {
    if (i < nSheath) {
      // Sheath: compressed plasma in a thin shell just behind the shock front.
      spriteFractions[i] = (1 - CME_SHEATH_FRAC) + random() * CME_SHEATH_FRAC;
    } else {
      // Ejecta: front-weighted (real ICME density peaks toward the leading edge),
      // trailing off toward the back of the band — sqrt(u) biases toward 1.
      spriteFractions[i] = Math.sqrt(random()) * (1 - CME_SHEATH_FRAC);
    }

    const ha = halfAngle;
    const cosMin = Math.cos(ha);
    const cosTheta = cosMin + random() * (1 - cosMin);
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const phi = random() * Math.PI * 2;
    const lx = sinTheta * Math.cos(phi);
    const ly = sinTheta * Math.sin(phi);
    spriteConeLon[i] = lx;
    spriteConeLat[i] = ly;

    const p = helioToSceneCartesian({
      lon_deg: event.sourcePosition.lon_deg,
      lat_deg: event.sourcePosition.lat_deg,
      r_km: R1_KM_LOCAL,
    }, scale.mode);
    const idx = i * 3;
    positions[idx] = p.x;
    positions[idx + 1] = p.y;
    positions[idx + 2] = p.z;

    // Per-sprite brightness multiplies the saturated speed colour: a bright
    // compressed sheath at the front, slightly dimmer ejecta behind. Kept high
    // so the speed hue reads boldly (not washed toward grey).
    const isSheath = i < nSheath;
    const warm = isSheath ? (0.92 + random() * 0.08) : (0.72 + random() * 0.28);
    colors[idx] = warm;
    colors[idx + 1] = warm;
    colors[idx + 2] = warm;
  }

  const coneQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), sourceDir.clone().normalize());

  const cloudGeom = new THREE.BufferGeometry();
  cloudGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  cloudGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  cloudGeom.setDrawRange(0, nSprites);

  // Saturate the speed colour for the cloud so the plasma reads as an
  // unmistakable, vivid object against the starfield (the speed→hue mapping is
  // unchanged — only its saturation/lightness are lifted for legibility).
  const cloudColor = speedColor.clone();
  {
    const hsl = { h: 0, s: 0, l: 0 };
    cloudColor.getHSL(hsl);
    cloudColor.setHSL(hsl.h, Math.min(1, hsl.s * 1.4), Math.min(0.66, hsl.l * 1.08));
  }

  const cloud = new THREE.Points(
    cloudGeom,
    new THREE.PointsMaterial({
      map: createRadialSpriteTexture([
        [0, 'rgba(255,255,255,1)'],
        [0.35, 'rgba(255,255,255,0.92)'],
        [0.72, 'rgba(255,255,255,0.34)'],
        [1, 'rgba(255,255,255,0)'],
      ], 64),
      size: 0.024,
      color: cloudColor,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      alphaTest: 0.04,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
  cloud.name = 'cme-plasma';
  cloud.userData = {
    coneQuat,
    spriteConeLon,
    spriteConeLat,
    spriteFractions,
    nSprites,
    enlilDurationH: (event as { enlilDurationH?: number | null }).enlilDurationH ?? null,
  };
  group.add(cloud);

  const pickSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 16, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false }),
  );
  pickSphere.name = 'cme-pick';
  pickSphere.userData = { eventId: event.id };
  group.add(pickSphere);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createRadialSpriteTexture([
        [0, 'rgba(255,255,255,0.95)'],
        [0.3, 'rgba(255,255,255,0.5)'],
        [0.7, 'rgba(255,255,255,0.12)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
      color: speedColor,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
      fog: false,
    }),
  );
  glow.name = 'cme-front-glow';
  group.add(glow);

  return {
    group,
    cone,
    cloud,
    beacon,
    glow,
    pickSphere,
    event,
    scale,
    massScale,
    spriteFractions,
    spriteCount: nSprites,
    rBackKm: R1_KM_LOCAL,
  };
}

/**
 * Move the CME front to where it is at scene time `unix`. Motion is the modelled DBM
 * advance only: `cmeFrontPoint`/`cmeFrontRadiusKm` is the single source of the
 * front position (no per-CME easing). Because every front shares this clock, a
 * faster CME visibly overtakes a slower one during playback — that IS the
 * modelled coalescence projection, anchored to the event inputs.
 *
 * Size = estimated-mass baseline (`visuals.massScale`) + distance-based
 * expansion through the Earth-operational domain. As it expands it also FADES (`fade`): a visual
 * analogue of the density/energy dissipating as the front spreads — anchored to
 * the real DBM distance, never a clock-driven oscillation.
 */
export function updateCmeVisuals(
  visuals: CmeVisuals,
  unix: number,
  selected = false,
): THREE.Vector3 | null {
  const { event, scale } = visuals;
  const live = hasErupted(event, unix);

  const hoursFromLaunch = (unix - event.liftoff_unix) / 3600;
  const beaconFade = clamp(1 - Math.max(0, hoursFromLaunch) / 12, 0, 1);
  if (!live) {
    visuals.beacon.visible = hoursFromLaunch >= -6 && hoursFromLaunch < 0;
  } else {
    visuals.beacon.visible = beaconFade > 0.02;
    (visuals.beacon.material as THREE.MeshBasicMaterial).opacity = 0.72 * beaconFade;
  }

  visuals.cloud.visible = live;
  visuals.glow.visible = live;
  visuals.pickSphere.visible = live;
  if (!live) return null;

  const rFrontKm = cmeFrontRadiusKm(event, unix);
  const speedKms = cmeFrontSpeedKms(event, unix);

  const R1_KM_LOCAL = 21.5 * 6.957e5;
  const enlilDurationH: number | null = visuals.cloud.userData.enlilDurationH as number | null;
  let deltaRKm: number;
  if (enlilDurationH != null && enlilDurationH > 0) {
    deltaRKm = speedKms * enlilDurationH * 3600;
  } else {
    // No WSA-Enlil duration: estimate radial thickness from the measured cone
    // half-angle rather than substituting a fixed, data-looking duration.
    const halfAngleRad = THREE.MathUtils.degToRad(clamp(event.halfAngle_deg, 1, 89));
    deltaRKm = Math.sin(halfAngleRad) * rFrontKm;
  }
  // Cap the band to a coherent sheath+ejecta thickness so the cloud reads as a
  // travelling shell, not a smear back to the Sun. (Enlil shock-passage duration
  // × the fast front speed overestimates radial extent — the ejecta decelerates.)
  deltaRKm = Math.min(deltaRKm, 0.35 * AU_KM);
  const rBackKm = Math.max(R1_KM_LOCAL, rFrontKm - deltaRKm);

  const front = helioToSceneCartesian(cmeFrontPoint(event, unix), scale.mode);
  const frontVec = new THREE.Vector3(front.x, front.y, front.z);
  visuals.glow.position.copy(frontVec);
  visuals.pickSphere.position.copy(frontVec);

  const auScene = scale.toSceneUnits(AU_KM);
  const distFrac = clamp(frontVec.length() / Math.max(1e-3, auScene), 0, 1.8);

  // Operational departure fade: once the front has passed Earth's orbit it no
  // longer belongs in this Earth-weather event layer. Fade 1.02→1.20 AU and
  // remove it instead of letting old fronts collect around the viewport edge.
  const rAU = rFrontKm / AU_KM;
  const departure = clamp(1 - (rAU - 1.02) / 0.18, 0, 1);
  if (departure <= 0.02) {
    visuals.cloud.visible = false;
    visuals.glow.visible = false;
    visuals.pickSphere.visible = false;
    return null;
  }

  const blob = auScene * (0.014 * visuals.massScale + distFrac * 0.055);
  visuals.pickSphere.scale.setScalar(Math.max(blob, 0.06));

  const fade = clamp(1 - distFrac * 0.5, 0.18, 1) * departure;
  const cloudVis = clamp(1 - distFrac * 0.32, 0.48, 1) * departure;
  // The soft front glow is quiet chrome; the radial plasma particles remain the
  // subject. No sheet/disc is drawn because that framing is easy to misread as
  // a plane perpendicular to the Sun→front direction.
  visuals.glow.scale.setScalar(blob * 1.8);
  (visuals.glow.material as THREE.SpriteMaterial).opacity = (selected ? 0.16 : 0.08) * fade;
  const cloudMat = visuals.cloud.material as THREE.PointsMaterial;
  cloudMat.opacity = (selected ? 0.64 : 0.4) * cloudVis;
  // Sprite size scales with the cloud's own extent so the plasma reads as a
  // chunky, unmistakable cloud (not specks dwarfed by the ring). Visual-aid only.
  cloudMat.size = Math.max(0.012, blob * 0.05);

  // Update per-sprite positions
  const posAttr = visuals.cloud.geometry.getAttribute('position') as THREE.BufferAttribute;
  const posArr = posAttr.array as Float32Array;
  const coneQuat: THREE.Quaternion = visuals.cloud.userData.coneQuat as THREE.Quaternion;
  const spriteConeLon: Float32Array = visuals.cloud.userData.spriteConeLon as Float32Array;
  const spriteConeLat: Float32Array = visuals.cloud.userData.spriteConeLat as Float32Array;
  const spriteFractions: Float32Array = visuals.cloud.userData.spriteFractions as Float32Array;
  const nSprites: number = visuals.cloud.userData.nSprites as number;

  const localDir = new THREE.Vector3();
  const worldDir = new THREE.Vector3();

  for (let i = 0; i < nSprites; i += 1) {
    const frac = spriteFractions[i]!;
    const rKm = rBackKm + frac * (rFrontKm - rBackKm);

    const lx = spriteConeLon[i]!;
    const ly = spriteConeLat[i]!;
    const lz = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
    localDir.set(lx, ly, lz).normalize();
    worldDir.copy(localDir).applyQuaternion(coneQuat);

    const lat_rad = Math.asin(clamp(worldDir.y, -1, 1));
    const lon_rad = Math.atan2(worldDir.z, worldDir.x);
    const lon_deg = (lon_rad * 180) / Math.PI;
    const lat_deg = (lat_rad * 180) / Math.PI;

    const sp = helioToSceneCartesian({ lon_deg, lat_deg, r_km: rKm }, scale.mode);
    const idx = i * 3;
    posArr[idx] = sp.x;
    posArr[idx + 1] = sp.y;
    posArr[idx + 2] = sp.z;
  }

  posAttr.needsUpdate = true;

  return frontVec;
}

// ---------------------------------------------------------------------------
// Solar observation filters (NASA SDO/SWPC-style channels)
// ---------------------------------------------------------------------------

interface SolarPalette {
  emissiveIntensity: number;
}

const SOLAR_PALETTES: Record<SolarFilter, SolarPalette> = {
  visible: {
    emissiveIntensity: 1.35,
  },
  sdo131: {
    emissiveIntensity: 1.85,
  },
  sdo304: {
    emissiveIntensity: 1.95,
  },
  sdo171: {
    emissiveIntensity: 1.8,
  },
  sdo193: {
    emissiveIntensity: 1.7,
  },
  sdo211: {
    emissiveIntensity: 1.7,
  },
  magnetogram: {
    emissiveIntensity: 0.55,
  },
};

/**
 * PROVENANCE: the Sun's per-channel colour comes from the REAL SDO/Helioviewer
 * observation textured onto `sunSurface` — NOT from tinting a procedural sphere. This only
 * keeps the surrounding corona/glow a neutral warm-white (a legibility halo, not
 * data) at a per-channel size scale, and leaves the dark core untouched.
 */
export function applySolarFilter(
  _core: THREE.MeshStandardMaterial,
  visuals: SunVisuals,
  filter: SolarFilter,
): void {
  void filter;
  const neutralGlow = 0xffa24a;

  const chromoMat = visuals.chromosphere.material as THREE.MeshBasicMaterial;
  chromoMat.color.setHex(neutralGlow);
  chromoMat.opacity = 0.05;
}

// PROVENANCE: the procedural sunspot/granulation `createSunSurfaceTexture()`
// was removed (2026-06-16). The Sun's face is ALWAYS the real SDO/Helioviewer
// sphere (see HelioCanvas `sunSurface` + solar-imagery.ts); when imagery is missing
// the core stays a neutral dark occluder, never a seeded fake Sun.

// ---------------------------------------------------------------------------
// Inner-system planets + orbit rings (real relative positions by time)
// ---------------------------------------------------------------------------

export interface PlanetSystem {
  group: THREE.Group;
  orbitRings: THREE.Group;
  /** Display label text per planet (DOM labels are built by HelioCanvas). */
  bodies: Array<{ name: PlanetName; container: THREE.Object3D; label: string }>;
  scale: ScaleState;
  orbitLines: Map<PlanetName, THREE.Line>;
  orbitEpochDay: number;
}

interface PlanetVisual {
  color: number;
  label: string;
  axialTiltDeg: number;
}

const PLANET_VISUALS: Record<PlanetName, PlanetVisual> = {
  // PROVENANCE: stable reference colours and axial tilts follow NASA planetary
  // fact sheets. Colour is identity context, not a current measurement.
  mercury: { color: 0x9c8b7a, label: 'Mercury', axialTiltDeg: 0.03 },
  venus: { color: 0xe6c98a, label: 'Venus', axialTiltDeg: 177.4 },
  earth: { color: 0x3b7fd4, label: 'Earth', axialTiltDeg: 23.44 },
  mars: { color: 0xc65b34, label: 'Mars', axialTiltDeg: 25.19 },
  jupiter: { color: 0xcaa87a, label: 'Jupiter', axialTiltDeg: 3.13 },
  saturn: { color: 0xd8bf8a, label: 'Saturn', axialTiltDeg: 26.73 },
  uranus: { color: 0x93d8dc, label: 'Uranus', axialTiltDeg: 97.77 },
  neptune: { color: 0x4f73d8, label: 'Neptune', axialTiltDeg: 28.32 },
};

/** Scene-space position of a planet at `unix` (Earth-fixed heliocentric frame). */
function planetScenePosition(name: PlanetName, unix: number, scale: ScaleState): THREE.Vector3 {
  const { x, y, z } = helioToSceneCartesian(planetHelioPoint(name, unix), scale.mode);
  return new THREE.Vector3(x, y, z);
}

/** Build all eight major-planet orbits and the seven non-Earth bodies. */
export function createPlanetSystem(scale: ScaleState, unix: number): PlanetSystem {
  const group = new THREE.Group();
  group.name = 'solar-system-planets';
  const orbitRings = new THREE.Group();
  orbitRings.name = 'orbit-rings';
  const bodies: PlanetSystem['bodies'] = [];
  const orbitLines = new Map<PlanetName, THREE.Line>();

  // PROVENANCE: semi-major axes and orbital periods are the JPL approximate
  // elements in ephemeris.ts. The disclosed log transform is applied equally
  // to every heliocentric distance; no orbit is hand-positioned.
  for (const name of ALL_PLANETS) {
    const segments = 240;
    const points = planetOrbitPoints(name, unix, segments).map((point) => {
      const scenePoint = helioToSceneCartesian(point, scale.mode);
      return new THREE.Vector3(scenePoint.x, scenePoint.y, scenePoint.z);
    });
    const emphasis = name === 'earth';
    const outer = PLANET_ELEMENTS[name].au > PLANET_ELEMENTS.mars.au;
    // WebGPURenderer does not support LineLoop. The final point duplicates the
    // first, so an ordinary Line preserves the closed orbit without warnings.
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: emphasis ? 0x7fd4ff : outer ? 0x596481 : 0x5566aa,
        transparent: true,
        opacity: emphasis ? 0.34 : outer ? 0.11 : 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.name = `orbit-${name}`;
    orbitRings.add(ring);
    orbitLines.set(name, ring);
  }
  group.add(orbitRings);

  for (const name of ORBIT_PLANETS) {
    const visual = PLANET_VISUALS[name];
    const bodyRadius = objectSceneRadius(PLANET_RADII_KM[name], scale.mode);
    const container = new THREE.Object3D();
    container.name = `planet-${name}`;
    container.position.copy(planetScenePosition(name, unix, scale));

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(bodyRadius, 32, 24),
      new THREE.MeshStandardMaterial({
        color: visual.color,
        roughness: 0.85,
        metalness: 0.05,
        emissive: visual.color,
        emissiveIntensity: 0.12,
      }),
    );
    mesh.rotation.z = THREE.MathUtils.degToRad(visual.axialTiltDeg);
    mesh.userData = {
      radiusKm: PLANET_RADII_KM[name],
      provenance: 'NASA planetary fact sheet mean radius; rendered proportionally to the Sun',
    };
    container.add(mesh);

    if (name === 'saturn') {
      // Saturn's main rings span roughly 1.2–2.3 planetary radii. Their plane
      // follows the planet's measured 26.73° axial tilt; this is structure, not
      // a data-driven event effect.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(bodyRadius * 1.2, bodyRadius * 2.3, 96),
        new THREE.MeshBasicMaterial({
          color: 0xcbb78e,
          transparent: true,
          opacity: 0.58,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = THREE.MathUtils.degToRad(visual.axialTiltDeg);
      container.add(ring);
    }

    // Subtle halo only — the other planets are scale context, not the subject,
    // so they don't get the bright glow the Sun/Earth carry.
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createRadialSpriteTexture([
          [0, 'rgba(255,255,255,0.32)'],
          [0.4, 'rgba(255,255,255,0.07)'],
          [1, 'rgba(255,255,255,0)'],
        ]),
        color: visual.color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.28,
        fog: false,
      }),
    );
    // Locator halo has a minimum screen-legibility footprint. It is explicitly
    // metadata, never the body's diameter; the solid sphere above is to scale.
    halo.scale.setScalar(Math.max(bodyRadius * 4, 0.036));
    halo.userData = { label: 'planet locator — marker size does not encode diameter' };
    container.add(halo);

    group.add(container);
    bodies.push({ name, container, label: visual.label });
  }

  return { group, orbitRings, bodies, scale, orbitLines, orbitEpochDay: Math.floor(unix / 86_400) };
}

/** Reposition every planet for the current scene time. */
export function updatePlanetSystem(system: PlanetSystem, unix: number): void {
  for (const body of system.bodies) {
    body.container.position.copy(planetScenePosition(body.name, unix, system.scale));
  }
  const day = Math.floor(unix / 86_400);
  if (day === system.orbitEpochDay) return;
  system.orbitEpochDay = day;
  for (const [name, ring] of system.orbitLines) {
    const position = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    const points = planetOrbitPoints(name, unix, position.count - 1);
    for (let index = 0; index < points.length; index += 1) {
      const point = helioToSceneCartesian(points[index]!, system.scale.mode);
      position.setXYZ(index, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
    ring.geometry.computeBoundingSphere();
  }
}

// ---------------------------------------------------------------------------
// Earth-impact focus globe
// ---------------------------------------------------------------------------

export interface EarthFocus {
  group: THREE.Group;
  globe: THREE.Mesh;
  /**
   * Aurora oval torus — KEPT in the interface for disposal; always invisible in the
   * scene. The OVATION heatmap shell is the authoritative aurora representation;
   * when OVATION is absent we show an explicit "unavailable" label (auroraLabel)
   * rather than a synthetic unlabelled torus. See R1 provenance fix.
   */
  aurora: THREE.Mesh;
  /** Retired surface marker, always hidden: global Kp has no strike coordinate. */
  impact: THREE.Sprite;
  /**
   * DOM label: "aurora oval unavailable — no OVATION data" (R1 fix).
   * Shown when no live OVATION grid is received; hidden when the heatmap is active.
   */
  auroraLabel: DomLabel;
  /** Additive heatmap shell driven by the OVATION probability grid. Null when no grid was provided. */
  auroraHeatmap: THREE.Mesh | null;
  /** The last AuroraGridPoint[] reference seen — used to detect grid changes and avoid per-frame rebuilds. */
  _lastGrid: unknown;
}

/**
 * PROVENANCE: a NEUTRAL loading surface shown only for the brief moment before the
 * REAL NASA Blue Marble (`/textures/earth-day.jpg`) loads and is swapped in by
 * `applyRealEarthTexture`. It deliberately renders NO fabricated continents,
 * clouds or ice caps — we never invent geography. A flat ocean-blue gradient
 * reads honestly as "Earth, imagery loading".
 */
export function createEarthTexture(): THREE.Texture {
  const width = 256;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const ocean = ctx.createLinearGradient(0, 0, 0, height);
    ocean.addColorStop(0, '#0a2348');
    ocean.addColorStop(0.5, '#103f78');
    ocean.addColorStop(1, '#0a2348');
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, width, height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

// Cache the real NASA Blue Marble texture (bundled in public/textures). Shared
// across rebuilds; consumers `.clone()` it so teardown disposal is isolated.
let earthTexturePromise: Promise<THREE.Texture | null> | null = null;

export function loadRealEarthTexture(): Promise<THREE.Texture | null> {
  if (!earthTexturePromise) {
    earthTexturePromise = new Promise((resolve) => {
      new THREE.TextureLoader().load(
        '/textures/earth-day.jpg',
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          resolve(texture);
        },
        undefined,
        () => resolve(null),
      );
    });
  }
  return earthTexturePromise;
}

/** Swap a real Blue Marble texture onto a globe material once it loads. */
export function applyRealEarthTexture(material: THREE.MeshStandardMaterial): void {
  void loadRealEarthTexture().then((texture) => {
    if (!texture) return;
    const clone = texture.clone();
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.needsUpdate = true;
    if (material.map) material.map.dispose();
    material.map = clone;
    material.needsUpdate = true;
  });
}

/**
 * Detailed Earth globe for the impact-focus view: real Blue Marble reference
 * texture, atmosphere rim, and the measured-driven OVATION probability shell.
 *
 * PROVENANCE notes (see CLAUDE.md prime directive):
 *   - The globe texture is the real NASA Blue Marble; a geography-free neutral
 *     surface shows only during the brief load window.
 *   - Aurora is shown ONLY when the live OVATION grid is provided (heatmap
 *     shell). When no OVATION data is available, the torus is hidden and an
 *     explicit "unavailable" label is shown instead of a synthetic oval (R1).
 *   - No surface "impact" point is drawn: Kp is global and supplies no
 *     geographic strike coordinate.
 *   - The bow-shock arc (previously arbitrary geometry) has been removed. The
 *     dedicated magnetosphere view renders the real Shue-1998 boundary; keeping
 *     an unlabelled arc with a made-up standoff in this view was fabrication (R3).
 *
 * Earth sits at the origin of the returned group; caller positions it.
 * `sunDir` is the unit direction from Earth toward the Sun (in scene space).
 */
export function createEarthFocus(radius: number, sunDir: THREE.Vector3): EarthFocus {
  const group = new THREE.Group();
  group.name = 'earth-focus';

  const globeMaterial = new THREE.MeshStandardMaterial({
    map: createEarthTexture(), // neutral, geography-free loading surface
    roughness: 0.85,
    metalness: 0.05,
    emissive: 0x0a1a33,
    emissiveIntensity: 0.35,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 64), globeMaterial);
  globe.name = 'earth-globe';
  applyRealEarthTexture(globeMaterial);
  group.add(globe);

  // Atmosphere rim shell + soft halo.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.06, 48, 48),
    new THREE.MeshBasicMaterial({
      color: 0x5aa6ff,
      transparent: true,
      opacity: 0.14,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  group.add(atmosphere);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createRadialSpriteTexture([
        [0, 'rgba(150,210,255,0.0)'],
        [0.62, 'rgba(120,190,255,0.0)'],
        [0.74, 'rgba(120,190,255,0.4)'],
        [0.86, 'rgba(90,160,255,0.12)'],
        [1, 'rgba(90,160,255,0)'],
      ]),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.46,
      fog: false,
    }),
  );
  halo.scale.setScalar(radius * 2.55);
  group.add(halo);

  // PROVENANCE R1: aurora torus — kept for disposal but always invisible.
  // When OVATION data is present the heatmap shell is the authoritative
  // representation. When absent, the torus is NOT shown (no unlabelled
  // synthetic oval may render); instead `auroraLabel` shows an explicit
  // "unavailable" state. The torus geometry is retained only so the caller
  // can dispose it cleanly on teardown.
  const aurora = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.52, radius * 0.05, 16, 120),
    new THREE.MeshBasicMaterial({
      color: 0x6bff9a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  aurora.name = 'earth-aurora-oval';
  aurora.visible = false; // R1: never shown; see auroraLabel for the honest state
  aurora.rotation.x = Math.PI / 2;
  aurora.position.y = radius * 0.82;
  aurora.scale.y = 0.6;
  group.add(aurora);

  // PROVENANCE R1: DOM label shown when OVATION is unavailable. Positioned
  // near the north pole of the globe so it reads as aurora-region context.
  const auroraLabel = createDomLabel('aurora — OVATION unavailable', { kind: 'earth', accent: '#6bff9a' });
  auroraLabel.object.position.set(0, radius * 1.12, 0);
  group.add(auroraLabel.object);

  // RETIRED: the former Kp-driven surface point. Kp is global and carries no
  // geographic strike coordinate, so this remains invisible and exists only
  // for deterministic teardown compatibility with EarthFocus.
  const impact = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createRadialSpriteTexture([
        [0, 'rgba(255,240,200,0.95)'],
        [0.3, 'rgba(255,120,60,0.6)'],
        [0.7, 'rgba(255,90,40,0.12)'],
        [1, 'rgba(255,80,30,0)'],
      ]),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
      fog: false,
    }),
  );
  impact.name = 'earth-subsolar-point';
  impact.visible = false;
  impact.position.copy(sunDir.clone().multiplyScalar(radius * 1.02));
  impact.scale.setScalar(radius * 0.9);
  group.add(impact);

  // PROVENANCE R3: the bow-shock arc that previously used an arbitrary
  // standoff (radius*0.4) and arc span (Math.PI*0.85/1.1) has been removed.
  // Those values were fabricated geometry, not derived from the Shue-1998
  // model or any measured/modelled field. The dedicated magnetosphere view
  // already renders the real Shue-1998 magnetopause boundary; duplicating
  // it here with wrong geometry would blur measured vs fabricated. Nothing
  // in the scene graph replaces it — the honest state is absence.

  return { group, globe, aurora, auroraLabel, impact, auroraHeatmap: null, _lastGrid: undefined };
}

// ---------------------------------------------------------------------------
// OVATION aurora probability grid → DataTexture heatmap (360×181, 1°/cell)
// ---------------------------------------------------------------------------

/** Width of the aurora DataTexture (one column per degree of longitude 0–359). */
const AURORA_TEX_W = 360;
/** Height of the aurora DataTexture (one row per degree of latitude −90..+90). */
const AURORA_TEX_H = 181;

/**
 * Map an OVATION aurora probability (0–100) to an RGBA colour.
 *
 * PROVENANCE (SpaceWeather/Aurora.md prime directive): aurora colour is a
 * REAL, measured atomic emission line — green 557.7 nm (~100–150 km, O) and
 * red 630 nm (>200 km, O) are set by ALTITUDE, not by intensity. Painting
 * probability green→yellow→red trains the false belief that "red aurora =
 * strong" when in reality red means high-altitude. So probability must NOT
 * borrow the red emission colour.
 *
 * Encoding chosen: probability → BRIGHTNESS + OPACITY of a single aurora-green
 * (the 557.7 nm signature, the dominant real colour). Low prob = faint dim
 * green; high prob = bright green; alpha ∝ probability. Green is RESERVED
 * across the app for auroral emission; a future altitude-true curtain may use
 * red (630 nm, high) / pink (N₂⁺, low) on a SEPARATE layer, never on this
 * probability heatmap.
 *
 * OVATION probability is a measured nowcast (NOAA SWPC ovation_aurora_latest).
 *   prob  0 →  fully transparent (no aurora predicted)
 *   prob 40 →  medium aurora-green,  alpha 102
 *   prob100 →  bright aurora-green,  alpha 255
 */
function auroraProbToRgba(prob: number, out: Uint8Array, offset: number): void {
  const t = Math.max(0, Math.min(100, prob)) / 100;
  // Single aurora-green hue (≈557.7 nm); brightness rises with probability.
  const r = Math.round(90 * t);
  const g = Math.round(140 + 115 * t);
  const b = Math.round(90 + 80 * t);
  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = b;
  out[offset + 3] = Math.round(t * 255); // alpha ∝ probability (measured nowcast)
}

/**
 * Build or rebuild the OVATION heatmap DataTexture from a probability grid.
 * Returns the new mesh (already added to `focus.group`) or updates the
 * existing texture in-place if the mesh already exists.
 */
function applyAuroraGrid(focus: EarthFocus, grid: AuroraGridPoint[]): void {
  const radius = (focus.globe.geometry as THREE.SphereGeometry).parameters.radius;

  if (!focus.auroraHeatmap) {
    // Build the shell mesh once.
    const data = new Uint8Array(AURORA_TEX_W * AURORA_TEX_H * 4);
    const texture = new THREE.DataTexture(data, AURORA_TEX_W, AURORA_TEX_H, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.001, 64, 64), material);
    shell.name = 'aurora-heatmap-shell';
    focus.group.add(shell);
    focus.auroraHeatmap = shell;
  }

  // (Re-)populate the pixel data from the grid.
  const material = focus.auroraHeatmap.material as THREE.MeshBasicMaterial;
  const texture = material.map as THREE.DataTexture;
  const data = texture.image.data as Uint8Array;
  data.fill(0);

  for (const pt of grid) {
    if (pt.prob <= 0) continue;
    const x = Math.round(((pt.lon % 360) + 360) % 360); // 0–359
    const y = Math.round(pt.lat + 90); // 0–180
    if (x < 0 || x >= AURORA_TEX_W || y < 0 || y >= AURORA_TEX_H) continue;
    const offset = (y * AURORA_TEX_W + x) * 4;
    // Write only if this cell is brighter than what's already there (handles
    // duplicate lon/lat pairs in the OVATION dataset gracefully).
    if (data[offset + 3] === undefined || (data[offset + 3] as number) < pt.prob * 2.55) {
      auroraProbToRgba(pt.prob, data, offset);
    }
  }

  texture.needsUpdate = true;
}

/**
 * Animate the Earth-impact globe.
 *
 * PROVENANCE:
 *   - `auroraGrid`: when non-empty the OVATION heatmap shell is shown
 *     (authoritative measured-probability aurora). When absent, the synthetic
 *     torus is NOT shown; instead `focus.auroraLabel` appears ("OVATION
 *     unavailable") — no unlabelled synthetic oval ever renders (R1 fix).
 * The bow-shock arc was removed from the focus view entirely (R3 fix);
 * the real Shue-1998 boundary lives in the dedicated magnetosphere mode.
 *
 * When `auroraGrid` is a non-empty array the globe gains a live OVATION
 * probability heatmap shell. The shell is built once and the DataTexture
 * is refreshed only when the grid reference changes (no per-frame allocations).
 */
export function updateEarthFocus(
  focus: EarthFocus,
  auroraGrid?: AuroraGridPoint[] | null,
): void {
  // Kp is a global index, not a geographic impact coordinate. The former
  // subsolar sprite encoded Kp as a point on the map and could be read as a
  // predicted strike location, so it stays hidden. The labelled overlay carries
  // the WSA-Enlil Kp output without inventing spatial precision.
  focus.impact.visible = false;

  const hasGrid = Array.isArray(auroraGrid) && auroraGrid.length > 0;

  // The aurora torus is never shown (always invisible per R1 fix).
  focus.aurora.visible = false;

  if (hasGrid) {
    // Live OVATION grid is available: rebuild texture only when the reference changes.
    if (auroraGrid !== focus._lastGrid) {
      focus._lastGrid = auroraGrid;
      applyAuroraGrid(focus, auroraGrid as AuroraGridPoint[]);
    }
    if (focus.auroraHeatmap) focus.auroraHeatmap.visible = true;
    // OVATION data present — suppress the "unavailable" label.
    focus.auroraLabel.object.visible = false;
  } else {
    // No OVATION grid — hide the heatmap shell; show the honest "unavailable" label.
    if (focus.auroraHeatmap) focus.auroraHeatmap.visible = false;
    focus.auroraLabel.object.visible = true;
  }
}

// ---------------------------------------------------------------------------
// Magnetosphere compression + radiation belts
// ---------------------------------------------------------------------------

export interface MagnetosphereVisuals {
  /** Built in EARTH-RADII (Re) units, +X = sunward, +Y = magnetic axis. The
   *  caller scales (1 Re → reUnit), orients (+X→Sun), and positions at Earth. */
  group: THREE.Group;
  /** Shue magnetopause paraboloid (built at r0 = 1 Re; scaled to standoff). */
  magnetopause: THREE.Mesh;
  /** Dayside (sunward) dipole field lines that compress toward Earth. */
  dayField: THREE.Group;
  /** Outer Van Allen belt torus (shadowed/eroded as the boundary compresses). */
  outerBelt: THREE.Mesh;
  /** Inner Van Allen belt torus (stable). */
  innerBelt: THREE.Mesh;
  /** Geosynchronous-orbit ring at 6.6 Re — reddens when the boundary crosses it. */
  geoRing: THREE.Line;
}

/** Points of a single dipole field line (L-shell) in the φ meridian plane (Re). */
function dipoleFieldLinePoints(L: number, phiRad: number, segments = 56): THREE.Vector3[] {
  // r = L·cos²λ ; the line reaches the surface (r = 1) at λ = ±acos(√(1/L)).
  const lamMax = Math.acos(Math.sqrt(1 / L));
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const lam = -lamMax + 2 * lamMax * (i / segments);
    const r = L * Math.cos(lam) * Math.cos(lam);
    const horizontal = r * Math.cos(lam);
    const y = r * Math.sin(lam);
    points.push(new THREE.Vector3(horizontal * Math.cos(phiRad), y, horizontal * Math.sin(phiRad)));
  }
  return points;
}

function fieldLine(L: number, phiDeg: number, color: number, opacity: number): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    dipoleFieldLinePoints(L, THREE.MathUtils.degToRad(phiDeg)),
  );
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  return line;
}

/**
 * Earth's magnetosphere as a compressible structure: a small textured Earth, a
 * Shue (1998) magnetopause paraboloid, dipole field lines (dayside ones
 * compress sunward), the inner + outer Van Allen belts, and a geosynchronous
 * ring. Built in Earth-radii so the physics (standoff in Re, GEO at 6.6 Re)
 * maps 1:1 to geometry. `updateMagnetosphere` drives the compression.
 */
export function createMagnetosphere(): MagnetosphereVisuals {
  const group = new THREE.Group();
  group.name = 'earth-magnetosphere';

  // --- Earth (1 Re) ---
  const earthMaterial = new THREE.MeshStandardMaterial({
    map: createEarthTexture(),
    roughness: 0.85,
    metalness: 0.05,
    emissive: 0x0a1a33,
    emissiveIntensity: 0.35,
  });
  applyRealEarthTexture(earthMaterial);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), earthMaterial);
  earth.name = 'magnetosphere-earth';
  group.add(earth);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.08, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x5aa6ff, transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  group.add(atmosphere);

  // --- Magnetopause: Shue paraboloid revolved around the Sun–Earth (X) axis ---
  const alpha = shueAlpha(2, -1); // quiet-time shape; size is scaled per-frame
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i += 1) {
    // Dayside cap only (0 → ~94°): the sunward boundary whose standoff is the
    // story. A full Shue tail would flare to ~45 Re and swamp the nose.
    const theta = (i / 24) * Math.PI * 0.52;
    const r = shueRadiusRe(1, alpha, theta);
    profile.push(new THREE.Vector2(Math.max(1e-3, r * Math.sin(theta)), r * Math.cos(theta)));
  }
  const mpGeometry = new THREE.LatheGeometry(profile, 36);
  mpGeometry.rotateZ(-Math.PI / 2); // revolve axis Y → +X (nose points sunward)
  const magnetopause = new THREE.Mesh(
    mpGeometry,
    // A wire boundary keeps the measured-driven interior readable and avoids a
    // giant translucent blob swallowing the whole scene on WebGPU.
    new THREE.MeshBasicMaterial({
      color: 0x4fd0ff,
      transparent: true,
      opacity: 0.16,
      wireframe: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
    }),
  );
  magnetopause.name = 'magnetopause';
  group.add(magnetopause);

  // --- Dipole field lines (dayside compresses; nightside static) ---
  const dayField = new THREE.Group();
  dayField.name = 'dayside-field-lines';
  for (const L of [2, 3, 4, 6]) {
    for (const phi of [-32, 0, 32]) dayField.add(fieldLine(L, phi, 0x6fb8ff, 0.32));
  }
  group.add(dayField);
  const nightField = new THREE.Group();
  nightField.name = 'nightside-field-lines';
  for (const L of [2, 3, 4, 6, 8]) {
    for (const phi of [148, 180, 212]) nightField.add(fieldLine(L, phi, 0x4a78c8, 0.26));
  }
  for (const phi of [90, 270]) for (const L of [3, 5]) nightField.add(fieldLine(L, phi, 0x4a78c8, 0.22));
  group.add(nightField);

  // --- Van Allen belts (axis = magnetic Y) ---
  const innerBelt = new THREE.Mesh(
    new THREE.TorusGeometry(1.7, 0.42, 16, 80),
    new THREE.MeshBasicMaterial({ color: 0xffb14d, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  innerBelt.name = 'inner-belt';
  innerBelt.rotation.x = Math.PI / 2;
  group.add(innerBelt);

  const outerBelt = new THREE.Mesh(
    new THREE.TorusGeometry(4.8, 1.35, 18, 96),
    new THREE.MeshBasicMaterial({ color: 0x6bff9a, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  outerBelt.name = 'outer-belt';
  outerBelt.rotation.x = Math.PI / 2;
  group.add(outerBelt);

  // --- Geosynchronous ring at 6.6 Re (equatorial X–Z plane) ---
  const geoPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i += 1) {
    const a = (i / 96) * Math.PI * 2;
    geoPoints.push(new THREE.Vector3(Math.cos(a) * GEO_RE, 0, Math.sin(a) * GEO_RE));
  }
  // Points already include the closing endpoint; LineLoop is unsupported by
  // Three's WebGPU renderer.
  const geoRing = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(geoPoints),
    new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  geoRing.name = 'geo-ring';
  group.add(geoRing);

  const geoLabel = createDomLabel('GEO 6.6 Rₑ', { kind: 'l1', accent: '#7fd4ff' });
  geoLabel.object.position.set(0, 0.3, GEO_RE);
  group.add(geoLabel.object);
  const sunLabel = createDomLabel('▸ Sun', { kind: 'sun', accent: '#ffcf85' });
  sunLabel.object.position.set(QUIET_STANDOFF_RE + 1.4, 0, 0);
  group.add(sunLabel.object);

  return { group, magnetopause, dayField, outerBelt, innerBelt, geoRing };
}

const GEO_RED = new THREE.Color(0xff4338);
const GEO_CALM = new THREE.Color(0x7fd4ff);
const BELT_CALM = new THREE.Color(0x6bff9a);
const BELT_HOT = new THREE.Color(0xff5a3c);
const MP_CALM = new THREE.Color(0x4fd0ff);
const MP_HOT = new THREE.Color(0xff7be0);

/** Drive the magnetosphere from a computed `MagnetosphereState` (Shue model). */
export function updateMagnetosphere(
  viz: MagnetosphereVisuals,
  state: MagnetosphereState,
): void {
  // Everything here is driven by the Shue `state` (standoff/compression), not a
  // clock — no arbitrary pulsing. Opacities are steady; the colour shift to hot
  // and the GEO-breach red are the real signal.
  const c = state.compression;

  // Magnetopause: scale the whole paraboloid so the nose sits at the standoff Re.
  viz.magnetopause.scale.setScalar(state.standoffRe);
  const mpMat = viz.magnetopause.material as THREE.MeshBasicMaterial;
  mpMat.color.copy(MP_CALM).lerp(MP_HOT, c);
  mpMat.opacity = 0.14 + c * 0.12;

  // Dayside field lines compress sunward with the standoff distance.
  viz.dayField.scale.x = clamp(state.standoffRe / QUIET_STANDOFF_RE, 0.46, 1.05);

  // Outer belt: tracks the (shadowed) outer edge, reddens + dims as it erodes.
  viz.outerBelt.scale.setScalar(clamp(state.outerBeltOuterRe / 6.8, 0.62, 1.05));
  const obMat = viz.outerBelt.material as THREE.MeshBasicMaterial;
  obMat.color.copy(BELT_CALM).lerp(BELT_HOT, c);
  obMat.opacity = 0.24 - c * 0.08;

  // GEO ring: cyan when safe, steady red once the boundary is inside it.
  const geoMat = viz.geoRing.material as THREE.LineBasicMaterial;
  if (state.insideGeo) {
    geoMat.color.copy(GEO_RED);
    geoMat.opacity = 0.85;
  } else {
    geoMat.color.copy(GEO_CALM);
    geoMat.opacity = 0.55;
  }
}
