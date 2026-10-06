import * as THREE from 'three';
import { MomentumRollSkillStreetPhysics, MOMENTUM_ROLL } from './MomentumRollSkillStreetPhysics.js';
import { applyAcceptedLanding } from './core/LandingExecutor.js';
import {
  evaluateTransitionLanding,
  transitionLandingSupportMode,
} from './core/LandingResult.js';
import { MOVEMENT_STATE, PHYSICS } from './StreetPhysics.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

export const RAMP_WALL_SAFETY = Object.freeze({
  // A grounded wall recovery is a FLAT-ground collision response. If the board
  // is already climbing a transition, the near-vertical ramp ahead must never
  // be interpreted as a wall and rotate the skater 90 degrees.
  wallGroundMinY: 0.94,
  wallMaxVerticalSpeed: 0.9,
  wallFaceMaxY: 0.04,
  transitionFaceMinY: 0.035,
  transitionFaceMaxY: 0.62,
  wallProbeLow: 0.26,
  wallProbeHigh: 0.46,
  wallProbePadding: 0.24,

  // THPS-style Up exit should clear the coping and land on the deck, not become
  // a horizontal cannon. The old implementation could sustain 12.8 m/s outward
  // for the whole air and launch the rider beyond the park boundary.
  exitHorizontalMin: 2.8,
  exitHorizontalMax: 6.4,
  exitVerticalMin: 2.8,
  exitVerticalMax: 7.2,
  exitDistanceMin: 1.15,
  exitDistanceMax: 2.55,
  exitLandingMinSpeed: 0.7,
  exitLandingMaxSpeed: 3.2,
});

function horizontal(vector) {
  return vector.clone().setY(0);
}

function accelerateToward(current, target, maxDelta) {
  const correction = target.clone().sub(current);
  const length = correction.length();
  if (length <= maxDelta || length < 1e-8) return target.clone();
  return current.clone().addScaledVector(correction, maxDelta / length);
}

export function wallRecoveryContextAllows({
  groundNormalY = 1,
  verticalSpeed = 0,
  hitNormalY = 0,
  config = RAMP_WALL_SAFETY,
} = {}) {
  return Math.abs(groundNormalY) >= config.wallGroundMinY
    && Math.abs(verticalSpeed) <= config.wallMaxVerticalSpeed
    && Math.abs(hitNormalY) <= config.wallFaceMaxY;
}

/**
 * Convert incoming transition energy into a short, controlled deck transfer.
 * Horizontal distance is intentionally bounded; speed still matters, but it no
 * longer decides whether a bowl beside the park edge throws the player to void.
 */
export function controlledTransferProfile(incomingSpeed = 0, launchVertical = 0,
  config = RAMP_WALL_SAFETY) {
  const speed = Math.max(0, Number(incomingSpeed) || 0);
  const horizontalSpeed = clamp(speed * 0.30 + 0.8,
    config.exitHorizontalMin, config.exitHorizontalMax);
  const verticalSpeed = clamp((Number(launchVertical) || 0) * 0.62,
    config.exitVerticalMin, config.exitVerticalMax);
  const targetDistance = clamp(speed * 0.10 + 0.55,
    config.exitDistanceMin, config.exitDistanceMax);
  return { horizontalSpeed, verticalSpeed, targetDistance };
}

export function controlledTransferOutwardSpeed({
  apexPassed = false,
  outwardDistance = 0,
  targetDistance = 1.5,
  initialSpeed = 4,
  age = 0,
  config = RAMP_WALL_SAFETY,
} = {}) {
  if (!apexPassed) return Math.max(config.exitLandingMaxSpeed,
    initialSpeed * Math.exp(-0.28 * Math.max(0, age)));
  const remaining = Math.max(0, targetDistance - outwardDistance);
  return clamp(remaining * 2.35,
    config.exitLandingMinSpeed, config.exitLandingMaxSpeed);
}

export function isControlledDeckExitTouchdown(support, transitionAir) {
  if (!transitionAir?.transferring) return false;
  const count = support?.count || 0;
  if (count < 1) return false;
  return Math.abs(support?.normal?.y ?? 0) >= 0.985;
}

/**
 * Video-regression safety layer:
 *  - steep ramps cannot trigger the 90-degree wall-recovery turn;
 *  - genuine near-vertical walls still can;
 *  - Up/coping transfers are range-bounded and decelerate over the deck;
 *  - the first partial wheel contact on a flat deck can bridge into a full landing.
 */
