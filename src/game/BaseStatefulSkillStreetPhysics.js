import { MOVEMENT_STATE } from './StreetPhysics.js';
import { NoAutomaticYawSkillStreetPhysics } from './NoAutomaticYawSkillStreetPhysics.js';

/**
 * Keeps the explicit movement-state contract synchronized with the skill layer.
 * NoAutomaticYawSkillStreetPhysics is the final gameplay authority: ramps, walls,
 * rails and landing contacts may resolve support/velocity but can never rotate yaw
 * automatically. Player steering and explicit spin inputs are the only yaw sources.
 */
export class StatefulSkillStreetPhysics extends NoAutomaticYawSkillStreetPhysics {
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
