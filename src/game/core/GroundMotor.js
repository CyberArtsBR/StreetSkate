const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

export const GROUND_MOTOR = Object.freeze({
  autoPushTarget: 12.5,
  autoPushSurfaceY: 0.965,
  autoPushMinAccel: 3.6,
  autoPushMaxAccel: 10.8,
  rollingBase: 0.025,
  rollingQuadratic: 0.00115,
  transitionSurfaceY: 0.992,
  uphillGravityScale: 0.38,
  downhillGravityScale: 1.0,
  steerRateLowSpeed: 2.7,
  steerRateHighSpeed: 1.2,
  steerFullSpeed: 12,
  brakeDriveThreshold: -0.12,
  absoluteSpeedCap: 17,
});

/** Signed speed follows the canonical deck-relative travel sign, not raw magnitude. */
export function signedGroundSpeed({
  velocity,
  forward,
  rollingSign = 1,
} = {}) {
  const measuredSigned = velocity?.dot?.(forward) || 0;
  const magnitude = Math.max(Math.abs(measuredSigned), velocity?.length?.() || 0);
  const travelSign = Number(rollingSign) < 0 ? -1 : 1;
  return {
    measuredSigned,
    magnitude,
    travelSign,
    speed: magnitude * travelSign,
  };
}

/** Player steering is the only ground-motor source of horizontal heading change. */
export function groundSteeringDelta({
  steer = 0,
  speed = 0,
  dt = 0,
  config = GROUND_MOTOR,
} = {}) {
  const rate = lerp(
    config.steerRateLowSpeed,
    config.steerRateHighSpeed,
    Math.abs(Number(speed) || 0) / config.steerFullSpeed,
  );
  return -(Number(steer) || 0) * rate * Math.max(0, Number(dt) || 0);
}

/** Skate wheels should coast; neutral input must preserve useful park speed. */
export function passiveRollingResistance(speed, config = GROUND_MOTOR) {
  const magnitude = Math.abs(Number(speed) || 0);
  return config.rollingBase + config.rollingQuadratic * magnitude * magnitude;
}

/** Neutral auto-push is only a flat-ground speed source. */
export function automaticPushAcceleration({
  speed = 0,
  normalY = 1,
  braking = false,
  manual = false,
  config = GROUND_MOTOR,
} = {}) {
  if (braking || manual || normalY < config.autoPushSurfaceY) return 0;
  const magnitude = Math.abs(Number(speed) || 0);
  if (magnitude >= config.autoPushTarget) return 0;
  const deficit = clamp((config.autoPushTarget - magnitude) / config.autoPushTarget, 0, 1);
  return config.autoPushMinAccel
    + (config.autoPushMaxAccel - config.autoPushMinAccel) * deficit;
}

/** Preserve downhill gravity while softening uphill transition energy loss. */
export function transitionGravityScale({
  signedSpeed = 0,
  forwardY = 0,
  normalY = 1,
  config = GROUND_MOTOR,
} = {}) {
  if (Math.abs(normalY) >= config.transitionSurfaceY) return 1;
  const verticalTravel = signedSpeed * forwardY;
  if (verticalTravel > 0.05) return config.uphillGravityScale;
  if (verticalTravel < -0.05) return config.downhillGravityScale;
  return 1;
}

/**
 * Pure propulsion/drag step. It never touches heading, position, contact state,
 * transition state, or the runtime object.
 */
export function resolveGroundPropulsion({
  speed = 0,
  forwardY = 0,
  normalY = 1,
  drive = 0,
  brake = false,
  manual = false,
  dt = 0,
  gravity = 20,
  brakeDecel = 13,
  config = GROUND_MOTOR,
} = {}) {
  const step = Math.max(0, Number(dt) || 0);
  const travelSign = Number(speed) < 0 ? -1 : 1;
  let nextSpeed = Number(speed) || 0;

  const gravityScale = transitionGravityScale({
    signedSpeed: nextSpeed,
    forwardY,
    normalY,
    config,
  });
  nextSpeed += (-gravity * forwardY) * gravityScale * step;

  const braking = Boolean(brake || drive < config.brakeDriveThreshold);
  const pushAccel = automaticPushAcceleration({
    speed: nextSpeed,
    normalY,
    braking,
    manual,
    config,
  });
  if (pushAccel > 0) {
    const nextMagnitude = Math.min(
      config.autoPushTarget,
      Math.abs(nextSpeed) + pushAccel * step,
    );
    nextSpeed = directionSign * nextMagnitude;
  }

  const resistance = passiveRollingResistance(nextSpeed, config)
    + (braking ? brakeDecel : 0);
  nextSpeed = Math.sign(nextSpeed)
    * Math.max(0, Math.abs(nextSpeed) - resistance * step);
  nextSpeed = clamp(nextSpeed, -config.absoluteSpeedCap, config.absoluteSpeedCap);

  return {
    nextSpeed,
    braking,
    autoPushActive: pushAccel > 0,
    pushAccel,
    resistance,
    gravityScale,
  };
}
