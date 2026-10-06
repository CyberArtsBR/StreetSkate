import { RampWallSafetySkillStreetPhysics } from './RampWallSafetySkillStreetPhysics.js';

/**
 * Phase 1 compatibility bridge.
 *
 * Travel/fakie/rolling-sign ownership has moved down to the canonical TravelState
 * path in MomentumRollSkillStreetPhysics. This layer intentionally has no land()
 * override anymore, removing one duplicate post-landing state writer while the
 * remaining ramp safety behavior stays in the inherited RampWallSafety layer.
 */
export class IntegratedRampSafetySkillStreetPhysics extends RampWallSafetySkillStreetPhysics {}
