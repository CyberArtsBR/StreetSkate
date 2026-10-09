import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
export const CAMERA_CLEARANCE = Object.freeze({ minimumDistance: 1.8, radius: 0.28 });

/**
 * Collision-verified chase-eye selection. Every returned point is a surface
 * probe result: never extrapolate a shortened ray through an obstacle.
 * cache.minimumDistance can request extra character clearance (e.g. wallrides).
 */
export function resolveCameraClearance(surface, anchor, desired, previousEye = null, cache = null) {
  const minimum = Math.max(CAMERA_CLEARANCE.minimumDistance, Number(cache?.minimumDistance) || 0);
  const probe = eye => surface?.camera
    ? surface.camera(anchor, eye, CAMERA_CLEARANCE.radius) : eye.clone();
  const direct = probe(desired);
  if (direct.distanceTo(anchor) >= minimum) return direct;

  const arm = desired.clone().sub(anchor);
  if (arm.lengthSq() < 1e-8) arm.set(0, 2, minimum + 1);
  let bestBlocked = direct;
  let bestBlockedDistance = direct.distanceTo(anchor);
  let bestSafe = null;
  let bestPenalty = Infinity;
  const consider = (eye, penalty) => {
    const resolved = probe(eye);
    const distance = resolved.distanceTo(anchor);
    if (distance > bestBlockedDistance) {
      bestBlocked = resolved;
      bestBlockedDistance = distance;
    }
    if (distance < minimum) return;
    // Prefer the axis and a modest rise, not a 180-degree camera flip.
    // Penalize large clearance-induced zoom changes as well.
    const cost = penalty + Math.max(0, desired.distanceTo(resolved) - 1) * 0.015;
    if (cost < bestPenalty) {
      bestSafe = resolved;
      bestPenalty = cost;
    }
  };

  if (cache?.arm && !cache.fixedAxis) consider(anchor.clone().add(cache.arm), 0.25);
  if (previousEye && !cache?.fixedAxis) consider(previousEye.clone(), 0.35);

  const angles = cache?.fixedAxis ? [0] : [0, 35, -35, 70, -70, 110, -110, 180];
  for (const rise of [0, 1.8, 3.8, 5.8]) {
    for (const degrees of angles) {
      const eye = arm.clone().applyAxisAngle(UP, degrees * Math.PI / 180)
        .addScaledVector(UP, rise).add(anchor);
      consider(eye, Math.abs(degrees) / 90 + rise * 0.12);
    }
    // A good rear-axis view is preferable to orbiting around the rider.
    if (bestSafe && bestPenalty < 0.6) break;
  }
  // Fully enclosed: return the furthest verified clearance point, even when
  // less than minimum. There is no safe way to fabricate space in geometry.
  const result = bestSafe || bestBlocked;
  if (cache && result.distanceTo(anchor) >= minimum) cache.arm = result.clone().sub(anchor);
  return result;
}
