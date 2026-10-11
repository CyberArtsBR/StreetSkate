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

/**
 * A neutral A-pose with visible daylight between both arms and the ribcage.
 * Keep both wrists ~33 degrees outward from the vertical, near full extension
 * and with only a subtle INWARD elbow pole. This avoids both glued arms and
 * the reversed/hyperextended-looking elbows seen in the previous hotfix.
 *
 * World-space anatomical axes come from the loaded rig, never mesh sizing.
 */
export function neutralArmIKTargets(shoulder, outward, forward, armLength) {
  if (!shoulder?.isVector3 || !outward?.isVector3 ||
      !Number.isFinite(armLength) || armLength <= 0) return null;
  const lateral = outward.clone().setY(0);
  if (lateral.lengthSq() < 1e-8) return null;
  lateral.normalize();
  const face = forward?.isVector3 ? forward.clone().setY(0) : new THREE.Vector3();
  // Some custom rig sagittal axes are nearly parallel to their shoulder axis.
  // Do not let this cancel the inward elbow pole or bias left/right unequally.
  face.addScaledVector(lateral, -face.dot(lateral));
  if (face.lengthSq() > 1e-8) face.normalize();
  const spread = THREE.MathUtils.degToRad(33);
  const direction = lateral.clone().multiplyScalar(Math.sin(spread))
    .add(new THREE.Vector3(0, -Math.cos(spread), 0))
    .addScaledVector(face, 0.025).normalize();
  // An almost-straight reach and minimally offset pole avoid the cartoon elbow
  // bulge the user marked red. The A-pose spread comes from the SHOULDER,
  // not from bending the joint backward.
  const wrist = shoulder.clone().addScaledVector(direction, armLength * 0.997);
  const elbow = shoulder.clone().lerp(wrist, 0.5)
    .addScaledVector(lateral, -armLength * 0.012)
    .addScaledVector(face, armLength * 0.045);
  return { wrist, elbow };
}

/**
 * Keep procedural arm goals out of the torso and face. Ordinary movement is
 * bounded to the anatomical side of the shoulder; a named grab may cross the
 * midline to reach the deck but can never clip the face. The neutral A-pose is
 * handled separately and is not shortened by this guard.
 */
export function safeArmGoal(shoulder, requested, outward, head, armLength,
  { crossBody = false, neutral = false } = {}) {
  if (!shoulder?.isVector3 || !requested?.isVector3 ||
      !outward?.isVector3 || !Number.isFinite(armLength) || armLength <= 0)
    return requested?.clone?.() || null;
  const side = outward.clone().setY(0);
  if (side.lengthSq() < 1e-8) return requested.clone();
  side.normalize();
  const goal = requested.clone();
  const relative = goal.clone().sub(shoulder);
  // Keep normal movement hands beside the torso, not across the chest.
  const minimumOut = armLength * (neutral ? 0.42 : crossBody ? -0.03 : 0.24);
  const currentOut = relative.dot(side);
  if (currentOut < minimumOut) goal.addScaledVector(side, minimumOut - currentOut);
  // On ordinary rolling and airborne recovery poses, arms should remain
  // below the shoulder plane. Release this rule only for named cross-body
  // tricks, which are instead protected by the skull exclusion.
  if (!crossBody && !neutral && goal.y > shoulder.y - armLength * 0.05)
    goal.y = shoulder.y - armLength * 0.05;
  if (head?.isVector3) {
    const exclusion = Math.max(0.14, armLength * 0.53);
    const fromHead = goal.clone().sub(head);
    if (fromHead.lengthSq() < exclusion * exclusion) {
      // A stable sideways/downward escape is safer than normalizing an
      // almost-zero vector and accidentally pushing through the skull.
      const escape = side.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, -0.6, 0)).normalize();
      goal.copy(head).addScaledVector(escape, exclusion);
    }
  }
  // Protect the shoulder joint from unreachable hand goals, without resizing
  // its bone chain. The IK solver has its own minimum bend radius.
  const arm = goal.clone().sub(shoulder);
  const maximum = armLength * (neutral ? 0.997 : 0.985);
  if (arm.lengthSq() > maximum * maximum) goal.copy(shoulder).addScaledVector(arm.normalize(), maximum);
  return goal;
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
