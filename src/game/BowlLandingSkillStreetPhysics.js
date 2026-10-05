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
  if (count < 2) return 'reject';
  if (front && rear) return 'full';
  const normalY = Math.abs(support?.normal?.y ?? 1);
  if (normalY < 0.985 && (front || rear)) return 'truckFirst';
  return 'reject';
}

export function transitionFlipLandingMode(progress, normalY = 1, truckFirst = false) {
  if (!Number.isFinite(progress)) return 'clear';
  if (progress <= 0.12 || progress >= 0.88) return 'clear';
  const ny = Math.abs(normalY);
  let threshold = 0.72;
  if (ny < 0.90) threshold = 0.42;
  else if (ny < 0.97) threshold = 0.50;
  else if (ny < 0.985) threshold = 0.58;
  if (truckFirst) threshold = Math.min(threshold, 0.48);
  return progress >= threshold ? 'autoCatch' : 'bail';
}

export function transitionAlignmentThreshold(normalY = 1, truckFirst = false) {
  const ny = Math.abs(normalY);
  if (truckFirst) return 0.20;
  if (ny < 0.90) return 0.22;
  if (ny < 0.97) return 0.30;
  if (ny < 0.985) return 0.36;
  return 0.44;
}

/**
 * Bowl/pool landing bridge.
 * Curved transitions often touch one truck before the other. Treat that first
 * two-wheel truck contact as a valid touchdown instead of rejecting it and
 * allowing the board to cross the transition mesh before the next fixed step.
 */
export class BowlLandingSkillStreetPhysics extends StableBoardContactSkillStreetPhysics {
  land(support) {
    if (this.airTime < 0.075 && this.velocity.y > 0.05) return false;

    const supportMode = transitionLandingSupportMode(support);
    if (supportMode === 'reject') return false;
    const truckFirst = supportMode === 'truckFirst';

    this.ensureBoardSafetyScratch();
    const correction = this._supportCorrection.copy(support.position).sub(this.position);
    const correctionLimit = truckFirst ? Math.max(PHYSICS.maxLandingCorrection, 0.30) : PHYSICS.maxLandingCorrection;
    if (correction.length() > correctionLimit) return false;

    const boardForward = this._deckProbeDelta.copy(this.forward).projectOnPlane(support.normal);
    if (boardForward.lengthSq() < 1e-7) return false;
    boardForward.normalize();

    const planar = this._deckProbeTo.copy(this.velocity).projectOnPlane(support.normal);
    const planarSpeed = planar.length();
    let alignment = 1;
    if (planarSpeed > 0.18) {
      const tangent = this._deckProbeFrom.copy(planar).multiplyScalar(1 / planarSpeed);
      alignment = boardForward.dot(tangent);
    }

    const flipMode = this.flipState
      ? transitionFlipLandingMode(this.flipState.progress, support.normal.y, truckFirst)
      : 'clear';
    if (flipMode === 'autoCatch' && this.flipState) this.flipState.progress = 1;

    const alignmentThreshold = transitionAlignmentThreshold(support.normal.y, truckFirst);
    if ((planarSpeed > 0.18 && Math.abs(alignment) < alignmentThreshold) || flipMode === 'bail') {
      this.bail('BAIL · align your board before landing');
      return false;
    }

    this.position.copy(support.position);
    this.normal.copy(support.normal);
    this.heading = headingFrom(boardForward, this.heading);
    this.groundDirection();

    const spin = Math.floor((Math.abs(this.airSpin) * 180 / Math.PI + 25) / 180) * 180;
    if (spin >= 180) this.recordTrick(`${spin}°`, spin);
    this.setMovementState(MOVEMENT_STATE.GROUND);
    this.coyote = 0;
    this.justLanded = true;
    this.transitionAir = null;
    this.wallRide = null;
    this.lastWheelSupport = support;

    const travelSign = planarSpeed > 0.18 && alignment < 0 ? -1 : 1;
    this.velocity.copy(this.forward).multiplyScalar(planarSpeed * travelSign);
    this.flipState = null;
    this.grabState = null;
    this.airSpin = 0;
    this.stableGroundTime = 0;
    return true;
  }
}
