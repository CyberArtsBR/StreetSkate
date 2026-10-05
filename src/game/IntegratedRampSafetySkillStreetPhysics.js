import * as THREE from 'three';
import { RampWallSafetySkillStreetPhysics } from './RampWallSafetySkillStreetPhysics.js';
import { MOMENTUM_ROLL } from './MomentumRollSkillStreetPhysics.js';

function horizontalDirection(source, fallback = null) {
  const result = source?.clone?.() || new THREE.Vector3();
  result.y = 0;
  if (result.lengthSq() > 1e-6) return result.normalize();
  if (fallback?.lengthSq?.() > 1e-6) {
    result.copy(fallback);
    result.y = 0;
    if (result.lengthSq() > 1e-6) return result.normalize();
  }
  return result.set(0, 0, -1);
}

/** Final integration bridge: keep the ramp/wall fixes while preserving the
 * explicit regular/fakie travel state owned by MomentumRollSkillStreetPhysics. */
export class IntegratedRampSafetySkillStreetPhysics extends RampWallSafetySkillStreetPhysics {
  land(support) {
    const previousTravel = this.travelDirection?.clone?.() || null;
    const landed = super.land(support);
    if (!landed) return false;

    const signedSpeed = this.velocity.dot(this.forward);
    if (Math.abs(signedSpeed) > MOMENTUM_ROLL.signMemoryThreshold) {
      this.rollingSign = signedSpeed < 0 ? -1 : 1;
    }
    this.fakie = this.rollingSign < 0;
    this.travelDirection ||= new THREE.Vector3();
    this.travelDirection.copy(horizontalDirection(this.velocity, previousTravel));
    return true;
  }
}
