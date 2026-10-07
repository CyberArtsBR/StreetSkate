import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
export const CAMERA_CLEARANCE = Object.freeze({ minimumDistance: 1.8, radius: 0.28 });

/** Search only when the normal chase arm would enter the rider's silhouette. */
export function resolveCameraClearance(surface, anchor, desired, previousEye = null, cache = null) {
  const probe = eye => surface?.camera
    ? surface.camera(anchor, eye, CAMERA_CLEARANCE.radius) : eye.clone();
  const direct = probe(desired);
  if (direct.distanceTo(anchor) >= CAMERA_CLEARANCE.minimumDistance) return direct;

  const arm = desired.clone().sub(anchor);
  if (cache?.arm) {
    const cached = probe(anchor.clone().add(cache.arm));
    if (cached.distanceTo(anchor) >= CAMERA_CLEARANCE.minimumDistance) return cached;
  }
  let best = direct, bestScore = -Infinity;
  const candidates = [];
  if (previousEye) candidates.push({ eye: previousEye.clone(), penalty: 0.1 });
  for (const rise of [0, 1.8, 3.8]) {
    for (const degrees of [0, 35, -35, 70, -70, 110, -110, 180]) {
      const eye = arm.clone().applyAxisAngle(UP, degrees * Math.PI / 180)
        .addScaledVector(UP, rise).add(anchor);
      candidates.push({ eye, penalty: Math.abs(degrees) / 180 + rise * 0.12 });
    }
  }
  for (const { eye, penalty } of candidates) {
    const resolved = probe(eye);
    const distance = resolved.distanceTo(anchor);
    const score = Math.min(distance, CAMERA_CLEARANCE.minimumDistance + 1.0) - penalty;
    if (distance >= CAMERA_CLEARANCE.minimumDistance && score > bestScore) {
      best = resolved; bestScore = score;
      // Once a comfortably clear view is found, do not scan every other side.
      if (distance >= CAMERA_CLEARANCE.minimumDistance + 0.5) break;
    }
  }
  // If fully enclosed, return the collision-safe point. The caller hides the
  // rider temporarily rather than rendering the camera inside the skinned mesh.
  if (cache && best.distanceTo(anchor) >= CAMERA_CLEARANCE.minimumDistance) {
    cache.arm = best.clone().sub(anchor);
  }
  return best;
}
