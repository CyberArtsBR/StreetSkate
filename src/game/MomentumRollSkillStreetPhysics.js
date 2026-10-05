import { BowlLandingSkillStreetPhysics } from './BowlLandingSkillStreetPhysics.js';

export const MOMENTUM_ROLL = Object.freeze({
  autoPushTarget: 6.0,
  autoPushSurfaceY: 0.965,
  autoPushMinAccel: 1.15,
  autoPushMaxAccel: 4.2,
  rollingBase: 0.055,
  rollingQuadratic: 0.0025,
  signMemoryThreshold: 0.12,
});

const clamp01 = value => Math.max(0, Math.min(1, value));

/**
 * Skate wheels should coast. This is deliberately much lower than the original
 * arcade ground drag; speed is meant to come from momentum, gravity and pumping.
 */
export function passiveRollingResistance(speed, config = MOMENTUM_ROLL) {
  const magnitude = Math.abs(Number(speed) || 0);
  return config.rollingBase + config.rollingQuadratic * magnitude * magnitude;
}

/**
 * Classic skate-game auto-push: no forward/throttle input is required.
 * It only restores a baseline cruise speed on nearly-flat ground. Ramps, bowls
 * and pools remain momentum/gravity/pump driven and never receive free propulsion.
 */
export function automaticPushAcceleration({
  speed = 0,
  normalY = 1,
  braking = false,
  manual = false,
  config = MOMENTUM_ROLL,
} = {}) {
  if (braking || manual || normalY < config.autoPushSurfaceY) return 0;
  const magnitude = Math.abs(speed);
  if (magnitude >= config.autoPushTarget) return 0;
  const deficit = clamp01((config.autoPushTarget - magnitude) / config.autoPushTarget);
  return config.autoPushMinAccel
    + (config.autoPushMaxAccel - config.autoPushMinAccel) * deficit;
}

/**
 * Locomotion layer modeled after momentum-first skate games:
 * - neutral input coasts;
 * - flat/slow riding auto-pushes to a baseline cruise speed;
 * - positive "forward" input is NOT a throttle;
 * - down/brake slows the board;
 * - transitions get no auto-push, so gravity/pumping own their energy;
 * - after a 180, signed travel is preserved while the deck rolls fakie/switch.
 */
export class MomentumRollSkillStreetPhysics extends BowlLandingSkillStreetPhysics {
  stepGround(dt, input = {}, drive = 0) {
    let speed = this.velocity.dot(this.forward);
    const threshold = MOMENTUM_ROLL.signMemoryThreshold;

    if (!Number.isFinite(this.rollingSign) || this.rollingSign === 0) this.rollingSign = speed < 0 ? -1 : 1;
    if (Math.abs(speed) > threshold) this.rollingSign = Math.sign(speed);
    const travelSign = Math.abs(speed) > threshold ? Math.sign(speed) : this.rollingSign;

    const braking = Boolean(input.brake || drive < -0.12);
    const magnitude = Math.abs(speed);

    // StableBoardContactSkillStreetPhysics still applies its legacy drag. Add
    // back only the excess here so the net result is low skateboard rolling drag.
    // Brake drag is not compensated, so explicit braking stays strong.
    if (magnitude > 1e-5) {
      const legacyRolling = 0.26 + 0.012 * magnitude * magnitude;
      const desiredRolling = passiveRollingResistance(magnitude);
      const excess = Math.max(0, legacyRolling - desiredRolling);
      speed += travelSign * excess * dt;
    }

    const pushAccel = automaticPushAcceleration({
      speed,
      normalY: this.normal.y,
      braking,
      manual: Boolean(this.manual),
    });
    this.autoPushActive = pushAccel > 0;

    if (pushAccel > 0) {
      const nextMagnitude = Math.min(
        MOMENTUM_ROLL.autoPushTarget,
        Math.abs(speed) + pushAccel * dt,
      );
      speed = travelSign * nextMagnitude;
    }

    this.velocity.copy(this.forward).multiplyScalar(speed);

    // Up/forward remains available to trick-direction parsing, but movement no
    // longer consumes it as throttle. Down is treated as brake for accessibility.
    super.stepGround(dt, { ...input, brake: braking }, 0);

    const settledSpeed = this.velocity.dot(this.forward);
    if (Math.abs(settledSpeed) > threshold) this.rollingSign = Math.sign(settledSpeed);
    if (!this.grounded) this.autoPushActive = false;
  }
}
