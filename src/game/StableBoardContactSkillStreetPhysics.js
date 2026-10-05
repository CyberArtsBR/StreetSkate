import * as THREE from 'three';
import { BoardContactSkillStreetPhysics } from './BoardContactSkillStreetPhysics.js';
import { MOVEMENT_STATE, PHYSICS } from './StreetPhysics.js';

const clamp = THREE.MathUtils.clamp;

function headingFrom(direction, fallback = 0) {
  const x = direction.x, z = direction.z;
  if (x * x + z * z < 1e-8) return fallback;
  return Math.atan2(-x, -z);
}

/**
 * Nose/tail clearance is only meant to stop sharp obstacle sides.
 * Curved rideable faces (banks/quarters/bowls) must stay wheel-owned.
 */
export function isSharpDeckBlocker(normal, maxVerticalComponent = 0.08) {
  return Boolean(normal && Math.abs(normal.y) <= maxVerticalComponent);
}

/**
 * A board may keep partial edge support, but it must never be pulled sharply
 * downward toward a disconnected lower surface. That transition should become air.
 */
export function isUnsafeSupportDrop({
  contactCount = 0,
  maxWheelGap = 0,
  correctionAlongNormal = 0,
  normalContinuity = 1,
} = {}) {
  if (correctionAlongNormal >= -0.045) return false;
  if (contactCount < 3) return true;
  return correctionAlongNormal < -0.065
    && maxWheelGap > 0.075
    && normalContinuity > 0.94;
}

/**
 * Regression guard around the validated six-point board solver.
 * It preserves the same contact rig while rejecting disconnected downward snaps
 * and filtering nose/tail clearance to near-vertical obstacle faces only.
 */
export class StableBoardContactSkillStreetPhysics extends BoardContactSkillStreetPhysics {
  ensureBoardSafetyScratch() {
    this._supportPreviousNormal ||= new THREE.Vector3(0, 1, 0);
    this._supportCorrection ||= new THREE.Vector3();
    this._deckProbeFrom ||= new THREE.Vector3();
    this._deckProbeTo ||= new THREE.Vector3();
    this._deckProbeDelta ||= new THREE.Vector3();
    this._deckHitPoint ||= new THREE.Vector3();
    this._deckHitNormal ||= new THREE.Vector3();
  }

  resolveSharpDeckClearance(from, desired, velocity, heading, normal) {
    const contact = this.ensureBoardContact();
    this.ensureBoardSafetyScratch();
    const state = contact.state;
    state.noseClear = true;
    state.tailClear = true;
    const basis = contact.basis(heading, normal);

    for (let i = 0; i < 2; i++) {
      const local = i === 0 ? contact.noseLocal : contact.tailLocal;
      contact.worldPoint(from, local, heading, normal, this._deckProbeFrom, basis);
      contact.worldPoint(desired, local, heading, normal, this._deckProbeTo, basis);
      const hit = this.surface.sweepSolidSphere(
        this._deckProbeFrom,
        this._deckProbeTo,
        contact.clearanceRadius,
        this._deckHitPoint,
        this._deckHitNormal,
      );
      if (!hit || !isSharpDeckBlocker(hit.normal)) continue;

      if (i === 0) state.noseClear = false;
      else state.tailClear = false;

      const safeFraction = clamp((hit.fraction ?? 0) - 0.008, 0, 1);
      this._deckProbeDelta.copy(desired).sub(from).multiplyScalar(safeFraction);
      desired.copy(from).add(this._deckProbeDelta);
      const into = velocity.dot(hit.normal);
      if (into < 0) velocity.addScaledVector(hit.normal, -into);
    }
    return desired;
  }

