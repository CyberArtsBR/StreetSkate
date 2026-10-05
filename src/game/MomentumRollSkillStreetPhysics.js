import * as THREE from 'three';
import { BowlLandingSkillStreetPhysics } from './BowlLandingSkillStreetPhysics.js';
import { PHYSICS } from './StreetPhysics.js';

export const MOMENTUM_ROLL = Object.freeze({
  // THPS-style park flow: reach useful park speed quickly without using forward
  // as a throttle. 12.5 m/s ~= 45 km/h and gives enough entry energy for small
  // and medium ramps even with the game's intentionally strong air gravity.
  autoPushTarget: 12.5,
  autoPushSurfaceY: 0.965,
  autoPushMinAccel: 3.6,
  autoPushMaxAccel: 10.8,
  rollingBase: 0.025,
  rollingQuadratic: 0.00115,
  signMemoryThreshold: 0.18,
  transitionSurfaceY: 0.992,
  uphillGravityScale: 0.38,
  downhillGravityScale: 1.0,
});

const clamp01 = value => Math.max(0, Math.min(1, value));

/** Skate wheels should coast; neutral input must preserve useful park speed. */
export function passiveRollingResistance(speed, config = MOMENTUM_ROLL) {
  const magnitude = Math.abs(Number(speed) || 0);
  return config.rollingBase + config.rollingQuadratic * magnitude * magnitude;
}

/**
 * Neutral auto-push is only a flat-ground speed source. It gets the skater to a
 * useful cruise quickly, then momentum/gravity/pumping own the line.
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
 * The simulation uses ~2g air gravity for responsive tricks. Applying that full
 * value tangentially while climbing a ramp drained park speed unrealistically.
 * Keep full downhill gravity, but soften only the uphill loss. This is an arcade
 * energy model, not free throttle: the rider still slows while climbing.
 */
export function transitionGravityScale({
  signedSpeed = 0,
  forwardY = 0,
  normalY = 1,
  config = MOMENTUM_ROLL,
} = {}) {
  if (Math.abs(normalY) >= config.transitionSurfaceY) return 1;
  const verticalTravel = signedSpeed * forwardY;
  if (verticalTravel > 0.05) return config.uphillGravityScale;
  if (verticalTravel < -0.05) return config.downhillGravityScale;
  return 1;
}

function horizontalDirection(source, fallback = null) {
  const result = source?.clone?.() || new THREE.Vector3();
  result.y = 0;
  if (result.lengthSq() > 1e-6) return result.normalize();
  if (fallback?.lengthSq?.() > 1e-6) {
    result.copy(fallback); result.y = 0;
    if (result.lengthSq() > 1e-6) return result.normalize();
  }
  return result.set(0, 0, -1);
}

/**
 * Momentum-first skating with explicit travel/fakie state.
 *
 * Crucial distinction:
 *   deck forward = where the nose points
 *   travelDirection = where the board is actually moving in world space
 *
 * A 180 changes their relationship but must not rotate travelDirection. Camera
 * and fakie steering can therefore remain stable even if contact resolution
 * reconstructs the velocity vector for a frame.
 */
export class MomentumRollSkillStreetPhysics extends BowlLandingSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rollingSign = 1;
    this.fakie = false;
    this.travelDirection ||= new THREE.Vector3();
    this.travelDirection.copy(horizontalDirection(this.forward));
    this.autoPushActive = false;
  }

  syncTravelDirection({ preserveIfSlow = true } = {}) {
    this.travelDirection ||= new THREE.Vector3(0, 0, -1);
    const horizontalVelocity = this.velocity.clone();
    horizontalVelocity.y = 0;
    if (horizontalVelocity.lengthSq() > MOMENTUM_ROLL.signMemoryThreshold ** 2) {
      this.travelDirection.copy(horizontalVelocity.normalize());
    } else if (!preserveIfSlow) {
      const deckTravel = this.forward.clone().multiplyScalar(this.rollingSign < 0 ? -1 : 1);
      this.travelDirection.copy(horizontalDirection(deckTravel, this.travelDirection));
    }
    this.fakie = this.rollingSign < 0;
    return this.travelDirection;
  }

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

  stepGround(dt, input = {}, drive = 0) {
    const threshold = MOMENTUM_ROLL.signMemoryThreshold;
    const measuredSigned = this.velocity.dot(this.forward);

    if (!Number.isFinite(this.rollingSign) || this.rollingSign === 0) {
      this.rollingSign = measuredSigned < -threshold ? -1 : 1;
    }

    // rollingSign is deliberately latched. A contact-normal rebuild must never
    // silently turn fakie back into regular. The next genuine air landing decides
    // the new sign from board-vs-travel alignment.
    const travelSign = this.rollingSign < 0 ? -1 : 1;
    let speed = Math.max(Math.abs(measuredSigned), this.velocity.length()) * travelSign;
    const braking = Boolean(input.brake || drive < -0.12);
    const magnitude = Math.abs(speed);

    // StableBoardContactSkillStreetPhysics still contains legacy rolling drag.
    // Pre-compensate only that passive component; explicit brake remains strong.
    if (magnitude > 1e-5) {
      const legacyRolling = 0.26 + 0.012 * magnitude * magnitude;
      const desiredRolling = passiveRollingResistance(magnitude);
      const excess = Math.max(0, legacyRolling - desiredRolling);
      speed += travelSign * excess * dt;
    }

    // Its ground step will also apply full projected gravity. Pre-compensate the
    // excess uphill part so ramps preserve enough energy for useful airs.
    const gravityDelta = -PHYSICS.gravity * this.forward.y * dt;
    const gravityScale = transitionGravityScale({
      signedSpeed: speed,
      forwardY: this.forward.y,
      normalY: this.normal.y,
    });
    speed += (gravityScale - 1) * gravityDelta;

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

    // Feed the lower contact solver a deterministic signed deck-relative speed.
    // This makes its existing steering rule explicitly invert while fakie.
    this.velocity.copy(this.forward).multiplyScalar(speed);

    // Up/forward remains available to trick parsing but is not propulsion.
    super.stepGround(dt, { ...input, brake: braking }, 0);

    const settledMagnitude = this.velocity.length();
    if (settledMagnitude > threshold) {
      // Contact resolution may alter direction, but not the latched regular/fakie
      // relationship. Rebuild with the same sign before publishing travel state.
      this.velocity.copy(this.forward).multiplyScalar(settledMagnitude * travelSign);
    }
    this.fakie = travelSign < 0;
    this.syncTravelDirection();
    if (!this.grounded) this.autoPushActive = false;
  }
}
