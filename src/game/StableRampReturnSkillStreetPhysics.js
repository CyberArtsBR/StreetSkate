import * as THREE from 'three';
import {
  WallContactAuthoritySkillStreetPhysics,
} from './WallContactAuthoritySkillStreetPhysics.js';
import { ARCADE_PARK_MOBILITY } from './ArcadeParkMobilitySkillStreetPhysics.js';

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

function headingFrom(direction, fallback = 0) {
  const flat = horizontal(direction);
  if (flat.lengthSq() < EPSILON) return fallback;
  return Math.atan2(-flat.x, -flat.z);
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

/** Count only deliberate player half-turns. */
export function rampReturnHalfTurns(airSpin = 0) {
  const degrees = Math.abs(Number(airSpin) || 0) * 180 / Math.PI;
  return Math.floor((degrees + 25) / 180);
}

/** Air rotation comes only from the explicit spin channel. */
export function transitionAirSpinInput(input = {}) {
  return clamp(Number(input.spin) || 0, -1, 1);
}

/** Passive return preserves takeoff facing; only an explicit odd 180 reverses it. */
export function rampReturnFacing({ takeoffFacing, airSpin = 0 } = {}) {
  const facing = horizontal(takeoffFacing);
  if (rampReturnHalfTurns(airSpin) % 2 === 1) facing.negate();
  return facing;
}

/** Fakie/stance is explicit-trick driven, never inferred from passive return. */
export function rampReturnFakie(previousFakie = false, airSpin = 0) {
  return rampReturnHalfTurns(airSpin) % 2 === 1
    ? !Boolean(previousFakie)
    : Boolean(previousFakie);
}

/**
 * Final ramp-air authority:
 * - steering input / analog smoothing NEVER becomes airborne yaw;
 * - this applies to authored vert AND generic ramps/kickers/banks;
 * - passive ramp air freezes the takeoff heading until explicit spin is pressed;
 * - touchdown preserves that airborne facing exactly;
 * - dedicated wall recovery is the only automatic ~90-degree turn in the game.
 */
export class StableRampReturnSkillStreetPhysics extends WallContactAuthoritySkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rampTakeoffFacing ||= new THREE.Vector3(0, 0, -1);
    this.rampTakeoffFacing.copy(horizontal(this.forward, this.travelDirection));
    this.airTakeoffFacing ||= new THREE.Vector3(0, 0, -1);
    this.airTakeoffFacing.copy(this.rampTakeoffFacing);
    this.airTakeoffHeading = heading;
    this.airTakeoffFakie = Boolean(this.fakie);
    this.airTakeoffStance = Number(this.stance) || 1;
    this.airTakeoffFromRamp = false;
  }

  takeoff(impulse = 0, transition = null) {
    const wasGrounded = Boolean(this.grounded);
    const takeoffNormalY = Math.abs(this.normal?.y ?? 1);
    const takeoffFacing = horizontal(this.forward, this.travelDirection);
    const takeoffHeading = headingFrom(takeoffFacing, this.heading);
    const takeoffFakie = Boolean(this.fakie);
    const takeoffStance = Number(this.stance) || 1;
    const rampTakeoff = Boolean(transition) || (wasGrounded && takeoffNormalY < 0.995);

    this.airTakeoffFacing.copy(takeoffFacing);
    this.airTakeoffHeading = takeoffHeading;
    this.airTakeoffFakie = takeoffFakie;
    this.airTakeoffStance = takeoffStance;
    this.airTakeoffFromRamp = rampTakeoff;

    const result = super.takeoff(impulse, transition);

    if (this.transitionAir?.frame) {
      this.transitionAir.frame.takeoffFacing = takeoffFacing.clone();
      this.transitionAir.frame.takeoffFakie = takeoffFakie;
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
    const activeAir = this.transitionAir;
    const wasRampAir = Boolean(activeAir) || Boolean(this.airTakeoffFromRamp);
    const takeoffFacing = activeAir?.frame?.takeoffFacing
      || this.airTakeoffFacing
      || this.forward;
    const previousFakie = activeAir?.frame?.takeoffFakie
      ?? this.airTakeoffFakie
      ?? Boolean(this.fakie);
    const takeoffStance = activeAir?.frame?.takeoffStance
      ?? this.airTakeoffStance
      ?? (Number(this.stance) || 1);
    const landingSpin = Number(this.airSpin) || 0;
    const halfTurns = rampReturnHalfTurns(landingSpin);

    // Preserve the actual incoming tangent before lower layers settle contact.
    // This is the travel reference; it must never be used to invent board yaw.
    const incomingPlanar = this.velocity.clone().projectOnPlane(support.normal);
    const incomingSpeed = incomingPlanar.length();
    const desiredFacing = rampReturnFacing({ takeoffFacing, airSpin: landingSpin });
    const desiredHeading = headingFrom(desiredFacing, this.heading);

    const landed = super.land(support);
    if (!landed) return false;

    if (wasRampAir) {
      // Authoritative touchdown rule: board yaw is takeoff facing + explicit trick
      // spin only. Surface projection may tilt the board in pitch/roll, but can
      // NEVER rotate it sideways around world Y at contact.
      this.heading = desiredHeading;
      this.groundDirection();

      if (incomingSpeed > 0.18 && this.forward.lengthSq() > EPSILON) {
        const travelSign = incomingPlanar.dot(this.forward) < 0 ? -1 : 1;
        this.velocity.copy(this.forward).multiplyScalar(incomingSpeed * travelSign);
        this.rollingSign = travelSign;
      }

      this.fakie = rampReturnFakie(previousFakie, landingSpin);
      this.stance = halfTurns % 2 === 1 ? -takeoffStance : takeoffStance;
      this.rampReentrySteerLock = Math.max(
        this.rampReentrySteerLock || 0,
        ARCADE_PARK_MOBILITY.rampReentrySteerLock,
      );
    }

    this.airTakeoffFromRamp = false;
    return true;
  }

  syncTravelDirection(options = {}) {
    const explicitFakie = Boolean(this.fakie);
    const result = super.syncTravelDirection(options);
    this.fakie = explicitFakie;
    return result;
  }

  resolveMotion(before, beforeUp, input = {}) {
    const explicitFakie = Boolean(this.fakie);
    super.resolveMotion(before, beforeUp, input);
    this.fakie = explicitFakie;
  }

  applyWallRecovery(hit) {
    const explicitFakie = Boolean(this.fakie);
    const recovered = super.applyWallRecovery(hit);
    this.fakie = explicitFakie;
    return recovered;
  }
}
