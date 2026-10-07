import { signedGroundSpeed } from './GroundMotor.js';
import { advanceTransitionExitIntent } from '../transitions/TransitionIntent.js';

function decay(value, dt) {
  return Math.max(0, (Number(value) || 0) - Math.max(0, Number(dt) || 0));
}

/**
 * Canonical beginning-of-ground-step transaction.
 *
 * It owns only state that can be resolved before manual balance and steering:
 * short-lived timers, explicit transition-exit intent, and signed deck-relative
 * speed. It is intentionally pure and does not move the skater or mutate yaw.
 */
export function resolveGroundStepStart({
  dt = 0,
  input = {},
  velocity = null,
  forward = null,
  rollingSign = 1,
  normalY = 1,
  verticalSpeed = 0,
  rampReentrySteerLock = 0,
  wallSlideTime = 0,
  transitionLandingGrace = 0,
  wallImpactTime = 0,
  wallImpactCooldown = 0,
  rampExitIntentTime = 0,
} = {}) {
  const step = Math.max(0, Number(dt) || 0);
  const timers = Object.freeze({
    rampReentrySteerLock: decay(rampReentrySteerLock, step),
    wallSlideTime: decay(wallSlideTime, step),
    transitionLandingGrace: decay(transitionLandingGrace, step),
    wallImpactTime: decay(wallImpactTime, step),
    wallImpactCooldown: decay(wallImpactCooldown, step),
  });

  const transitionIntent = advanceTransitionExitIntent({
    remaining: rampExitIntentTime,
    dt: step,
    input,
    normalY,
    verticalSpeed,
  });

  const speedState = signedGroundSpeed({
    velocity,
    forward,
    rollingSign,
  });

  return Object.freeze({
    timers,
    transitionIntent,
    speedState: Object.freeze({ ...speedState }),
  });
}
