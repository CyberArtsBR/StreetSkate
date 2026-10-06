import * as THREE from 'three';
import { MomentumRollSkillStreetPhysics } from './MomentumRollSkillStreetPhysics.js';
import { applyAcceptedLanding } from './core/LandingExecutor.js';
import {
  evaluateTransitionLanding,
  transitionLandingSupportMode,
} from './core/LandingResult.js';
import { resolveControlledTransferLaunch } from './core/TransferLaunchResult.js';
import { resolveTransferFlightStep } from './core/TransferFlightResult.js';
import { MOVEMENT_STATE, PHYSICS } from './StreetPhysics.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

export const RAMP_WALL_SAFETY = Object.freeze({
  // Legacy wall-classification thresholds remain exported for geometry QA only.
  // Runtime collision response no longer owns yaw or performs wall-turn probes.
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

/** Legacy geometry classifier kept for regression tests; it has no yaw authority. */
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
 * Compatibility helper retained for tests/tuning. Runtime takeoff now consumes
 * the equivalent pure TransferLaunchResult stage.
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

/** Compatibility helper retained for tests/tuning; flight runtime uses the pure result model. */
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
 * Transition/deck-exit safety layer. Wall-turn detection was removed in Phase 1:
 * collision can correct position/velocity but never owns horizontal yaw.
 */
export class RampWallSafetySkillStreetPhysics extends MomentumRollSkillStreetPhysics {
  takeoff(impulse = 0, transition = null) {
    super.takeoff(impulse, transition);
    const air = this.transitionAir;
    if (!air?.transferring || !air.frame) return;

    const result = resolveControlledTransferLaunch({
      frame: air.frame,
      incomingSpeed: air.frame.incomingSpeed,
      launchVertical: air.launchVertical,
      lateralVelocity: air.lateralVelocity,
      config: RAMP_WALL_SAFETY,
    });
    if (!result.active) return;

    air.exitControl = { ...result.exitControl };
    air.launchVertical = result.launchVertical;
    air.launchHorizontal = result.launchHorizontal.clone();
    this.velocity.copy(result.velocity);
  }

  advanceControlledTransfer(air, dt) {
    const result = resolveTransferFlightStep({
      air,
      position: this.position,
      velocity: this.velocity,
      dt,
      config: RAMP_WALL_SAFETY,
    });
    if (!result.active) return;

    air.age = result.age;
    air.apexPassed = result.apexPassed;
    air.returnError = result.returnError;
    this.velocity.copy(result.velocity);
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
