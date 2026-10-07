import * as THREE from 'three';

const EPSILON = 1e-8;
const clamp = THREE.MathUtils.clamp;

function horizontal(vector) {
  return vector.clone().setY(0);
}

function accelerateToward(current, target, maxDelta) {
  const correction = target.clone().sub(current);
  const length = correction.length();
  if (length <= maxDelta || length < EPSILON) return target.clone();
  return current.clone().addScaledVector(correction, maxDelta / length);
}

function genericOutwardSpeed({
  apexPassed,
  outwardDistance,
  targetDistance,
  initialSpeed,
  age,
  config,
}) {
  if (!apexPassed) return Math.max(config.exitLandingMaxSpeed,
    initialSpeed * Math.exp(-0.28 * Math.max(0, age)));
  const remaining = Math.max(0, targetDistance - outwardDistance);
  return clamp(remaining * 2.35,
    config.exitLandingMinSpeed, config.exitLandingMaxSpeed);
}

/**
 * One fixed-step, pure transfer-flight authority. It unifies the historical
 * RampWallSafety generic-transfer and DeckAware geometry-aware overrides without
 * mutating the source air/position/velocity objects.
 */
export function resolveTransferFlightStep({
  air,
  position,
  velocity,
  dt,
  config,
} = {}) {
  if (!air?.frame || !air?.exitControl || !position || !velocity || !config) {
    return Object.freeze({ active: false });
  }

  const age = Math.max(0, Number(air.age) || 0) + Math.max(0, Number(dt) || 0);
  const apexPassed = Boolean(air.apexPassed || velocity.y <= 0);
  const frame = air.frame;
  const control = air.exitControl;
  const current = horizontal(velocity);
  let next = current.clone();
  let returnError = Number(air.returnError) || 0;
  let branch = 'generic';

  if (control.geometryAware) {
    if (control.abortToReturn) {
      branch = 'abort-return';
      let desired;
      if (!apexPassed) {
        desired = frame.rampInward.clone().multiplyScalar(0.30)
          .addScaledVector(frame.copingTangent,
            (Number(air.lateralVelocity) || 0) * Math.exp(-1.8 * age) * 0.25);
      } else {
        desired = horizontal(frame.returnTarget.clone().sub(position)).multiplyScalar(4.4);
        if (desired.length() > 5.6) desired.setLength(5.6);
      }
      const delta = desired.clone().sub(current);
      const maxDelta = (apexPassed ? 24 : 10) * dt;
      if (delta.length() > maxDelta) delta.setLength(maxDelta);
      next = current.clone().add(delta);
      returnError = horizontal(frame.returnTarget.clone().sub(position)).length();
    } else {
      branch = 'deck-target';
      const target = control.targetPoint;
      const toTarget = horizontal(target.clone().sub(position));
      const distance = toTarget.length();
      const desired = new THREE.Vector3();
      if (distance > 1e-5) {
        const desiredSpeed = apexPassed
          ? clamp(distance * 3.0, 0.20, 2.25)
          : clamp(distance * 2.0, 0.55, control.horizontalSpeed);
        desired.copy(toTarget).multiplyScalar(desiredSpeed / distance);
      }
      const delta = desired.sub(current);
      const maxDelta = (apexPassed ? 36 : 24) * dt;
      if (delta.length() > maxDelta) delta.setLength(maxDelta);
      next = current.clone().add(delta);
      returnError = distance;
    }
  } else {
    const outwardDistance = horizontal(position.clone().sub(frame.lipPoint))
      .dot(frame.deckOutward);
    const outwardSpeed = genericOutwardSpeed({
      apexPassed,
      outwardDistance,
      targetDistance: control.targetDistance,
      initialSpeed: control.horizontalSpeed,
      age,
      config,
    });
    const lateral = frame.copingTangent.clone()
      .multiplyScalar((Number(air.lateralVelocity) || 0) * Math.exp(-2.4 * age) * 0.24);
    const desired = frame.deckOutward.clone().multiplyScalar(outwardSpeed).add(lateral);
    next = accelerateToward(current, desired, (apexPassed ? 28 : 18) * dt);
    returnError = Math.abs(control.targetDistance - outwardDistance);
  }

  const nextVelocity = velocity.clone();
  nextVelocity.x = next.x;
  nextVelocity.z = next.z;

  return Object.freeze({
    active: true,
    branch,
    age,
    apexPassed,
    velocity: nextVelocity,
    returnError,
  });
}
