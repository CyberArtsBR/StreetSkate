import * as THREE from 'three';

const C = THREE.MathUtils.clamp;

/** The knee/ankle target may be unreachable, but must never fold an IK chain
 * through itself. Returns a safe radial reach without changing any bone lengths. */
export function safeLimbReach(upperLength, lowerLength, desiredDistance, maximumFlex = 2.55) {
  const a = Number.isFinite(upperLength) ? Math.max(0, upperLength) : 0;
  const b = Number.isFinite(lowerLength) ? Math.max(0, lowerLength) : 0;
  if (a < 1e-5 || b < 1e-5) return 0;
  const minAngle = C(maximumFlex, 0.1, Math.PI - 0.01);
  const bent = Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(minAngle)));
  const epsilon = Math.min(0.001, a * 0.01, b * 0.01);
  const min = Math.max(Math.abs(a - b) + epsilon, bent);
  const max = Math.max(min, a + b - epsilon);
  return C(Number.isFinite(desiredDistance) ? desiredDistance : max, min, max);
}

/** A repeatable pole in the rider's anatomical frame. Never choose a fresh
 * perpendicular world axis from frame to frame at nearly straight knees. */
export function anatomicalKneeDirection(forward, outward, restPole, compression = 0) {
  const f = forward?.isVector3 && forward.lengthSq() > 1e-6
    ? forward.clone().normalize() : new THREE.Vector3(0, 0, 1);
  const o = outward?.isVector3 && outward.lengthSq() > 1e-6
    ? outward.clone().normalize() : new THREE.Vector3(1, 0, 0);
  // Orthogonalize to keep short, unusual custom rigs from creating inward poles.
  o.addScaledVector(f, -o.dot(f));
  if (o.lengthSq() < 1e-6) {
    const sideSign = outward?.isVector3 && outward.dot(f) < 0 ? -1 : 1;
    o.set(f.z, 0, -f.x).multiplyScalar(sideSign);
  }
  o.normalize();
  const bend = C(Number.isFinite(compression) ? compression : 0, 0, 1);
  const dir = f.multiplyScalar(0.23 + 0.11 * bend)
    .addScaledVector(o, 0.09 + 0.045 * bend);
  if (restPole?.isVector3 && restPole.lengthSq() > 1e-6) {
    const rest = restPole.clone().setY(0);
    if (rest.lengthSq() > 1e-5 && rest.dot(dir) > 0)
      dir.addScaledVector(rest.normalize(), 0.035);
  }
  dir.y = -0.13;
  return dir;
}

/** Prevent foot target swaps while BOTH feet are intentionally released. The
 * baseline is the GLB's authored stance, not a hardcoded left/right coordinate.
 * Never call this for deck-locked feet: the four-wheel board owns contact. */
export function preserveFootOrder(targets, anchors, influence = 1) {
  const left = targets?.l, right = targets?.r, refL = anchors?.l, refR = anchors?.r;
  if (![left, right, refL, refR].every(v => v?.isVector3)) return;
  const axis = refL.clone().sub(refR).setY(0);
  const baseline = axis.length();
  if (baseline < 0.08) return;
  axis.divideScalar(baseline);
  const weight = C(Number.isFinite(influence) ? influence : 0, 0, 1);
  if (weight <= 0) return;
  const minimum = Math.min(0.12, baseline * 0.32) * weight;
  const separation = left.clone().sub(right).dot(axis);
  if (separation >= minimum) return;
  const correction = Math.min(0.22, (minimum - separation) * 0.5);
  left.addScaledVector(axis, correction);
  right.addScaledVector(axis, -correction);
}

/** Smooth wrist destinations, not the solved ankles. This avoids grab target
 * snapping without sacrificing deterministic planted-foot IK. */
export function smoothHandDestination(previous, target, dt, responsiveness = 26) {
  if (!target?.isVector3) return previous?.clone?.() || null;
  if (!previous?.isVector3 || !Number.isFinite(dt) || dt <= 0 ||
      previous.distanceToSquared(target) > 1.0) return target.clone();
  const alpha = 1 - Math.exp(-Math.max(1, responsiveness) * C(dt, 0, 0.05));
  return previous.clone().lerp(target, alpha);
}
