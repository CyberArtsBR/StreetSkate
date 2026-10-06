import { MOVEMENT_STATE } from '../StreetPhysics.js';

function headingFrom(direction, fallback = 0) {
  const x = direction?.x || 0;
  const z = direction?.z || 0;
  if (x * x + z * z < 1e-8) return Number(fallback) || 0;
  return Math.atan2(-x, -z);
}

/**
 * Apply one already-accepted LandingResult to the legacy runtime.
 *
 * This is deliberately separate from landing evaluation: contact geometry and
 * safety rules decide whether a landing is accepted; this executor owns the
 * common state mutation once that decision has been made. It is the first
 * composition-style replacement for duplicated `land()` bodies in the old
 * inheritance tower.
 */
export function applyAcceptedLanding(controller, support, landing, {
  partialGrace = 0.14,
  slopedGrace = 0.07,
} = {}) {
  if (!controller || !support || !landing?.accepted) return false;

  const {
    partialTouchdown,
    boardForward,
    planarVelocity,
    planarSpeed,
  } = landing;
  if (!boardForward || !planarVelocity || !Number.isFinite(planarSpeed)) return false;

  const halfTurns = Math.floor((Math.abs(Number(controller.airSpin) || 0) * 180 / Math.PI + 25) / 180);
  const spin = halfTurns * 180;

  controller.position.copy(support.position);
  controller.normal.copy(support.normal);
  controller.heading = headingFrom(boardForward, controller.heading);
  controller.groundDirection();

  if (spin >= 180) controller.recordTrick(`${spin}°`, spin);
  if (halfTurns % 2 === 1) controller.stance *= -1;

  controller.setMovementState(MOVEMENT_STATE.GROUND);
  controller.coyote = 0;
  controller.justLanded = true;
  controller.transitionAir = null;
  controller.wallRide = null;
  controller.lastWheelSupport = support;
  controller.transitionLandingGrace = partialTouchdown
    ? partialGrace
    : (Math.abs(support.normal.y) < 0.995 ? slopedGrace : 0);

  if (planarSpeed > 0.0001) controller.velocity.copy(planarVelocity);
  else controller.velocity.set(0, 0, 0);
  controller.flipState = null;
  controller.grabState = null;
  controller.airSpin = 0;
  controller.stableGroundTime = 0;
  return true;
}
