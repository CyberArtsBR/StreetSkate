import * as THREE from 'three';
import {
  SafeCopingExitSkillStreetPhysics,
} from './SafeCopingExitSkillStreetPhysics.js';
import { createBalanceState } from './SkateSystems.js';
import {
  GRIND_CAPTURE_POLICY,
  grindCaptureEligibility,
  resolveMagneticGrindCapture,
} from './core/GrindCaptureController.js';
import {
  GROUND_MOTOR,
  arcadeTurnGain,
  rampReentrySteerScale,
} from './core/GroundMotor.js';

export {
  arcadeTurnGain,
  rampReentrySteerScale,
} from './core/GroundMotor.js';


export const ARCADE_PARK_MOBILITY = Object.freeze({
  // THPS-style rail magnetism. This is only consulted while airborne with an
  // explicit grind intent, so normal riding cannot snap to nearby rails.
  railCaptureDistance: GRIND_CAPTURE_POLICY.railCaptureDistance,
  railCaptureAbove: GRIND_CAPTURE_POLICY.railCaptureAbove,
  railCaptureBelow: GRIND_CAPTURE_POLICY.railCaptureBelow,
  railMaxRiseVelocity: GRIND_CAPTURE_POLICY.railMaxRiseVelocity,
  railPredictionTime: GRIND_CAPTURE_POLICY.railPredictionTime,
  railAlignmentRelax: GRIND_CAPTURE_POLICY.railAlignmentRelax,
  railMaxAlignmentSlack: GRIND_CAPTURE_POLICY.railMaxAlignmentSlack,
  railMinTangentSpeed: GRIND_CAPTURE_POLICY.railMinTangentSpeed,
  railBlendTime: GRIND_CAPTURE_POLICY.railBlendTime,

  // Tighter arcade carving without changing regular/fakie semantics.
  turnGainLowSpeed: GROUND_MOTOR.turnGainLowSpeed,
  turnGainHighSpeed: GROUND_MOTOR.turnGainHighSpeed,
  turnGainFullSpeed: GROUND_MOTOR.turnGainFullSpeed,
  manualTurnGain: GROUND_MOTOR.manualTurnGain,

  // Re-entry steering protection. A steep transition has almost no horizontal
  // tangent near vertical, so steering is briefly suppressed after touchdown.
  // Contact itself never changes heading.
  rampReentrySteerLock: GROUND_MOTOR.rampReentrySteerLock,
  rampReentryHardLock: GROUND_MOTOR.rampReentryHardLock,
  rampReentrySlopeY: 0.995,
});

function horizontal(source, fallback = null) {
  const out = source?.clone?.() || new THREE.Vector3();
  out.y = 0;
  if (out.lengthSq() > 1e-8) return out.normalize();
  if (fallback?.lengthSq?.() > 1e-8) {
    out.copy(fallback).setY(0);
    if (out.lengthSq() > 1e-8) return out.normalize();
  }
  return out.set(0, 0, -1);
}

/**
 * Legacy pure helper retained for replay compatibility only. Runtime landing yaw
 * no longer uses this function; LandingOrientation owns takeoff-facing + explicit
 * spin semantics and contact normals have zero yaw authority.
 */
export function transitionReturnBoardDirection({
  rampInward = null,
  fallbackTravel = null,
  rollingSign = 1,
  airSpin = 0,
} = {}) {
  const travel = horizontal(rampInward, fallbackTravel);
  const halfTurns = Math.round((Math.abs(Number(airSpin) || 0) * 180 / Math.PI) / 180);
  const initialDeckSign = rollingSign < 0 ? -1 : 1;
  const spinSign = halfTurns % 2 === 1 ? -1 : 1;
  return travel.multiplyScalar(initialDeckSign * spinSign);
}

export const arcadeGrindEligibility = grindCaptureEligibility;

/**
 * THPS-like park mobility layer:
 * - explicit grind input gets a forgiving airborne rail/handrail magnet;
 * - steering gets a tighter carve radius at park speeds;
 * - transition re-entry briefly suppresses steering but never invents yaw.
 *
 * Ramp launch energy is intentionally NOT owned here anymore. Phase 1 moved all
 * ramp bonus composition to LaunchEnergyModel / UnifiedRampFeel so this layer can
 * never inject a second hidden takeoff boost.
 */
export class ArcadeParkMobilitySkillStreetPhysics extends SafeCopingExitSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rampReentrySteerLock = 0;
  }

  magneticRailCapture(trick) {
    const context = {
      position: this.position,
      forward: this.forward,
      velocity: this.velocity,
      railNetwork: this.railNetwork,
      trick,
    };
    return this.coreController
      ? this.coreController.resolveGrindCapture(context)
      : resolveMagneticGrindCapture(context);
  }

  enterGrind(trick) {
    if (super.enterGrind(trick)) return true;

    const capture = this.magneticRailCapture(trick);
    if (!capture) return false;
    const sample = this.railNetwork.sample(capture.rail, capture.s, {
      clearance: capture.profile.clearance,
    });
    if (!sample) return false;

    this.grind = {
      ...capture,
      trick: { ...trick, name: capture.profile.name },
      profile: capture.profile,
      speed: capture.speed,
      time: 0,
      balance: 0,
      balanceState: createBalanceState(1.18),
      instability: 0,
      blendElapsed: 0,
      blendDuration: ARCADE_PARK_MOBILITY.railBlendTime,
      blendPosition: this.position.clone(),
      incomingVelocity: this.velocity.clone(),
      entryHeading: this.heading,
      contactClearance: capture.profile.clearance,
      contactClearanceTarget: capture.profile.clearance,
      magneticEntry: true,
    };
    this.grindBalanceState = this.grind.balanceState;
    this.grindBalance = 0;
    this.grounded = false;
    this.manual = null;
    this.flatland = null;
    this.transitionAir = null;
    this.wallRide = null;
    this.airHeading = this.heading;
    this.recordTrick(this.grind.trick.name, this.grind.trick.points || 100);
    this.stableGroundTime = 0;
    this.ensureBoardContact().clearContacts();
    this.lastWheelSupport = null;
    return true;
  }

}
