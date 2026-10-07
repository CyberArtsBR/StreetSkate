import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
export const VERT_RETURN = Object.freeze({
  radialGain: 6,
  maxRadialSpeed: 1.8,
  acceleration: 12,
  lateralDrag: 1.8,
  lateralCorridor: 0.75,
  maxLateralSpeed: 1.1,
  maxPlaneError: 1.4,
  contactCorridor: 1.35,
});

/** Local vertical flight plane, independent of deck yaw and trick animation. */
export function resolveVertReturnVelocity(air, position, velocity, dt) {
  const frame = air.frame;
  const next = velocity.clone();
  const offset = position.clone().sub(frame.returnTarget).setY(0);
  const radialError = offset.dot(frame.rampInward);
  const lateralOffset = position.clone().sub(frame.lipPoint).setY(0).dot(frame.copingTangent);
  // Once knocked away by a real collision, do not drag the rider through geometry.
  if (Math.abs(radialError) > VERT_RETURN.maxPlaneError) {
    return { velocity: next, error: Math.abs(radialError), guided: false };
  }
  const delta = VERT_RETURN.acceleration * Math.max(0, dt);
  const radial = velocity.dot(frame.rampInward);
  const targetRadial = clamp(-radialError * VERT_RETURN.radialGain,
    -VERT_RETURN.maxRadialSpeed, VERT_RETURN.maxRadialSpeed);
  const nextRadial = radial + clamp(targetRadial - radial, -delta, delta);
  const lateral = velocity.dot(frame.copingTangent);
  let targetLateral = clamp(lateral * Math.exp(-VERT_RETURN.lateralDrag * dt),
    -VERT_RETURN.maxLateralSpeed, VERT_RETURN.maxLateralSpeed);
  if (Math.abs(lateralOffset) > VERT_RETURN.lateralCorridor) {
    targetLateral = -Math.sign(lateralOffset) * Math.min(VERT_RETURN.maxLateralSpeed,
      (Math.abs(lateralOffset) - VERT_RETURN.lateralCorridor) * 3);
  }
  const nextLateral = lateral + clamp(targetLateral - lateral, -delta, delta);
  next.copy(frame.rampInward).multiplyScalar(nextRadial)
    .addScaledVector(frame.copingTangent, nextLateral);
  next.y = velocity.y;
  return { velocity: next, error: Math.abs(radialError), guided: true };
}
