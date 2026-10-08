import * as THREE from 'three';

const EPSILON = 1e-6;

function horizontalUnit(source, fallback = null) {
  const out = source?.clone?.() || new THREE.Vector3();
  out.y = 0;
  if (out.lengthSq() > EPSILON) return out.normalize();
  if (fallback?.lengthSq?.() > EPSILON) {
    out.copy(fallback).setY(0);
    if (out.lengthSq() > EPSILON) return out.normalize();
  }
  return null;
}

/**
 * Derive the world direction presentation should follow without mutating gameplay.
 * Priority intentionally matches the validated THPS camera behavior:
 * canonical travel state -> meaningful instantaneous velocity -> previous camera
 * side -> deck forward adjusted for fakie -> world -Z fallback.
 */
export function resolveCameraTravelDirection(player, previousDirection = null, initialized = true) {
  const persistent = horizontalUnit(player?.travelDirection);
  if (persistent) return persistent;

  const velocity = player?.velocity?.clone?.() || new THREE.Vector3();
  velocity.y = 0;
  if (velocity.lengthSq() > 0.16) return velocity.normalize();

  if (initialized) {
    const previous = horizontalUnit(previousDirection);
    if (previous) return previous;
  }

  const deckForward = horizontalUnit(player?.forward);
  if (deckForward) {
    if (player?.fakie) deckForward.negate();
    return deckForward;
  }
  return new THREE.Vector3(0, 0, -1);
}

/**
 * Read-only-by-copy presentation snapshot. Vectors are cloned so camera smoothing,
 * interpolation or debugging can never mutate the physics controller accidentally.
 */
export function captureCameraState(player, {
  previousDirection = null,
  initialized = true,
} = {}) {
  const position = player?.position?.clone?.() || new THREE.Vector3();
  const travelDirection = resolveCameraTravelDirection(
    player,
    previousDirection,
    initialized,
  );

  return Object.freeze({
    position,
    velocity: player?.velocity?.clone?.() || new THREE.Vector3(),
    surfaceNormal: player?.normal?.clone?.() || new THREE.Vector3(0, 1, 0),
    travelDirection,
    grounded: Boolean(player?.grounded),
    fakie: Boolean(player?.fakie),
    movementState: player?.movementState ?? null,
    transitionActive: Boolean(player?.transitionAir),
    transitionReturning: Boolean(player?.transitionAir && !player.transitionAir.transferring),
    returnDirection: horizontalUnit(player?.transitionAir?.frame?.rampInward),
    grindActive: Boolean(player?.grind),
    manualActive: Boolean(player?.manual),
    doingTrick: Boolean(player?.flipState || player?.grabState),
    bailing: Boolean(player?.bailTime > 0),
  });
}