  resolveMotion(before, beforeUp, input = {}) {
    const result = this.surface.move(before, this.position, this.velocity, {
      fromUp: beforeUp,
      toUp: this.bodyUp(),
      grounded: this.grounded,
      forward: this.forward,
      ignoreRail: this.grind?.rail.name || null,
    });
    this.position.copy(result.position);

    const wall = result.contacts.find(hit => !hit.railId && Math.abs(hit.normal.y) < 0.3);
    if (wall && !this.grounded && !this.grind && !this.wallRide && this.contactCooldown <= 0
      && this.movementState !== MOVEMENT_STATE.VERT_AIR) {
      if (input.olliePressed) this.wallPlant(wall, this.position.clone());
      else if (input.grindHeld) this.startWallRide(wall, this.position.clone());
    }
    if (!this.grounded) return;

    if (this.pendingBoardTransition) {
      const transition = this.pendingBoardTransition;
      this.pendingBoardTransition = null;
      const vertBoost = this.vertJumpTimer > 0 ? this.vertJumpPending : 0;
      this.takeoff(vertBoost, transition);
      return;
    }

    this.ensureBoardSafetyScratch();
    this._supportPreviousNormal.copy(this.normal);
    const support = this.ensureBoardContact().solveGround(
      this.position,
      before,
      this.heading,
      this._supportPreviousNormal,
      true,
    );

    if (!support.supported) {
      this.lastWheelSupport = null;
      const armedVert = this.vertJumpTimer > 0
        ? this.transitions.approachAt(this.position, this.normal, this.velocity)
        : null;
      if (armedVert) this.takeoff(this.vertJumpPending, armedVert);
      else this.takeoff();
      return;
    }

    const correctionAlongNormal = this._supportCorrection
      .copy(support.position)
      .sub(this.position)
      .dot(this._supportPreviousNormal);
    const normalContinuity = support.normal.dot(this._supportPreviousNormal);

    if (isUnsafeSupportDrop({
      contactCount: support.count || 0,
      maxWheelGap: support.maxWheelGap || 0,
      correctionAlongNormal,
      normalContinuity,
    })) {
      this.lastWheelSupport = null;
      this.takeoff();
      return;
    }

    const sign = this.velocity.dot(this.forward) < 0 ? -1 : 1;
    const speed = this.velocity.length() * sign;
    if (result.contacts.length && this.velocity.lengthSq() > 0.04) {
      this.heading = headingFrom(this.velocity, this.heading) + (sign < 0 ? Math.PI : 0);
    }

    this.position.copy(support.position);
    this.normal.copy(support.normal);
    this.lastWheelSupport = support;
    this.groundDirection();
    this.velocity.copy(this.forward).multiplyScalar(speed);

    if (this.manual) {
      const truckSupported = this.manual === 'noseManual' ? support.frontSupported : support.rearSupported;
      if (!truckSupported || Math.abs(speed) < 0.55) this.endManual();
    }
  }

  stepGround(dt, input, drive) {
    let speed = this.velocity.dot(this.forward);
    if (this.manual) this.updateManualBalance(dt, input, speed);
    if (this.bailTime) return;

    const rate = THREE.MathUtils.lerp(2.7, 1.2, clamp(Math.abs(speed) / 12, 0, 1));
    this.heading -= this.steer * rate * (speed < -0.15 ? -1 : 1) * dt;
    this.groundDirection();
    speed += (-PHYSICS.gravity * this.forward.y) * dt;

    const balanceDrive = Boolean(this.manual);
    if (!balanceDrive && drive > 0 && speed < PHYSICS.maxSpeed) speed += drive * PHYSICS.push * dt;
    const braking = input.brake || (!balanceDrive && drive < 0);
    const resistance = 0.26 + 0.012 * speed * speed + (braking ? PHYSICS.brake : 0);
    speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - resistance * dt);
    speed = clamp(speed, -17, 17);
    this.velocity.copy(this.forward).multiplyScalar(speed);

    this._boardMoveStart.copy(this.position);
    this.position.addScaledVector(this.velocity, dt);
    this.resolveSharpDeckClearance(
      this._boardMoveStart,
      this.position,
      this.velocity,
      this.heading,
      this.normal,
    );
    this.pendingBoardTransition = this.transitions.launchAt(this.position, this.normal, this.velocity);
  }
}