export class RampWallSafetySkillStreetPhysics extends MomentumRollSkillStreetPhysics {
  detectGroundWallImpact(dt) {
    if (!this.grounded || this.grind || this.wallRide || this.bailTime > 0 || this.wallImpactCooldown > 0) return null;

    // The strongest discriminator from the captured regression: while climbing a
    // transition the rider already has a tilted support normal and meaningful Y
    // velocity. Wall recovery must not even probe in that state.
    if (!wallRecoveryContextAllows({
      groundNormalY: this.normal.y,
      verticalSpeed: this.velocity.y,
      hitNormalY: 0,
    })) return null;

    const horizontalVelocity = horizontal(this.velocity);
    const speed = horizontalVelocity.length();
    if (speed < MOMENTUM_ROLL.wallImpactMinSpeed) return null;
    const direction = horizontalVelocity.multiplyScalar(1 / speed);
    const reach = Math.max(0.24, speed * dt + RAMP_WALL_SAFETY.wallProbePadding);
    const ray = this.surface.ray;

    // Probe low first. A ramp intersects this ray on its rideable slope before a
    // higher ray reaches its nearly vertical lip. If that happens, abort wall
    // recovery for this frame instead of continuing upward and finding a fake wall.
    for (const height of [RAMP_WALL_SAFETY.wallProbeLow, RAMP_WALL_SAFETY.wallProbeHigh]) {
      const origin = this.position.clone().addScaledVector(UP, height).addScaledVector(direction, 0.04);
      ray.set(origin, direction);
      ray.far = reach;
      for (const hit of ray.intersectObjects(this.surface.meshes, false)) {
        if (hit.object?.userData?.railId) continue;
        const normal = this.surface.normal(hit, new THREE.Vector3());
        if (normal.dot(direction) > 0) normal.negate();

        const ny = Math.abs(normal.y);
        const solid = hit.object?.userData?.surface === 'solid';
        if (!solid && ny > RAMP_WALL_SAFETY.transitionFaceMinY
          && ny < RAMP_WALL_SAFETY.transitionFaceMaxY) return null;
        if (!wallRecoveryContextAllows({
          groundNormalY: this.normal.y,
          verticalSpeed: this.velocity.y,
          hitNormalY: normal.y,
        })) continue;

        const approach = -normal.dot(direction);
        if (approach < MOMENTUM_ROLL.wallImpactMinApproach) continue;
        return { point: hit.point.clone(), normal, approach, speed };
      }
    }
    return null;
  }

  takeoff(impulse = 0, transition = null) {
    super.takeoff(impulse, transition);
    const air = this.transitionAir;
    if (!air?.transferring || !air.frame) return;

    const profile = controlledTransferProfile(air.frame.incomingSpeed, air.launchVertical);
    air.exitControl = profile;
    air.launchVertical = profile.verticalSpeed;

    const retainedLateral = air.frame.copingTangent.clone()
      .multiplyScalar((air.lateralVelocity || 0) * 0.32);
    const launchHorizontal = air.frame.deckOutward.clone()
      .multiplyScalar(profile.horizontalSpeed)
      .add(retainedLateral);
    air.launchHorizontal = launchHorizontal.clone();
    this.velocity.copy(launchHorizontal);
    this.velocity.y = profile.verticalSpeed;
  }

  advanceControlledTransfer(air, dt) {
    air.age += dt;
    if (this.velocity.y <= 0) air.apexPassed = true;

    const frame = air.frame;
    const profile = air.exitControl;
    const currentHorizontal = horizontal(this.velocity);
    const outwardDistance = horizontal(this.position.clone().sub(frame.lipPoint))
      .dot(frame.deckOutward);
    const outwardSpeed = controlledTransferOutwardSpeed({
      apexPassed: air.apexPassed,
      outwardDistance,
      targetDistance: profile.targetDistance,
      initialSpeed: profile.horizontalSpeed,
      age: air.age,
    });
    const lateral = frame.copingTangent.clone()
      .multiplyScalar((air.lateralVelocity || 0) * Math.exp(-2.4 * air.age) * 0.24);
    const desired = frame.deckOutward.clone().multiplyScalar(outwardSpeed).add(lateral);
    const next = accelerateToward(currentHorizontal, desired, (air.apexPassed ? 28 : 18) * dt);
    this.velocity.x = next.x;
    this.velocity.z = next.z;
    air.returnError = Math.abs(profile.targetDistance - outwardDistance);
  }

  stepAir(dt, input, drive, before) {
    this.airTime += dt;
    const airTurn = clamp(this.steer + clamp(input.spin || 0, -1, 1), -1.65, 1.65);
    this.airSpin -= airTurn * 3.8 * dt;
    this.heading = this.airHeading + this.airSpin;
    this.airDirection();
    this.velocity.y -= PHYSICS.gravity * dt;

    if (this.movementState === MOVEMENT_STATE.VERT_AIR && this.transitionAir) {
      if (this.transitionAir.transferring && this.transitionAir.exitControl) {
        this.advanceControlledTransfer(this.transitionAir, dt);
      } else {
        this.transitions.advance(this.transitionAir, this.position, this.velocity, input, dt);
      }
    }
    this.position.addScaledVector(this.velocity, dt);

    if (this.flipState) {
      this.flipState.progress += dt / this.flipState.duration;
      if (this.flipState.progress >= 1) this.flipState = null;
    }

    if (this.pendingGrindTrick && this.contactCooldown <= 0 && !this.flipState) {
      if (this.enterGrind(this.pendingGrindTrick)) {
        this.pendingGrindTrick = null;
        return;
      }
    }

    const support = this.ensureBoardContact().solveLanding(
      before, this.position, this.heading, UP, this.velocity,
    );
    if (support) this.land(support);
  }

  land(support) {
    const detectedSupportMode = transitionLandingSupportMode(support);
    const deckExitTouchdown = detectedSupportMode === 'reject'
      && isControlledDeckExitTouchdown(support, this.transitionAir);
    const landing = evaluateTransitionLanding({
      support,
      position: this.position,
      velocity: this.velocity,
      forward: this.forward,
      airTime: this.airTime,
      flipProgress: this.flipState?.progress ?? null,
      maxLandingCorrection: PHYSICS.maxLandingCorrection,
      supportModeOverride: deckExitTouchdown ? 'deckExit' : null,
    });

    // Preserve legacy side-effect order: catch first, then a possible alignment
    // bail. All acceptance thresholds now come from canonical LandingResult.
    if (landing.flipMode === 'autoCatch' && this.flipState) this.flipState.progress = 1;

    if (!landing.accepted) {
      if (landing.shouldBail) this.bail('BAIL · align your board before landing');
      return false;
    }

    return applyAcceptedLanding(this, support, landing, {
      partialGrace: 0.16,
      slopedGrace: 0.07,
    });
  }
}
