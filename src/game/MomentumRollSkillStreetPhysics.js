import * as THREE from 'three';
import { BowlLandingSkillStreetPhysics } from './BowlLandingSkillStreetPhysics.js';
import { PHYSICS } from './StreetPhysics.js';

const UP = new THREE.Vector3(0, 1, 0);
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

  // Arcade wall recovery. The rider only reacts to a meaningful frontal hit,
  // then turns onto the wall tangent that preserves the most incoming momentum.
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

function headingFrom(direction, fallback = 0) {
  const x = direction.x, z = direction.z;
  if (x * x + z * z < 1e-8) return fallback;
  return Math.atan2(-x, -z);
}

/**
 * Pick one of the two directions parallel to a wall. The chosen tangent is the
 * one that keeps the largest component of the incoming world-space travel. A
 * perfectly head-on tie uses steering intent only as a tie breaker.
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
 */
export class MomentumRollSkillStreetPhysics extends BowlLandingSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rollingSign = 1;
    this.fakie = false;
    this.travelDirection ||= new THREE.Vector3();
    this.travelDirection.copy(horizontalDirection(this.forward));
    this.autoPushActive = false;
    this.wallImpactTime = 0;
    this.wallImpactDuration = MOMENTUM_ROLL.wallImpactDuration;
    this.wallImpactCooldown = 0;
    this.wallImpactSide = 0;
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

  detectGroundWallImpact(dt) {
    if (!this.grounded || this.grind || this.wallRide || this.bailTime > 0 || this.wallImpactCooldown > 0) return null;

    const horizontalVelocity = this.velocity.clone().setY(0);
    const speed = horizontalVelocity.length();
    if (speed < MOMENTUM_ROLL.wallImpactMinSpeed) return null;
    const direction = horizontalVelocity.multiplyScalar(1 / speed);

    // Probe from torso/board-center height. The distance is only the next fixed
    // step plus body clearance, so this behaves like impact recovery rather than
    // obstacle avoidance several metres in advance.
    const origin = this.position.clone().addScaledVector(UP, 0.58).addScaledVector(direction, 0.04);
    const reach = Math.max(0.24, speed * dt + MOMENTUM_ROLL.wallProbePadding);
    const ray = this.surface.ray;
    ray.set(origin, direction);
    ray.far = reach;

    for (const hit of ray.intersectObjects(this.surface.meshes, false)) {
      if (hit.object?.userData?.railId) continue;
      const normal = this.surface.normal(hit, new THREE.Vector3());
      if (Math.abs(normal.y) > 0.30) continue;
      if (normal.dot(direction) > 0) normal.negate();
      const approach = -normal.dot(direction);
      if (approach < MOMENTUM_ROLL.wallImpactMinApproach) continue;
      return { point: hit.point.clone(), normal, approach, speed };
    }
    return null;
  }

  applyWallRecovery(hit) {
    if (!hit) return false;
    const incomingTravel = horizontalDirection(this.velocity, this.travelDirection);
    const tangent = chooseWallRecoveryDirection(incomingTravel, hit.normal, this.steer);
    const speed = wallRecoverySpeed(hit.speed);
    const travelSign = this.rollingSign < 0 ? -1 : 1;
    const deckForward = tangent.clone().multiplyScalar(travelSign);

    this.heading = headingFrom(deckForward, this.heading);
    this.groundDirection();
    this.velocity.copy(this.forward).multiplyScalar(speed * travelSign);
    this.travelDirection.copy(horizontalDirection(this.velocity, tangent));
    this.fakie = travelSign < 0;

    const crossY = incomingTravel.x * tangent.z - incomingTravel.z * tangent.x;
    this.wallImpactSide = Math.sign(crossY) || 1;
    this.wallImpactTime = MOMENTUM_ROLL.wallImpactDuration;
    this.wallImpactDuration = MOMENTUM_ROLL.wallImpactDuration;
    this.wallImpactCooldown = MOMENTUM_ROLL.wallImpactCooldown;
    this.manual = null;
    this.flatland = null;
    return true;
  }

  stepGround(dt, input = {}, drive = 0) {
    this.wallImpactTime = Math.max(0, (this.wallImpactTime || 0) - dt);
    this.wallImpactCooldown = Math.max(0, (this.wallImpactCooldown || 0) - dt);

    const wallHit = this.detectGroundWallImpact(dt);
    if (wallHit) this.applyWallRecovery(wallHit);

    const threshold = MOMENTUM_ROLL.signMemoryThreshold;
    const measuredSigned = this.velocity.dot(this.forward);
    if (!Number.isFinite(this.rollingSign) || this.rollingSign === 0) {
      this.rollingSign = measuredSigned < -threshold ? -1 : 1;
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
    if (this.grounded) {
      this.fakie = this.rollingSign < 0;
      this.syncTravelDirection();
    }
    if (!this.grounded) this.autoPushActive = false;
  }
}
