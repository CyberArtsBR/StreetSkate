import * as THREE from 'three';
import {
  WallContactAuthoritySkillStreetPhysics,
} from './WallContactAuthoritySkillStreetPhysics.js';
import { ARCADE_PARK_MOBILITY } from './ArcadeParkMobilitySkillStreetPhysics.js';
import {
  explicitAirHalfTurns,
  headingFromFacing,
  rampLandingFacing,
} from './core/LandingOrientation.js';
import {
  applyLandingPostPipeline,
  captureLandingPostContext,
} from './core/LandingPostPipeline.js';

const EPSILON = 1e-8;
const clamp = THREE.MathUtils.clamp;

function horizontal(source, fallback = null) {
  const out = source?.clone?.() || new THREE.Vector3();
  out.y = 0;
  if (out.lengthSq() > EPSILON) return out.normalize();
  if (fallback?.lengthSq?.() > EPSILON) {
    out.copy(fallback).setY(0);
    if (out.lengthSq() > EPSILON) return out.normalize();
  }
  return out.set(0, 0, -1);
}

function angleDelta(from, to) {
  let delta = (to - from + Math.PI) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  return delta - Math.PI;
}

export function lerpHeading(from, to, t) {
  return from + angleDelta(from, to) * clamp(t, 0, 1);
}

/** Backwards-compatible helper: passive ramp turnaround is intentionally zero. */
export function naturalRampReturnProgress() {
  return 0;
}

/** Backwards-compatible exports now backed by the canonical orientation model. */
export const rampReturnHalfTurns = explicitAirHalfTurns;
export const rampReturnFacing = rampLandingFacing;

/** Air rotation comes only from the explicit spin channel. */
export function transitionAirSpinInput(input = {}) {
  return clamp(Number(input.spin) || 0, -1, 1);
}

/**
 * Ramp-air orientation authority during the Phase 1 migration:
 * - steering / analog smoothing NEVER becomes airborne yaw;
 * - passive ramp air freezes the takeoff heading until explicit spin is pressed;
 * - touchdown yaw is takeoff facing + explicit spin only;
 * - fakie is NOT stored/restored here anymore. It is derived after touchdown by
 *   canonical TravelState from final deck heading versus actual travel.
 */
export class StableRampReturnSkillStreetPhysics extends WallContactAuthoritySkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rampTakeoffFacing ||= new THREE.Vector3(0, 0, -1);
    this.rampTakeoffFacing.copy(horizontal(this.forward, this.travelDirection));
    this.airTakeoffFacing ||= new THREE.Vector3(0, 0, -1);
    this.airTakeoffFacing.copy(this.rampTakeoffFacing);
    this.airTakeoffHeading = heading;
    this.airTakeoffStance = Number(this.stance) || 1;
    this.airTakeoffFromRamp = false;
  }

  takeoff(impulse = 0, transition = null) {
    const wasGrounded = Boolean(this.grounded);
    const takeoffNormalY = Math.abs(this.normal?.y ?? 1);
    const takeoffFacing = horizontal(this.forward, this.travelDirection);
    const takeoffHeading = headingFromFacing(takeoffFacing, this.heading);
    const takeoffStance = Number(this.stance) || 1;
    const rampTakeoff = Boolean(transition) || (wasGrounded && takeoffNormalY < 0.995);

    this.airTakeoffFacing.copy(takeoffFacing);
    this.airTakeoffHeading = takeoffHeading;
    this.airTakeoffStance = takeoffStance;
    this.airTakeoffFromRamp = rampTakeoff;

    const result = super.takeoff(impulse, transition);

    if (this.transitionAir?.frame) {
      this.transitionAir.frame.takeoffFacing = takeoffFacing.clone();
      this.transitionAir.frame.takeoffStance = takeoffStance;
      this.transitionAir.frame.takeoffHeading = takeoffHeading;
    }
    return result;
  }

  /**
   * Neutralize steering for EVERY airborne state. The parent air solver historically
   * used `this.steer + input.spin`; that meant generic ramp AIR still rotated even
   * after authored VERT_AIR had been fixed. Explicit spin remains fully functional.
   */
  stepAir(dt, input = {}, drive, before) {
    const originalSteer = this.steer;
    const explicitSpin = transitionAirSpinInput(input);
    const frameHeading = this.transitionAir?.frame?.takeoffHeading;
    const takeoffHeading = Number.isFinite(frameHeading)
      ? frameHeading
      : (Number.isFinite(this.airTakeoffHeading) ? this.airTakeoffHeading : this.airHeading);

    this.airHeading = takeoffHeading;
    this.steer = 0;
    try {
      return super.stepAir(dt, { ...input, spin: explicitSpin }, drive, before);
    } finally {
      this.steer = originalSteer;
    }
  }

  /** Disable every lower-layer automatic transition alignment. */
  autoAlignOriginalTransition() {}

  land(support) {
    if (this.deferLandingPostHooks) return super.land(support);

    const context = captureLandingPostContext(this, support, {
      rampReentrySlopeY: ARCADE_PARK_MOBILITY.rampReentrySlopeY,
    });

    // Direct subsystem instances should match the final runtime: acceptance and
    // geometry routing still execute below, but legacy post hooks are deferred so
    // orientation/travel/re-entry bookkeeping is composed exactly once here.
    this.deferLandingPostHooks = true;
    let landed = false;
    try {
      landed = super.land(support);
    } finally {
      this.deferLandingPostHooks = false;
    }
    if (!landed) return false;

    applyLandingPostPipeline(this, support, context, {
      lowerLayerHeading: this.heading,
      rampReentrySteerLock: ARCADE_PARK_MOBILITY.rampReentrySteerLock,
    });
    return true;
  }
}
