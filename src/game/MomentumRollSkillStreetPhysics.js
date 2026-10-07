import * as THREE from 'three';
import { BowlLandingSkillStreetPhysics } from './BowlLandingSkillStreetPhysics.js';
import { PHYSICS } from './StreetPhysics.js';
import { resolveTravelState } from './core/TravelState.js';

const clamp = THREE.MathUtils.clamp;

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

  // Contextual THPS-style ramp exit. Up remains non-propulsive on flat ground;
  // while climbing a transition it arms a short intent buffer that survives the
  // final wheel/contact frames before the lip.
  rampExitInputThreshold: 0.35,
  rampExitBuffer: 0.32,
  rampExitSlopeY: 0.992,
  rampExitMinRise: 0.06,
  rampLipBoost: 0.9,

  // Deprecated wall-response tuning retained only while collision migration and
  // old QA helpers are being removed. These values no longer authorize yaw.
  wallImpactMinSpeed: 3.2,
  wallImpactMinApproach: 0.48,
  wallRecoverySpeedScale: 0.72,
  wallRecoveryMinSpeed: 3.0,
  wallImpactDuration: 0.52,
  wallImpactCooldown: 0.46,
  wallProbePadding: 0.20,
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

/** Up is contextual ramp intent, never flat-ground throttle. */
export function shouldBufferRampExit({
  drive = 0,
  tappedUp = false,
  normalY = 1,
  verticalSpeed = 0,
  config = MOMENTUM_ROLL,
} = {}) {
  const up = tappedUp || drive > config.rampExitInputThreshold;
  return Boolean(up
    && Math.abs(normalY) < config.rampExitSlopeY
    && verticalSpeed > config.rampExitMinRise);
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
 * Deprecated geometry helper retained for migration tests only. It does NOT
 * authorize heading changes anywhere in gameplay.
 */
export function chooseWallRecoveryDirection(velocity, wallNormal, steer = 0) {
  const incoming = horizontalDirection(velocity);
  const normal = horizontalDirection(wallNormal, new THREE.Vector3(1, 0, 0));
  const a = new THREE.Vector3(normal.z, 0, -normal.x).normalize();
  const b = a.clone().negate();
  const scoreA = a.dot(incoming);
  const scoreB = b.dot(incoming);
  if (Math.abs(scoreA - scoreB) < 0.05 && Math.abs(steer) > 0.08) {
    return steer > 0 ? a : b;
  }
  return scoreA >= scoreB ? a : b;
}

/** Deprecated speed helper retained for migration tests only. */
export function wallRecoverySpeed(speed, config = MOMENTUM_ROLL) {
  const magnitude = Math.max(0, Number(speed) || 0);
  if (magnitude <= 0) return 0;
  return Math.min(magnitude, Math.max(config.wallRecoveryMinSpeed, magnitude * config.wallRecoverySpeedScale));
}

/**
 * Momentum-first skating with explicit travel/fakie state.
 *
 * Crucial distinction:
 *   deck forward = where the nose points
 *   travelDirection = where the board is actually moving in world space
 *
 * A 180 changes their relationship but must not rotate travelDirection. Camera
 * remains travel-oriented. Steering is ALSO travel/camera-oriented: pressing
 * left always curves left on screen, whether the deck is regular or fakie.
 *
 * Wall/contact geometry has zero yaw authority. The former automatic wall
 * recovery path has been deleted from stepGround; collision response may later
 * correct position/velocity through CollisionResolver, never heading.
 */
export class MomentumRollSkillStreetPhysics extends BowlLandingSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rollingSign = 1;
    this.fakie = false;
    this.travelDirection ||= new THREE.Vector3();
    this.travelDirection.copy(horizontalDirection(this.forward));
    this.autoPushActive = false;
    this.rampExitIntentTime = 0;
    this.wallImpactTime = 0;
    this.wallImpactDuration = MOMENTUM_ROLL.wallImpactDuration;
    this.wallImpactCooldown = 0;
    this.wallImpactSide = 0;
  }

  /**
   * Phase 1 migration: direction/sign/fakie are now resolved by one canonical
   * pure helper. Legacy fields remain populated so upper systems keep their
   * current API while duplicate travel math is removed incrementally.
   */
  syncTravelDirection({ preserveIfSlow = true } = {}) {
    this.travelDirection ||= new THREE.Vector3(0, 0, -1);
    const state = resolveTravelState({
      velocity: this.velocity,
      deckHeading: this.heading,
      previousDirection: this.travelDirection,
      previousSign: this.rollingSign,
      preserveDirectionIfSlow: preserveIfSlow,
      config: {
        signMemoryThreshold: MOMENTUM_ROLL.signMemoryThreshold,
        directionThreshold: MOMENTUM_ROLL.signMemoryThreshold,
      },
    });
    this.travelDirection.copy(state.travelDirection);
    this.rollingSign = state.rollingSign;
    this.fakie = state.fakie;
    return this.travelDirection;
  }

  /**
   * Preserve Up intent through the last contact frame. If this is an authored
   * coping transition, tag the edge so TransitionController launches outward on
   * frame one instead of first pulling inward and reversing later.
   */
  takeoff(impulse = 0, transition = null) {
    const exitRequested = (this.rampExitIntentTime || 0) > 0;
    let edge = transition;
    if (exitRequested) {
      edge ||= this.transitions.launchAt(this.position, this.normal, this.velocity);
      if (edge) edge = { ...edge, exitRequested: true };
    }
    const result = super.takeoff(impulse, edge);
    this.rampExitIntentTime = 0;
    return result;
  }

  land(support) {
    // In the final controller the ordered post-landing pipeline owns the immediate
    // travel/fakie sync. Direct subsystem instances keep the historical hook.
    if (this.deferLandingPostHooks) return super.land(support);

    const landed = super.land(support);
    if (!landed) return false;
    this.syncTravelDirection();
    return true;
  }

  /** Automatic wall-turn detection has no runtime authority. */
  detectGroundWallImpact() {
    return null;
  }

  /** Contact recovery may never rewrite deck heading. */
  applyWallRecovery() {
    return false;
  }

  stepGround(dt, input = {}, drive = 0) {
    this.wallImpactTime = Math.max(0, (this.wallImpactTime || 0) - dt);
    this.wallImpactCooldown = Math.max(0, (this.wallImpactCooldown || 0) - dt);
    this.rampExitIntentTime = Math.max(0, (this.rampExitIntentTime || 0) - dt);

    if (shouldBufferRampExit({
      drive,
      tappedUp: input.directionTaps?.includes?.('up'),
      normalY: this.normal.y,
      verticalSpeed: this.velocity.y,
    })) {
      this.rampExitIntentTime = MOMENTUM_ROLL.rampExitBuffer;
    }

    const measuredSigned = this.velocity.dot(this.forward);
    if (!Number.isFinite(this.rollingSign) || this.rollingSign === 0) {
      this.syncTravelDirection();
    }
    const travelSign = this.rollingSign < 0 ? -1 : 1;
    let speed = Math.max(Math.abs(measuredSigned), this.velocity.length()) * travelSign;

    if (this.manual) this.updateManualBalance(dt, input, speed);
    if (this.bailTime) return;

    // Camera-relative steering: the same stick direction produces the same world
    // travel curve in regular and fakie. Deck orientation may be reversed, but
    // controls are never mirrored merely because the rider landed a 180.
    const rate = THREE.MathUtils.lerp(2.7, 1.2, clamp(Math.abs(speed) / 12, 0, 1));
    this.heading -= this.steer * rate * dt;
    this.groundDirection();

    const gravityScale = transitionGravityScale({
      signedSpeed: speed,
      forwardY: this.forward.y,
      normalY: this.normal.y,
    });
    speed += (-PHYSICS.gravity * this.forward.y) * gravityScale * dt;

    const braking = Boolean(input.brake || drive < -0.12);
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

    const resistance = passiveRollingResistance(speed)
      + (braking ? PHYSICS.brake : 0);
    speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - resistance * dt);
    speed = clamp(speed, -17, 17);
    this.velocity.copy(this.forward).multiplyScalar(speed);

    this._boardMoveStart.copy(this.position);
    this.position.addScaledVector(this.velocity, dt);
    this.resolveSharpDeckClearance(
      this._boardMoveStart,
      this.position,
      this.velocity,
      this.heading,
      this.normal,
    );
    this.pendingBoardTransition = this.transitions.launchAt(this.position, this.normal, this.velocity);
  }

  resolveMotion(before, beforeUp, input = {}) {
    super.resolveMotion(before, beforeUp, input);
    if (this.grounded) this.syncTravelDirection();
    if (!this.grounded) this.autoPushActive = false;
  }
}
