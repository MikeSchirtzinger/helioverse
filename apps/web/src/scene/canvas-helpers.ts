import * as THREE from 'three';
import type { CameraState, CmeEventData } from './types';

export interface CameraRigTarget {
  target: THREE.Vector3;
  azimuthDeg: number;
  polarDeg: number;
  distance: number;
}

export function shortEventId(eventId: string): string {
  return eventId.split('Z-')[1] ?? eventId;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function cameraRigFromState(state: CameraState, target: THREE.Vector3): CameraRigTarget {
  return {
    target,
    azimuthDeg: state.azimuth_deg,
    polarDeg: state.polar_deg,
    distance: state.distance,
  };
}

export function positionCamera(camera: THREE.PerspectiveCamera, rig: CameraRigTarget): void {
  const azimuth = THREE.MathUtils.degToRad(rig.azimuthDeg);
  const polar = THREE.MathUtils.degToRad(rig.polarDeg);
  const horizontal = Math.cos(polar) * rig.distance;

  camera.position.set(
    rig.target.x + horizontal * Math.cos(azimuth),
    rig.target.y + Math.sin(polar) * rig.distance,
    rig.target.z + horizontal * Math.sin(azimuth),
  );
  camera.lookAt(rig.target);
}

export function eventPulseSeed(event: CmeEventData | null): number {
  if (!event) return 19_977;
  return Array.from(event.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) + Math.round(event.speed_kms);
}

export function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const maybeMesh = child as THREE.Mesh | THREE.Points | THREE.Line;
    const geometry = maybeMesh.geometry as THREE.BufferGeometry | undefined;
    if (geometry) geometry.dispose();

    const material = maybeMesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  const textured = material as THREE.Material & Record<string, unknown>;
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
    const value = textured[key];
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}
