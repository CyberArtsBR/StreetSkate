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
  approachHeight: 1.25,
  minimumAssist: 0.12,
});

/**
 * Preserve ballistic Y and existing XZ motion. Bounded air-control correction
 * is weakest during ascent; descent near the original wall earns more assist.
 * No teleport, forced path, or unconditional velocity overwrite is performed.
 */
export function resolveVertReturnVelocity(air, position, velocity, dt) {
  const frame = air?.frame;
  const next = velocity.clone();
  if (!frame?.returnTarget || !frame.rampInward || !frame.copingTangent
    || !frame.lipPoint || !Number.isFinite(dt) || dt <= 0) {
    return { velocity: next, error: 0, guided: false };
  }

  const offset = position.clone().sub(frame.returnTarget).setY(0);
  const radialError = offset.dot(frame.rampInward);
  const lateralOffset = position.clone().sub(frame.lipPoint).setY(0)
    .dot(frame.copingTangent);
  if (!Number.isFinite(radialError) || !Number.isFinite(lateralOffset)
    || Math.abs(radialError) > VERT_RETURN.maxPlaneError) {
    return { velocity: next, error: Math.abs(radialError), guided: false };
  }

  const heightAboveLip = position.y - frame.lipPoint.y;
  const descending = velocity.y <= 0;
  const proximity = clamp((VERT_RETURN.approachHeight - heightAboveLip)
    / VERT_RETURN.approachHeight, 0, 1);
  const assist = descending
    ? Math.max(VERT_RETURN.minimumAssist, proximity)
    : VERT_RETURN.minimumAssist;

  const maxStep = VERT_RETURN.acceleration * assist * dt;
  const radial = velocity.dot(frame.rampInward);
  const targetRadial = clamp(-radialError * VERT_RETURN.radialGain
    - radial * 0.45 * assist, -VERT_RETURN.maxRadialSpeed,
  VERT_RETURN.maxRadialSpeed);
  const nextRadial = clamp(radial + clamp(targetRadial - radial, -maxStep, maxStep),
    -VERT_RETURN.maxRadialSpeed, VERT_RETURN.maxRadialSpeed);

  const lateral = velocity.dot(frame.copingTangent);
  let targetLateral = lateral;
  if (Math.abs(lateralOffset) > VERT_RETURN.lateralCorridor) {
    const excess = Math.abs(lateralOffset) - VERT_RETURN.lateralCorridor;
    targetLateral = -Math.sign(lateralOffset)
      * Math.min(VERT_RETURN.maxLateralSpeed, excess * 3);
  }
  const nextLateral = clamp(lateral
    + clamp(targetLateral - lateral, -maxStep, maxStep),
  -VERT_RETURN.maxLateralSpeed, VERT_RETURN.maxLateralSpeed);

  next.copy(frame.rampInward).multiplyScalar(nextRadial)
    .addScaledVector(frame.copingTangent, nextLateral);
  next.y = velocity.y;
  return { velocity: next, error: Math.abs(radialError), guided: true };
}
