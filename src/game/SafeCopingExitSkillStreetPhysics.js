import * as THREE from 'three';
import { DeckAwareRampExitSkillStreetPhysics } from './DeckAwareRampExitSkillStreetPhysics.js';
import { PRODUCTION_BOARD_CONTACT_RIG } from './SkateboardContactRig.js';

const clamp = THREE.MathUtils.clamp;

export const SAFE_COPING_EXIT = Object.freeze({
  // The board is ~1.05 m long. When landing perpendicular to coping, the full
  // board plus a little wheel/body safety margin must fit between coping and the
  // back edge/guard rail. A center point alone is not enough.
  boardLength: PRODUCTION_BOARD_CONTACT_RIG.deckLength,
  edgeSafety: 0.18,
  minSafeDeckWidth: PRODUCTION_BOARD_CONTACT_RIG.deckLength + 0.36,

  // If a transfer misses its verified deck, allow the original transition to
  // catch the board again. Never reject the ramp itself just because transfer
  // mode was active.
  recoveryOutwardMax: 0.34,
  recoveryInwardMax: 3.8,
  recoveryAboveLip: 0.36,
  recoveryBelowLip: 4.2,
  recoveryNormalMinY: 0.035,
  recoveryNormalMaxY: 0.975,
  recoveryNormalAlignment: 0.20,
  recoverySnapRise: 0.42,
  recoverySnapDrop: 0.62,
});

function horizontal(vector) {
  return vector.clone().setY(0);
}

export function deckCanFitBoard(control, config = SAFE_COPING_EXIT) {
  if (!control?.found || !Number.isFinite(control.usableWidth)) return false;
  const required = Math.max(config.minSafeDeckWidth,
    config.boardLength + config.edgeSafety * 2);
  return control.usableWidth + 1e-6 >= required;
}

export function supportMatchesOriginalTransition(support, air,
  config = SAFE_COPING_EXIT) {
  if (!support?.position || !support?.normal || !air?.frame?.lipPoint
    || !air?.frame?.deckOutward || !air?.frame?.rampInward) return false;

  const ny = Math.abs(support.normal.y);
  if (ny < config.recoveryNormalMinY || ny > config.recoveryNormalMaxY) return false;

  const outward = horizontal(air.frame.deckOutward);
  const inward = horizontal(air.frame.rampInward);
  if (outward.lengthSq() < 1e-8 || inward.lengthSq() < 1e-8) return false;
  outward.normalize();
  inward.normalize();

  const fromLip = support.position.clone().sub(air.frame.lipPoint);
  const signedOutward = horizontal(fromLip).dot(outward);
  if (signedOutward > config.recoveryOutwardMax
    || signedOutward < -config.recoveryInwardMax) return false;

  const dy = support.position.y - air.frame.lipPoint.y;
  if (dy > config.recoveryAboveLip || dy < -config.recoveryBelowLip) return false;

  const horizontalNormal = horizontal(support.normal);
  if (horizontalNormal.lengthSq() < 1e-8) return false;
  horizontalNormal.normalize();
  if (horizontalNormal.dot(inward) < config.recoveryNormalAlignment) return false;

  return true;
}

/**
 * Final coping safety layer based on the latest gameplay capture:
 *  - a narrow platform behind coping is not a valid straight-out landing unless
 *    the real 1.05 m skateboard actually fits;
 *  - failed/missed deck transfers may reconnect to the original quarter/bowl;
 *  - a one-frame landing miss cannot send the rider through the ramp mesh.
 */
export class SafeCopingExitSkillStreetPhysics extends DeckAwareRampExitSkillStreetPhysics {
  takeoff(impulse = 0, transition = null) {
    super.takeoff(impulse, transition);
    const air = this.transitionAir;
    const control = air?.exitControl;
    if (!air?.transferring || !air.frame || !control?.geometryAware
      || control.abortToReturn) return;

    if (deckCanFitBoard(control)) return;

    // The scan may find a narrow strip, but a board pointing out of the ramp
    // cannot physically fit there. Convert the requested Up exit to a safe same-
    // transition air instead of landing on the strip and falling through/behind it.
    air.exitControl = {
      ...control,
      geometryAware: true,
      abortToReturn: true,
      unsafeDeckWidth: control.usableWidth,
      targetPoint: air.frame.returnTarget.clone(),
    };
    air.mode = 'return';

    const retainedVertical = clamp(Math.max(this.velocity.y, 3.2), 3.2, 7.2);
    const lateral = air.frame.copingTangent.clone()
      .multiplyScalar((air.lateralVelocity || 0) * 0.28);
    const inward = air.frame.rampInward.clone().multiplyScalar(0.36).add(lateral);
    this.velocity.x = inward.x;
    this.velocity.z = inward.z;
    this.velocity.y = retainedVertical;
  }

  land(support) {
    const air = this.transitionAir;
    const control = air?.exitControl;

    // Deck-aware transfer normally rejects everything outside its target corridor.
    // That is correct for lower/outer geometry, but not for the ORIGINAL ramp.
    // If the board comes back onto that transition, let the validated transition
    // landing rules handle it instead of allowing the rider to pass through.
    if (control?.geometryAware && !control.abortToReturn
      && supportMatchesOriginalTransition(support, air)) {
      const wasGeometryAware = control.geometryAware;
      control.geometryAware = false;
      const landed = super.land(support);
      if (!landed && this.transitionAir === air) control.geometryAware = wasGeometryAware;
      return landed;
    }

    return super.land(support);
  }

  stepAir(dt, input, drive, before) {
    const activeAir = this.transitionAir;
    super.stepAir(dt, input, drive, before);

    if (!activeAir || this.grounded || this.transitionAir !== activeAir) return;
    if (this.velocity.y > 0) return;
    if (!activeAir.exitControl?.geometryAware) return;

    // The swept landing normally catches transition re-entry. This local probe is
    // only a seam/high-speed fallback after apex and is accepted only when the
    // support matches the original transition frame.
    const support = this.ensureBoardContact().snapToGround(
      this.position,
      this.heading,
      SAFE_COPING_EXIT.recoverySnapRise,
      SAFE_COPING_EXIT.recoverySnapDrop,
    );
    if (!support?.supported || !supportMatchesOriginalTransition(support, activeAir)) return;

    const control = activeAir.exitControl;
    const wasGeometryAware = control.geometryAware;
    control.geometryAware = false;
    const landed = super.land(support);
    if (!landed && this.transitionAir === activeAir) control.geometryAware = wasGeometryAware;
  }
}
