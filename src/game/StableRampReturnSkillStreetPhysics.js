import * as THREE from 'three';
import {
  ArcadeParkMobilitySkillStreetPhysics,
  ARCADE_PARK_MOBILITY,
} from './ArcadeParkMobilitySkillStreetPhysics.js';
import {
  canAutoAlignTransitionLanding,
  supportMatchesOriginalTransition,
} from './SafeCopingExitSkillStreetPhysics.js';

const EPSILON = 1e-8;

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

/**
 * Count only deliberate half-turns. Small air steering/noise must never become a
 * synthetic 180 at touchdown. This mirrors the trick scoring threshold used by
 * the landing layer (about 155 degrees before the first 180 is credited).
 */
export function rampReturnHalfTurns(airSpin = 0) {
  const degrees = Math.abs(Number(airSpin) || 0) * 180 / Math.PI;
  return Math.floor((degrees + 25) / 180);
}

/**
 * Preserve the deck's horizontal takeoff facing on a straight vert return.
 * Physics may reverse world travel down the ramp, but facing only changes when
 * the player actually performs an odd number of 180-degree rotations.
 */
export function rampReturnFacing({ takeoffFacing, airSpin = 0 } = {}) {
  const facing = horizontal(takeoffFacing);
  if (rampReturnHalfTurns(airSpin) % 2 === 1) facing.negate();
  return facing;
}

/** Fakie/stance intent is trick-driven, never inferred from passive ramp reversal. */
export function rampReturnFakie(previousFakie = false, airSpin = 0) {
  return rampReturnHalfTurns(airSpin) % 2 === 1
    ? !Boolean(previousFakie)
    : Boolean(previousFakie);
}

/**
 * Final ramp-return semantics:
 * - straight up / straight back does NOT visually snap 180;
 * - passive reversal down a quarter does NOT by itself toggle fakie mode;
 * - a real player 180 still flips facing/fakie;
 * - 360 preserves facing/fakie;
 * - the validated coping, anti-tunnelling, rail magnet, ramp-air and tight-carve
 *   systems remain untouched underneath this layer.
 */
export class StableRampReturnSkillStreetPhysics extends ArcadeParkMobilitySkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rampTakeoffFacing ||= new THREE.Vector3(0, 0, -1);
    this.rampTakeoffFacing.copy(horizontal(this.forward, this.travelDirection));
  }

  takeoff(impulse = 0, transition = null) {
    const takeoffFacing = horizontal(this.forward, this.travelDirection);
    const takeoffFakie = Boolean(this.fakie);
    const result = super.takeoff(impulse, transition);

    if (this.transitionAir?.frame) {
      this.transitionAir.frame.takeoffFacing = takeoffFacing.clone();
      this.transitionAir.frame.takeoffFakie = takeoffFakie;
    }
    return result;
  }

  autoAlignOriginalTransition(support, air) {
    if (!supportMatchesOriginalTransition(support, air)) return;
    if (!canAutoAlignTransitionLanding(this.airSpin)) return;

    const takeoffFacing = air.frame?.takeoffFacing
      || horizontal(air.frame?.boardForward, this.travelDirection || this.forward);
    const desiredBoard = rampReturnFacing({
      takeoffFacing,
      airSpin: this.airSpin,
    });

    this.heading = headingFrom(desiredBoard, this.heading);
    this.airDirection();
  }

  land(support) {
    const activeAir = this.transitionAir;
    const previousFakie = activeAir?.frame?.takeoffFakie ?? Boolean(this.fakie);
    const landingSpin = Number(this.airSpin) || 0;
    const wasTransitionAir = Boolean(activeAir);

    const landed = super.land(support);
    if (!landed) return false;

    if (wasTransitionAir) {
      // Keep locomotion sign free to represent the actual direction down the ramp,
      // but do not call passive reversal a fakie trick/state change.
      this.fakie = rampReturnFakie(previousFakie, landingSpin);
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
