/**
 * scene/ephemeris.ts — Real planetary positions as a function of time.
 *
 * Pure functions, no three.js. Uses J2000 mean longitude, sidereal period,
 * semi-major axis, eccentricity, and longitude of perihelion. Kepler's equation
 * supplies the changing orbital radius and true anomaly. Inclination is omitted
 * because the instrument's orbit layer is intentionally an ecliptic projection.
 *
 * Frame convention: the scene keeps Earth on the +X axis (the Sun–Earth
 * line) so the existing Earth-directed CME geometry is preserved. Every
 * other planet is placed at its heliocentric longitude *minus* Earth's, i.e.
 * an Earth-fixed heliocentric frame. As time advances the planets sweep
 * around the Sun at their true synodic rates.
 */

import type { HelioPoint } from './types';
import { AU_KM } from './constants';

export type PlanetName = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

interface OrbitalElements {
  /** Mean longitude at the J2000 epoch (deg). */
  L0_deg: number;
  /** Sidereal orbital period (days). */
  period_days: number;
  /** Semi-major axis (AU) — used as the (circular) orbital radius. */
  au: number;
  /** Orbital eccentricity. */
  eccentricity: number;
  /** Longitude of perihelion at J2000 (deg). */
  perihelion_deg: number;
}

/**
 * Mean elements at J2000.0 (2000-01-01T12:00:00Z). Values from the JPL
 * approximate ephemerides; eccentricity/inclination are intentionally
 * dropped (circular, coplanar) for a clean instrument view.
 */
export const PLANET_ELEMENTS: Record<PlanetName, OrbitalElements> = {
  mercury: { L0_deg: 252.25084, period_days: 87.9691, au: 0.387098, eccentricity: 0.20563, perihelion_deg: 77.45645 },
  venus: { L0_deg: 181.97973, period_days: 224.701, au: 0.723332, eccentricity: 0.006772, perihelion_deg: 131.53298 },
  earth: { L0_deg: 100.46435, period_days: 365.25636, au: 1.0, eccentricity: 0.016709, perihelion_deg: 102.94719 },
  mars: { L0_deg: 355.45332, period_days: 686.98, au: 1.523679, eccentricity: 0.0934, perihelion_deg: 336.04084 },
  jupiter: { L0_deg: 34.40438, period_days: 4332.589, au: 5.20288, eccentricity: 0.0489, perihelion_deg: 14.75385 },
  saturn: { L0_deg: 49.94432, period_days: 10759.22, au: 9.536676, eccentricity: 0.0565, perihelion_deg: 92.43194 },
  uranus: { L0_deg: 313.23218, period_days: 30688.5, au: 19.189165, eccentricity: 0.0463, perihelion_deg: 170.96424 },
  neptune: { L0_deg: 304.88003, period_days: 60182, au: 30.069923, eccentricity: 0.009456, perihelion_deg: 44.97135 },
};

/** Mean physical radii from NASA planetary fact sheets (km). */
export const PLANET_RADII_KM: Record<PlanetName, number> = {
  mercury: 2439.7,
  venus: 6051.8,
  earth: 6371,
  mars: 3389.5,
  jupiter: 69_911,
  saturn: 58_232,
  uranus: 25_362,
  neptune: 24_622,
};

/** Unix seconds at the J2000.0 epoch (2000-01-01T12:00:00Z). */
export const J2000_UNIX = 946_728_000;

const DAY_S = 86_400;

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Heliocentric ecliptic mean longitude of a planet at a unix time (deg). */
export function planetLongitudeDeg(planet: PlanetName, unix: number): number {
  const { x, y } = planetCartesianAu(planet, unix);
  return wrap360(Math.atan2(y, x) * 180 / Math.PI);
}

function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  let eccentricAnomaly = meanAnomalyRad;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const f = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRad;
    eccentricAnomaly -= f / (1 - eccentricity * Math.cos(eccentricAnomaly));
  }
  return eccentricAnomaly;
}

function cartesianAtMeanAnomaly(el: OrbitalElements, meanAnomalyRad: number): { x: number; y: number } {
  const eccentricAnomaly = solveEccentricAnomaly(meanAnomalyRad, el.eccentricity);
  const orbitalX = el.au * (Math.cos(eccentricAnomaly) - el.eccentricity);
  const orbitalY = el.au * Math.sqrt(1 - el.eccentricity ** 2) * Math.sin(eccentricAnomaly);
  const perihelion = el.perihelion_deg * Math.PI / 180;
  return {
    x: orbitalX * Math.cos(perihelion) - orbitalY * Math.sin(perihelion),
    y: orbitalX * Math.sin(perihelion) + orbitalY * Math.cos(perihelion),
  };
}

function planetCartesianAu(planet: PlanetName, unix: number): { x: number; y: number } {
  const el = PLANET_ELEMENTS[planet];
  const days = (unix - J2000_UNIX) / DAY_S;
  const meanLongitude = wrap360(el.L0_deg + (360 * days) / el.period_days);
  const meanAnomaly = wrap360(meanLongitude - el.perihelion_deg) * Math.PI / 180;
  return cartesianAtMeanAnomaly(el, meanAnomaly);
}

/** Convenience: Earth's heliocentric ecliptic longitude (deg). */
export function earthLongitudeDeg(unix: number): number {
  return planetLongitudeDeg('earth', unix);
}

/**
 * Position of a planet as a scene HelioPoint in the Earth-fixed heliocentric
 * frame: longitude is measured from the Sun→Earth line (Earth ≈ 0), so the
 * scene can render it directly with `helioToSceneCartesian`.
 */
export function planetHelioPoint(planet: PlanetName, unix: number): HelioPoint {
  if (planet === 'earth') return { lon_deg: 0, lat_deg: 0, r_km: AU_KM };
  const position = planetCartesianAu(planet, unix);
  const earthAngle = earthLongitudeDeg(unix) * Math.PI / 180;
  const x = position.x * Math.cos(earthAngle) + position.y * Math.sin(earthAngle);
  const y = -position.x * Math.sin(earthAngle) + position.y * Math.cos(earthAngle);
  return {
    lon_deg: wrap360(Math.atan2(y, x) * 180 / Math.PI),
    lat_deg: 0,
    r_km: Math.hypot(x, y) * AU_KM,
  };
}

/** Sample one osculating orbit in the current Earth-fixed ecliptic frame. */
export function planetOrbitPoints(planet: PlanetName, unix: number, samples = 240): HelioPoint[] {
  if (planet === 'earth') {
    return Array.from({ length: samples + 1 }, (_, index) => ({
      lon_deg: (index / samples) * 360,
      lat_deg: 0,
      r_km: AU_KM,
    }));
  }
  const element = PLANET_ELEMENTS[planet];
  const earthAngle = earthLongitudeDeg(unix) * Math.PI / 180;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const meanAnomaly = (index / samples) * Math.PI * 2;
    const inertial = cartesianAtMeanAnomaly(element, meanAnomaly);
    const x = inertial.x * Math.cos(earthAngle) + inertial.y * Math.sin(earthAngle);
    const y = -inertial.x * Math.sin(earthAngle) + inertial.y * Math.cos(earthAngle);
    return {
      lon_deg: wrap360(Math.atan2(y, x) * 180 / Math.PI),
      lat_deg: 0,
      r_km: Math.hypot(x, y) * AU_KM,
    };
  });
}

/** Ordered list of the planets we render (excludes Earth, which is its own mesh). */
export const ORBIT_PLANETS: PlanetName[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

/** Every major-planet orbit, inner to outer. */
export const ALL_PLANETS: PlanetName[] = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
