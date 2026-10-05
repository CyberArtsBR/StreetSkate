import { MOVEMENT_STATE } from './StreetPhysics.js';
import { DeckAwareRampExitSkillStreetPhysics } from './DeckAwareRampExitSkillStreetPhysics.js';

/**
 * Keeps the explicit movement-state contract synchronized with the skill layer.
 * DeckAwareRampExitSkillStreetPhysics owns momentum-first locomotion, curved
 * transition touchdown handling, safe wall recovery, persistent regular/fakie
 * travel and geometry-aware coping-to-deck exits while this bridge derives one
 * authoritative gameplay state before and after each fixed step.
 */
export class StatefulSkillStreetPhysics extends DeckAwareRampExitSkillStreetPhysics {
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
