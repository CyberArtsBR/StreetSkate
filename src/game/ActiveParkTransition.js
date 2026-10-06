import * as THREE from 'three';

export const ACTIVE_PARK_ASSET = '/assets/park/halfpipenew.glb';
export const LEGACY_PARK_ASSETS = Object.freeze([
  '/assets/park/insanity-inspired-park.glb',
  '/assets/park/park-collision.glb',
]);

/**
 * Temporary park transition for validation of the user's new extended park GLB.
 *
 * Keep the legacy files in the repository and leave the rest of the game loader
 * untouched. Both the visual park request and the dedicated legacy collision
 * request are redirected to the new full park, so the added halfpipe is visible
 * AND participates in ParkCollision during this test build.
 */
export function resolveActiveParkUrl(url = '') {
  const source = String(url || '');
  return LEGACY_PARK_ASSETS.some(path => source.endsWith(path))
    ? ACTIVE_PARK_ASSET
    : source;
}

export function activateParkTransition() {
  THREE.DefaultLoadingManager.setURLModifier(resolveActiveParkUrl);
  globalThis.__STREETSKATE_ACTIVE_PARK__ = ACTIVE_PARK_ASSET;
  return ACTIVE_PARK_ASSET;
}

activateParkTransition();
