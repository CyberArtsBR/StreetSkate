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

/**
 * Kept for backwards compatibility with older test/import surfaces. Automatic
 * same-wall turnaround has intentionally been REMOVED: without explicit spin
 * input there is no presentation yaw at all while airborne.
 */
export function naturalRampReturnProgress() {
  return 0;
}

/** Count only deliberate player half-turns. */
export function rampReturnHalfTurns(airSpin = 0) {
  const degrees = Math.abs(Number(airSpin) || 0) * 180 / Math.PI;
  return Math.floor((degrees + 25) / 180);
}

/** Vert rotation comes only from Q/E/L1/R1 (explicit spin). */
export function transitionAirSpinInput(input = {}) {
  return clamp(Number(input.spin) || 0, -1, 1);
}

/**
 * Board facing is takeoff facing plus explicit trick spin only. Passive ramp
 * reversal does not rotate the character in the air and does not snap at contact.
 */
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
 * Authoritative ramp-return semantics:
 * - no input => NO automatic yaw in the air;
 * - no input => NO automatic heading snap on touchdown;
 * - passive return may roll backward relative to the deck, but that alone never
 *   changes stance/fakie presentation;
 * - explicit 180/360 still work normally through airSpin;
 * - robust broad-wall recovery lives directly underneath this layer.
 */
export class StableRampReturnSkillStreetPhysics extends WallContactAuthoritySkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rampTakeoffFacing ||= new THREE.Vector3(0, 0, -1);
    this.rampTakeoffFacing.copy(horizontal(this.forward, this.travelDirection));
  }

  takeoff(impulse = 0, transition = null) {
    const takeoffFacing = horizontal(this.forward, this.travelDirection);
    const takeoffFakie = Boolean(this.fakie);
    const takeoffStance = Number(this.stance) || 1;
    const result = super.takeoff(impulse, transition);

    if (this.transitionAir?.frame) {
      this.transitionAir.frame.takeoffFacing = takeoffFacing.clone();
      this.transitionAir.frame.takeoffFakie = takeoffFakie;
      this.transitionAir.frame.takeoffStance = takeoffStance;
      this.transitionAir.frame.takeoffHeading = headingFrom(takeoffFacing, this.airHeading);
    }
    return result;
  }

  /**
   * Do not allow ground steering/drift to become airborne spin. More importantly,
   * keep airHeading frozen at takeoff heading for a passive vert return. The only
   * yaw applied by the parent is explicit airSpin.
   */
  stepAir(dt, input = {}, drive, before) {
    if (!this.transitionAir) return super.stepAir(dt, input, drive, before);

    const air = this.transitionAir;
    const originalSteer = this.steer;
    const explicitSpin = transitionAirSpinInput(input);
    const takeoffHeading = Number.isFinite(air.frame?.takeoffHeading)
      ? air.frame.takeoffHeading
      : this.airHeading;

    this.airHeading = takeoffHeading;
    this.steer = 0;
    try {
      return super.stepAir(dt, { ...input, spin: explicitSpin }, drive, before);
    } finally {
      this.steer = originalSteer;
    }
  }

  /**
   * Disable every lower-layer automatic transition alignment. Current heading is
   * already the player's takeoff facing plus explicit spin; landing must preserve it.
   */
  autoAlignOriginalTransition() {}

  land(support) {
    const activeAir = this.transitionAir;
    const previousFakie = activeAir?.frame?.takeoffFakie ?? Boolean(this.fakie);
    const takeoffStance = activeAir?.frame?.takeoffStance ?? (Number(this.stance) || 1);
    const landingSpin = Number(this.airSpin) || 0;
    const halfTurns = rampReturnHalfTurns(landingSpin);
    const wasTransitionAir = Boolean(activeAir);

    const landed = super.land(support);
    if (!landed) return false;

    if (wasTransitionAir) {
      // Do not label a passive backward roll down the same ramp as a fakie trick.
      // rollingSign remains physical (velocity relative to deck) so momentum keeps
      // going down the ramp without flipping heading on the next frame.
      this.fakie = rampReturnFakie(previousFakie, landingSpin);
      this.stance = halfTurns % 2 === 1 ? -takeoffStance : takeoffStance;
      const signedSpeed = this.velocity.dot(this.forward);
      if (Math.abs(signedSpeed) > 0.18) this.rollingSign = signedSpeed < 0 ? -1 : 1;

      this.rampReentrySteerLock = Math.max(
        this.rampReentrySteerLock || 0,
        ARCADE_PARK_MOBILITY.rampReentrySteerLock,
      );
    }
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
