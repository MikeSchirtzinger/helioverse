import { describe, expect, it } from 'vitest';
import { objectSceneRadius } from './camera';
import { SUN_COMPRESSED_SCENE_RADIUS, SUN_RADIUS_KM } from './constants';
import { ALL_PLANETS, ORBIT_PLANETS, PLANET_ELEMENTS, PLANET_RADII_KM, planetHelioPoint, planetOrbitPoints } from './ephemeris';

describe('solar-system ephemeris', () => {
  it('contains all eight major planets and renders every non-Earth body', () => {
    expect(ALL_PLANETS).toEqual(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
    expect(ORBIT_PLANETS).toEqual(['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
    expect(Object.keys(PLANET_ELEMENTS)).toHaveLength(8);
    expect(PLANET_ELEMENTS.neptune.au).toBeCloseTo(30.069923, 6);
  });

  it('keeps Earth on the Sun-Earth axis while other planets advance at their physical periods', () => {
    const epoch = 946_728_000;
    expect(planetHelioPoint('earth', epoch)).toMatchObject({ lon_deg: 0, lat_deg: 0 });
    const mercury = planetHelioPoint('mercury', epoch);
    expect(mercury.r_km).toBeGreaterThan(PLANET_ELEMENTS.mercury.au * (1 - PLANET_ELEMENTS.mercury.eccentricity) * 1.495978707e8);
    expect(mercury.r_km).toBeLessThan(PLANET_ELEMENTS.mercury.au * (1 + PLANET_ELEMENTS.mercury.eccentricity) * 1.495978707e8);
    expect(planetOrbitPoints('neptune', epoch)).toHaveLength(241);
  });

  it('uses one Sun-anchored radius ratio for every solid body in compressed mode', () => {
    const earthRadius = objectSceneRadius(PLANET_RADII_KM.earth, 'compressed');
    const jupiterRadius = objectSceneRadius(PLANET_RADII_KM.jupiter, 'compressed');
    expect(objectSceneRadius(SUN_RADIUS_KM, 'compressed')).toBe(SUN_COMPRESSED_SCENE_RADIUS);
    expect(jupiterRadius / earthRadius).toBeCloseTo(PLANET_RADII_KM.jupiter / PLANET_RADII_KM.earth, 10);
  });
});
