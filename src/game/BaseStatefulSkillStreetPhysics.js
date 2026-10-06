import { MOVEMENT_STATE } from './StreetPhysics.js';
import { UnifiedRampFeelSkillStreetPhysics } from './UnifiedRampFeelSkillStreetPhysics.js';

/**
 * Keeps the explicit movement-state contract synchronized with the skill layer.
 * Landing yaw telemetry is now applied by the top-level LandingPostPipeline, so
 * the former NoAutomaticYaw prototype level is no longer part of final runtime.
 */
export class StatefulSkillStreetPhysics extends UnifiedRampFeelSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.landingYawInvariantViolations = 0;
    this.lastLandingYawInvariant = null;
  }

  syncMovementState() {
    if (this.bailTime > 0) this.movementState = MOVEMENT_STATE.BAIL;
    else if (this.grind) this.movementState = MOVEMENT_STATE.GRIND;
    else if (this.wallRide) this.movementState = MOVEMENT_STATE.WALLRIDE;
    else if (this.grounded) this.movementState = this.manual ? MOVEMENT_STATE.MANUAL : MOVEMENT_STATE.GROUND;
    else if (this.transitionAir) this.movementState = MOVEMENT_STATE.VERT_AIR;
    else this.movementState = MOVEMENT_STATE.AIR;
    return this.movementState;
  }

  advance(delta, input = {}) {
    this.syncMovementState();
    super.advance(delta, input);
    this.syncMovementState();
  }

  step(dt, input) {
    this.syncMovementState();
    super.step(dt, input);
    this.syncMovementState();
  }
}
