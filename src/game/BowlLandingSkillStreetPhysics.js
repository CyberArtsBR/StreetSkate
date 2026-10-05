import * as THREE from 'three';
import { StableBoardContactSkillStreetPhysics } from './StableBoardContactSkillStreetPhysics.js';
import { MOVEMENT_STATE, PHYSICS } from './StreetPhysics.js';

function headingFrom(direction, fallback = 0) {
  const x = direction.x, z = direction.z;
  if (x * x + z * z < 1e-8) return fallback;
  return Math.atan2(-x, -z);
}

export function transitionLandingSupportMode(support) {
  const count = support?.count || 0;
  const front = Boolean(support?.frontSupported);
  const rear = Boolean(support?.rearSupported);
  if (count < 1) return 'reject';
  if (count >= 2 && front && rear) return 'full';

  // On real bowls/pools and triangulated ramps the first valid swept contact can
  // genuinely be one wheel. It is safe to bridge only on a sloped rideable face;
  // flat ground still requires both trucks so ledge/seam contacts do not snap.
  const normalY = Math.abs(support?.normal?.y ?? 1);
  if (normalY < 0.995 && (front || rear)) {
    if (count >= 2) return 'truckFirst';
    return 'wheelFirst';
  }
  return 'reject';
}

export function transitionFlipLandingMode(progress, normalY = 1, contactMode = 'full') {
  if (!Number.isFinite(progress)) return 'clear';
  if (progress >= 0.88) return 'clear';

  const mode = contactMode === true ? 'truckFirst' : contactMode;
  const ny = Math.abs(normalY);
  let threshold = 0.62;
  if (ny < 0.90) threshold = 0.28;
  else if (ny < 0.97) threshold = 0.34;
  else if (ny < 0.995) threshold = 0.40;
  if (mode === 'truckFirst') threshold = Math.min(threshold, 0.22);
  if (mode === 'wheelFirst') threshold = Math.min(threshold, 0.18);
  return progress >= threshold ? 'autoCatch' : 'bail';
}

export function transitionAlignmentThreshold(normalY = 1, contactMode = 'full') {
  const mode = contactMode === true ? 'truckFirst' : contactMode;
  const ny = Math.abs(normalY);
  if (mode === 'wheelFirst') return 0.08;
  if (mode === 'truckFirst') return 0.12;
  if (ny < 0.90) return 0.14;
  if (ny < 0.97) return 0.22;
  if (ny < 0.995) return 0.30;
  return 0.44;
}

/**
 * Bowl/pool/ramp landing bridge.
 * Triangulated transitions often touch one wheel, then one truck, then all four.
 * Lock the first real swept wheel contact long enough for the contact rig to grow
 * support instead of rejecting it and letting the board cross the rideable mesh.
 */
export class BowlLandingSkillStreetPhysics extends StableBoardContactSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.transitionLandingGrace = 0;
  }

  takeoff(impulse = 0, transition = null) {
    this.transitionLandingGrace = 0;
    return super.takeoff(impulse, transition);
  }

  stepGround(dt, input, drive) {
    this.transitionLandingGrace = Math.max(0, (this.transitionLandingGrace || 0) - dt);
    super.stepGround(dt, input, drive);
  }

  land(support) {
    if (this.airTime < 0.075 && this.velocity.y > 0.05) return false;

    const supportMode = transitionLandingSupportMode(support);
    if (supportMode === 'reject') return false;
    const partialTouchdown = supportMode !== 'full';

    this.ensureBoardSafetyScratch();
    const correction = this._supportCorrection.copy(support.position).sub(this.position);
    let correctionLimit = PHYSICS.maxLandingCorrection;
    if (supportMode === 'truckFirst') correctionLimit = Math.max(correctionLimit, 0.34);
    if (supportMode === 'wheelFirst') correctionLimit = Math.max(correctionLimit, 0.42);
    if (correction.length() > correctionLimit) return false;

    const boardForward = this._deckProbeDelta.copy(this.forward).projectOnPlane(support.normal);
    if (boardForward.lengthSq() < 1e-7) return false;
    boardForward.normalize();

    // This vector is the authoritative travel direction at touchdown. Do not
    // rebuild it from deck heading after a 180; the deck may face backward while
    // the rider must keep travelling in the same world direction.
    const planar = this._deckProbeTo.copy(this.velocity).projectOnPlane(support.normal);
    const planarSpeed = planar.length();
    let alignment = 1;
    if (planarSpeed > 0.18) {
      const tangent = this._deckProbeFrom.copy(planar).multiplyScalar(1 / planarSpeed);
      alignment = boardForward.dot(tangent);
    }

    const flipMode = this.flipState
      ? transitionFlipLandingMode(this.flipState.progress, support.normal.y, supportMode)
      : 'clear';
    if (flipMode === 'autoCatch' && this.flipState) this.flipState.progress = 1;

    const alignmentThreshold = transitionAlignmentThreshold(support.normal.y, supportMode);
    if ((planarSpeed > 0.18 && Math.abs(alignment) < alignmentThreshold) || flipMode === 'bail') {
      this.bail('BAIL · align your board before landing');
      return false;
    }

    const halfTurns = Math.floor((Math.abs(this.airSpin) * 180 / Math.PI + 25) / 180);
    const spin = halfTurns * 180;

    this.position.copy(support.position);
    this.normal.copy(support.normal);
    this.heading = headingFrom(boardForward, this.heading);
    this.groundDirection();

    if (spin >= 180) this.recordTrick(`${spin}°`, spin);
    // Every odd 180 reverses which end of the deck leads relative to travel.
    if (halfTurns % 2 === 1) this.stance *= -1;

    this.setMovementState(MOVEMENT_STATE.GROUND);
    this.coyote = 0;
    this.justLanded = true;
    this.transitionAir = null;
    this.wallRide = null;
    this.lastWheelSupport = support;
    this.transitionLandingGrace = partialTouchdown ? 0.14 : (Math.abs(support.normal.y) < 0.995 ? 0.07 : 0);

    if (planarSpeed > 0.0001) this.velocity.copy(planar);
    else this.velocity.set(0, 0, 0);
    this.flipState = null;
    this.grabState = null;
    this.airSpin = 0;
    this.stableGroundTime = 0;
    return true;
  }
}
