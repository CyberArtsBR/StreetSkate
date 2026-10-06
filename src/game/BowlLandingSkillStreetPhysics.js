import { StableBoardContactSkillStreetPhysics } from './StableBoardContactSkillStreetPhysics.js';
import { MOVEMENT_STATE, PHYSICS } from './StreetPhysics.js';
import {
  evaluateTransitionLanding,
  transitionAlignmentThreshold,
  transitionFlipLandingMode,
  transitionLandingSupportMode,
} from './core/LandingResult.js';

export {
  transitionAlignmentThreshold,
  transitionFlipLandingMode,
  transitionLandingSupportMode,
} from './core/LandingResult.js';

function headingFrom(direction, fallback = 0) {
  const x = direction.x, z = direction.z;
  if (x * x + z * z < 1e-8) return fallback;
  return Math.atan2(-x, -z);
}

/**
 * Bowl/pool/ramp landing bridge.
 * Triangulated transitions often touch one wheel, then one truck, then all four.
 * Lock the first real swept wheel contact long enough for the contact rig to grow
 * support instead of rejecting it and letting the board cross the rideable mesh.
 */
export class BowlLandingSkillStreetPhysics extends StableBoardContactSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.transitionLandingGrace = 0;
  }

  takeoff(impulse = 0, transition = null) {
    this.transitionLandingGrace = 0;
    return super.takeoff(impulse, transition);
  }

  stepGround(dt, input, drive) {
    this.transitionLandingGrace = Math.max(0, (this.transitionLandingGrace || 0) - dt);
    super.stepGround(dt, input, drive);
  }

  land(support) {
    const landing = evaluateTransitionLanding({
      support,
      position: this.position,
      velocity: this.velocity,
      forward: this.forward,
      airTime: this.airTime,
      flipProgress: this.flipState?.progress ?? null,
      maxLandingCorrection: PHYSICS.maxLandingCorrection,
    });

    // Preserve legacy side-effect order: an eligible auto-catch completes the
    // flip before a separate alignment failure can still request a bail.
    if (landing.flipMode === 'autoCatch' && this.flipState) this.flipState.progress = 1;

    if (!landing.accepted) {
      if (landing.shouldBail) this.bail('BAIL · align your board before landing');
      return false;
    }

    const {
      supportMode,
      partialTouchdown,
      boardForward,
      planarVelocity: planar,
      planarSpeed,
    } = landing;

    const halfTurns = Math.floor((Math.abs(this.airSpin) * 180 / Math.PI + 25) / 180);
    const spin = halfTurns * 180;

    this.position.copy(support.position);
    this.normal.copy(support.normal);
    this.heading = headingFrom(boardForward, this.heading);
    this.groundDirection();

    if (spin >= 180) this.recordTrick(`${spin}°`, spin);
    // Every odd 180 reverses which end of the deck leads relative to travel.
    if (halfTurns % 2 === 1) this.stance *= -1;

    this.setMovementState(MOVEMENT_STATE.GROUND);
    this.coyote = 0;
    this.justLanded = true;
    this.transitionAir = null;
    this.wallRide = null;
    this.lastWheelSupport = support;
    this.transitionLandingGrace = partialTouchdown ? 0.14 : (Math.abs(support.normal.y) < 0.995 ? 0.07 : 0);

    if (planarSpeed > 0.0001) this.velocity.copy(planar);
    else this.velocity.set(0, 0, 0);
    this.flipState = null;
    this.grabState = null;
    this.airSpin = 0;
    this.stableGroundTime = 0;
    return true;
  }
}
