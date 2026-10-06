import { StableRampReturnSkillStreetPhysics } from './StableRampReturnSkillStreetPhysics.js';
import {
  LAUNCH_ENERGY,
  composeLaunchImpulse,
  rampLaunchBonus,
  updateRampLaunchMemory,
} from './core/LaunchEnergyModel.js';

// Compatibility exports while call sites migrate to LaunchEnergyModel directly.
export const UNIFIED_RAMP_FEEL = LAUNCH_ENERGY;
export const unifiedRampAirBoost = rampLaunchBonus;
export const updateRampBoostMemory = updateRampLaunchMemory;

/**
 * Final park-feel authority for ramp launches.
 *
 * Authored quarters, bowls, banks and generic lips all consume one remembered
 * climb-energy sample. Lower mobility layers are no longer allowed to add a
 * second hidden ramp bonus, so final impulse composition happens exactly once.
 */
export class UnifiedRampFeelSkillStreetPhysics extends StableRampReturnSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rampLaunchMemory = 0;
    this.rampLaunchMemoryTime = 0;
  }

  rememberRampClimb(dt = 0) {
    const sample = this.grounded
      ? rampLaunchBonus({
        speed: this.velocity?.length?.() || 0,
        normalY: this.normal?.y ?? 1,
        verticalSpeed: this.velocity?.y ?? 0,
      })
      : 0;
    const memory = updateRampLaunchMemory({
      previousBoost: this.rampLaunchMemory,
      previousTime: this.rampLaunchMemoryTime,
      sampleBoost: sample,
      dt,
    });
    this.rampLaunchMemory = memory.boost;
    this.rampLaunchMemoryTime = memory.time;
    return sample;
  }

  stepGround(dt, input = {}, drive = 0) {
    // Sample before lower layers move the final wheel over the lip and call takeoff.
    this.rememberRampClimb(dt);
    return super.stepGround(dt, input, drive);
  }

  takeoff(impulse = 0, transition = null) {
    const wasGrounded = Boolean(this.grounded);
    const currentBoost = wasGrounded
      ? rampLaunchBonus({
        speed: this.velocity?.length?.() || 0,
        normalY: this.normal?.y ?? 1,
        verticalSpeed: this.velocity?.y ?? 0,
      })
      : 0;
    const rememberedBoost = this.rampLaunchMemoryTime > 0 ? this.rampLaunchMemory : 0;
    const rampBonus = Math.max(currentBoost, rememberedBoost);
    const rampContext = Boolean(transition) || rampBonus > 0;

    const result = super.takeoff(composeLaunchImpulse({
      ollieImpulse: impulse,
      rampBonus,
    }), transition);

    // StableRampReturn uses this bit to apply identical no-auto-yaw/re-entry
    // semantics even when a generic lip became flat on the exact takeoff frame.
    if (rampContext) this.airTakeoffFromRamp = true;
    this.rampLaunchMemory = 0;
    this.rampLaunchMemoryTime = 0;
    return result;
  }
}
