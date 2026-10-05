import * as THREE from 'three';
import { StableRampReturnSkillStreetPhysics } from './StableRampReturnSkillStreetPhysics.js';
import {
  ARCADE_PARK_MOBILITY,
  arcadeRampAirBoost,
} from './ArcadeParkMobilitySkillStreetPhysics.js';

const clamp = THREE.MathUtils.clamp;

export const UNIFIED_RAMP_FEEL = Object.freeze({
  // Keep the strongest valid climb sample alive across the final wheel/lip frames.
  // Generic banks, kickers and authored coping therefore use the same launch rule.
  memoryTime: 0.30,
  slopeThresholdY: 0.996,
  minVerticalSpeed: 0.045,
  minSpeed: 2.2,
  boostMin: 3.15,
  boostMax: 6.55,
  boostFullSpeed: 13.0,
});

/**
 * Larger THPS-style ramp energy conversion. This deliberately samples the ramp
 * while the board is still supported instead of trusting the final lip frame,
 * where a mesh may already report a flat normal or almost-zero vertical tangent.
 */
export function unifiedRampAirBoost({
  speed = 0,
  normalY = 1,
  verticalSpeed = 0,
  config = UNIFIED_RAMP_FEEL,
} = {}) {
  const ny = Math.abs(Number(normalY) || 0);
  const magnitude = Math.abs(Number(speed) || 0);
  const rise = Number(verticalSpeed) || 0;
  if (ny >= config.slopeThresholdY
    || rise <= config.minVerticalSpeed
    || magnitude < config.minSpeed) return 0;

  const slope = clamp((config.slopeThresholdY - ny) / 0.76, 0, 1);
  const energy = clamp((magnitude - config.minSpeed)
    / Math.max(0.1, config.boostFullSpeed - config.minSpeed), 0, 1);
  const riseQuality = clamp(rise / 5.5, 0, 1);
  const quality = clamp(0.34 + slope * 0.38 + energy * 0.34 + riseQuality * 0.18, 0, 1);
  return THREE.MathUtils.lerp(config.boostMin, config.boostMax, quality);
}

export function updateRampBoostMemory({
  previousBoost = 0,
  previousTime = 0,
  sampleBoost = 0,
  dt = 0,
  config = UNIFIED_RAMP_FEEL,
} = {}) {
  const sample = Math.max(0, Number(sampleBoost) || 0);
  if (sample > 0) {
    return {
      boost: Math.max(sample, Math.max(0, Number(previousBoost) || 0)),
      time: config.memoryTime,
    };
  }
  const time = Math.max(0, (Number(previousTime) || 0) - Math.max(0, Number(dt) || 0));
  return { boost: time > 0 ? Math.max(0, Number(previousBoost) || 0) : 0, time };
}

/**
 * Final park-feel authority for ramp launches.
 *
 * Why this layer exists:
 * - authored quarters can take off through TransitionGuide;
 * - generic kickers/banks can simply lose wheel support;
 * - some lips report a flat normal on their final contact frame.
 *
 * All three now consume the same remembered climb energy, so one ramp cannot
 * mysteriously jump high while an adjacent mesh gives almost no air.
 */
export class UnifiedRampFeelSkillStreetPhysics extends StableRampReturnSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rampLaunchMemory = 0;
    this.rampLaunchMemoryTime = 0;
  }

  rememberRampClimb(dt = 0) {
    const sample = this.grounded
      ? unifiedRampAirBoost({
        speed: this.velocity?.length?.() || 0,
        normalY: this.normal?.y ?? 1,
        verticalSpeed: this.velocity?.y ?? 0,
      })
      : 0;
    const memory = updateRampBoostMemory({
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
      ? unifiedRampAirBoost({
        speed: this.velocity?.length?.() || 0,
        normalY: this.normal?.y ?? 1,
        verticalSpeed: this.velocity?.y ?? 0,
      })
      : 0;
    const rememberedBoost = this.rampLaunchMemoryTime > 0 ? this.rampLaunchMemory : 0;
    const desiredBoost = Math.max(currentBoost, rememberedBoost);

    // ArcadeParkMobility underneath still contributes its legacy ramp boost.
    // Add only the missing amount so the final launch receives exactly the new
    // stronger target instead of accidentally double-boosting the same ramp.
    const legacyBoost = wasGrounded
      ? arcadeRampAirBoost({
        speed: this.velocity?.length?.() || 0,
        normalY: this.normal?.y ?? 1,
        verticalSpeed: this.velocity?.y ?? 0,
      })
      : 0;
    const legacyShare = (Math.max(0, impulse) > 0.1 || desiredBoost > 0.1)
      ? ARCADE_PARK_MOBILITY.rampOllieShare
      : 1;
    const missingBoost = Math.max(0, desiredBoost - legacyBoost * legacyShare);
    const rampContext = Boolean(transition) || desiredBoost > 0;

    const result = super.takeoff(Math.max(0, impulse) + missingBoost, transition);

    // StableRampReturn uses this bit to apply identical no-auto-yaw/re-entry
    // semantics even when a generic lip became flat on the exact takeoff frame.
    if (rampContext) this.airTakeoffFromRamp = true;
    this.rampLaunchMemory = 0;
    this.rampLaunchMemoryTime = 0;
    return result;
  }
}
