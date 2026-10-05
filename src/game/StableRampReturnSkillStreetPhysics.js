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
const clamp = THREE.MathUtils.clamp;

export const RAMP_RETURN_TURN = Object.freeze({
  // Begin the normal vert turnaround late in the ascent and finish it during
  // descent. This is presentation/board-facing only; it never contributes to
  // airSpin, scoring or stance changes.
  startVerticalFraction: 0.34,
  finishVerticalFraction: -0.72,
});

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
 * Count only deliberate half-turns. Small air steering/noise must never become a
 * synthetic 180 at touchdown. This mirrors the trick scoring threshold used by
 * the landing layer (about 155 degrees before the first 180 is credited).
 */
export function rampReturnHalfTurns(airSpin = 0) {
  const degrees = Math.abs(Number(airSpin) || 0) * 180 / Math.PI;
  return Math.floor((degrees + 25) / 180);
}

/**
 * Vert rotation is an explicit trick command. Ground steering/analog drift is
 * deliberately excluded: the underlying air solver historically added
 * `this.steer` to `input.spin`, which could accumulate a fake 180 during a long
 * ramp air even when the player never pressed Q/E/L1/R1.
 */
export function transitionAirSpinInput(input = {}) {
  return clamp(Number(input.spin) || 0, -1, 1);
}

/**
 * Natural same-wall vert return progress. The normal turnaround begins before
 * the apex and is almost complete before wheel contact, so there is no one-frame
 * 180 snap at touchdown.
 */
export function naturalRampReturnProgress({
  verticalSpeed = 0,
  launchVertical = 1,
  config = RAMP_RETURN_TURN,
} = {}) {
  const launch = Math.max(1, Math.abs(Number(launchVertical) || 0));
  const start = launch * config.startVerticalFraction;
  const finish = launch * config.finishVerticalFraction;
  const raw = clamp((start - verticalSpeed) / Math.max(EPSILON, start - finish), 0, 1);
  return raw * raw * (3 - 2 * raw);
}

/**
 * A normal return to the SAME transition contains one non-trick turnaround:
 * takeoff facing -> opposite facing. Explicit trick spins are applied on top of
 * that baseline. Therefore:
 *   no trick spin = regular return down the ramp
 *   explicit 180 = fakie return
 *   explicit 360 = regular return
 */
export function rampReturnFacing({ takeoffFacing, airSpin = 0 } = {}) {
  const facing = horizontal(takeoffFacing).negate();
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
 * - same-wall vert return performs a smooth, non-trick turnaround in the air;
 * - there is no automatic 180 snap when wheels touch the ramp;
 * - the natural turnaround never awards 180 points or changes stance/fakie;
 * - steering input cannot accumulate vert spin; only explicit spin input can;
 * - an explicit player 180 still produces fakie, while 360 returns regular;
 * - the validated coping, anti-tunnelling, rail magnet, ramp-air and tight-carve
 *   systems remain authoritative underneath this layer.
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
   * Keep steering out of trick spin, and independently rotate the board through
   * the normal same-wall turnaround near the apex. Base StreetPhysics still owns
   * gravity, trajectory and explicit airSpin; only airHeading is supplied here.
   */
  stepAir(dt, input = {}, drive, before) {
    if (!this.transitionAir) return super.stepAir(dt, input, drive, before);

    const air = this.transitionAir;
    const originalSteer = this.steer;
    const explicitSpin = transitionAirSpinInput(input);
    const wantsTransfer = Boolean(
      input.vertExit
      || (Number(input.drive) || 0) > 0.35
      || input.directionTaps?.includes?.('up')
    );

    if (air.frame && !air.transferring && air.mode !== 'transfer' && !wantsTransfer) {
      const takeoffFacing = air.frame.takeoffFacing
        || horizontal(air.frame.boardForward, this.forward);
      const startHeading = Number.isFinite(air.frame.takeoffHeading)
        ? air.frame.takeoffHeading
        : headingFrom(takeoffFacing, this.airHeading);
      const naturalReturnFacing = horizontal(takeoffFacing).negate();
      const targetHeading = headingFrom(naturalReturnFacing, startHeading + Math.PI);
      const progress = naturalRampReturnProgress({
        verticalSpeed: this.velocity.y,
        launchVertical: air.launchVertical,
      });
      this.airHeading = lerpHeading(startHeading, targetHeading, progress);
    }

    this.steer = 0;
    try {
      return super.stepAir(dt, { ...input, spin: explicitSpin }, drive, before);
    } finally {
      this.steer = originalSteer;
    }
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
    const takeoffStance = activeAir?.frame?.takeoffStance ?? (Number(this.stance) || 1);
    const landingSpin = Number(this.airSpin) || 0;
    const halfTurns = rampReturnHalfTurns(landingSpin);
    const wasTransitionAir = Boolean(activeAir);

    const landed = super.land(support);
    if (!landed) return false;

    if (wasTransitionAir) {
      // IntegratedRampSafety historically recomputed rollingSign from
      // velocity·forward and could re-introduce fakie on a passive ramp reversal.
      // The authoritative sign after a vert landing is the deliberate stance
      // result: only an explicit odd 180 changes it.
      this.fakie = rampReturnFakie(previousFakie, landingSpin);
      this.rollingSign = this.fakie ? -1 : 1;
      this.stance = halfTurns % 2 === 1 ? -takeoffStance : takeoffStance;
      this.rampReentrySteerLock = Math.max(
        this.rampReentrySteerLock || 0,
        ARCADE_PARK_MOBILITY.rampReentrySteerLock,
      );
    }
    return true;
  }

  syncTravelDirection(options = {}) {
    const explicitFakie = Boolean(this.fakie);
    const explicitRollingSign = Number.isFinite(this.rollingSign) && this.rollingSign < 0 ? -1 : 1;
    const result = super.syncTravelDirection(options);
    this.fakie = explicitFakie;
    this.rollingSign = explicitRollingSign;
    return result;
  }

  resolveMotion(before, beforeUp, input = {}) {
    const explicitFakie = Boolean(this.fakie);
    const explicitRollingSign = Number.isFinite(this.rollingSign) && this.rollingSign < 0 ? -1 : 1;
    super.resolveMotion(before, beforeUp, input);
    this.fakie = explicitFakie;
    this.rollingSign = explicitRollingSign;
  }

  applyWallRecovery(hit) {
    const explicitFakie = Boolean(this.fakie);
    const explicitRollingSign = Number.isFinite(this.rollingSign) && this.rollingSign < 0 ? -1 : 1;
    const recovered = super.applyWallRecovery(hit);
    this.fakie = explicitFakie;
    this.rollingSign = explicitRollingSign;
    return recovered;
  }
}
