import * as THREE from 'three';
import { StatefulSkillStreetPhysics as BaseStatefulSkillStreetPhysics } from './BaseStatefulSkillStreetPhysics.js';
import { MOVEMENT_STATE } from './StreetPhysics.js';
import {
  PUMP_CONFIG,
  computePumpEnergy,
  evaluatePumpEligibility,
  phaseFromMotion,
  pumpEventTier,
  pumpTimingQuality,
  resolveOllieRelease,
} from './PumpSystem.js';

const clamp = THREE.MathUtils.clamp;

/**
 * Skill-based transition pumping layered on top of the validated four-wheel + vert physics.
 * It never identifies a ramp by name: eligibility comes from the current wheel support,
 * surface slope/normal progression, tangent motion and riding context.
 */
export class StatefulSkillStreetPhysics extends BaseStatefulSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.pumpReleaseQueued = false;
    this.pumpEligible = false;
    this.pumpPhase = 0.5;
    this.pumpQuality = 0;
    this.pumpHoldTime = 0;
    this.pumpCooldown = 0;
    this.pumpLandingWindow = 0;
    this.pumpLandingImpact = 0;
    this.pumpPreviousNormal = null;
    this.pumpCurvatureMemory = 0;
    this.pumpState = 'OFF';
    this.pumpPresentationTimer = 0;
    this.pumpLastEnergy = 0;
    this.pumpLastDeltaSpeed = 0;
    this.pumpTangentSpeed = 0;
    this.gameplayEvents = [];
    this.pumpDebugEnabled = typeof globalThis.location !== 'undefined'
      && new URLSearchParams(globalThis.location.search).get('debug') === '1';
    this.pumpDebug = this.pumpDebugEnabled ? {} : null;
  }

  emitGameplayEvent(type, data = {}) {
    this.gameplayEvents.push({ type, ...data });
  }

  drainGameplayEvents() {
    const events = this.gameplayEvents;
    this.gameplayEvents = [];
    return events;
  }

  samplePumpContacts() {
    if (!this.grounded || this.movementState !== MOVEMENT_STATE.GROUND || this.manual || this.grind || this.wallRide || this.bailTime > 0) {
      return { support: null, contactCount: 0, normal: this.normal.clone(), contactSpread: 0 };
    }

    const support = this.surface.wheelSupport(this.position, this.forward, this.normal, { rise: 0.24, drop: 0.42 });
    if (!support) return { support: null, contactCount: 0, normal: this.normal.clone(), contactSpread: 0 };

    const normal = support.normal.clone().normalize();
    let contactSpread = 0;
    for (const wheel of support.wheels || []) contactSpread = Math.max(contactSpread, wheel.normal.angleTo(normal));
    return { support, contactCount: support.wheelCount || 0, normal, contactSpread };
  }

  applyPump(quality, state) {
    const tangent = this.velocity.clone().projectOnPlane(state.normal);
    const tangentSpeed = tangent.length();
    if (tangentSpeed < 1e-6) return { nextSpeed: tangentSpeed, deltaSpeed: 0, specificEnergy: 0, capFactor: 1 };

    const compression = Math.max(this.charge, clamp(this.pumpHoldTime / 0.28, 0, 1));
    const geometryFactor = clamp(
      0.68 + state.contactCount * 0.07 + Math.min(state.curvature * 1.6, 0.12),
      0.55, 1,
    );
    const result = computePumpEnergy({ tangentSpeed, quality, compression, geometryFactor });
    if (result.deltaSpeed > 0) this.velocity.copy(tangent.normalize()).multiplyScalar(result.nextSpeed);

    this.pumpLastEnergy = result.specificEnergy;
    this.pumpLastDeltaSpeed = result.deltaSpeed;
    this.pumpTangentSpeed = result.nextSpeed;
    const data = {
      quality,
      energyAdded: result.specificEnergy,
      deltaSpeed: result.deltaSpeed,
      tangentSpeed: result.nextSpeed,
      phase: this.pumpPhase,
    };
    this.emitGameplayEvent('pump', data);
    const tier = pumpEventTier(quality);
    if (tier !== 'pump') this.emitGameplayEvent(tier, data);
    return result;
  }

  updatePumpState(dt, input) {
    this.pumpCooldown = Math.max(0, this.pumpCooldown - dt);
    this.pumpLandingWindow = Math.max(0, this.pumpLandingWindow - dt);
    this.pumpPresentationTimer = Math.max(0, this.pumpPresentationTimer - dt);
    if (this.pumpPresentationTimer <= 0) this.pumpState = 'OFF';
    this.pumpCurvatureMemory *= Math.exp(-9 * dt);

    const contacts = this.samplePumpContacts();
    const supportNormal = contacts.normal;
    const normalDelta = this.pumpPreviousNormal && contacts.contactCount
      ? this.pumpPreviousNormal.angleTo(supportNormal) : 0;
    if (contacts.contactCount) this.pumpPreviousNormal = supportNormal.clone();
    else if (!this.grounded) this.pumpPreviousNormal = null;

    this.pumpCurvatureMemory = Math.max(this.pumpCurvatureMemory, normalDelta, contacts.contactSpread);
    const tangent = this.velocity.clone().projectOnPlane(supportNormal);
    const tangentSpeed = tangent.length();
    const ridingAlignment = tangentSpeed > 1e-6
      ? Math.abs(this.forward.dot(tangent.clone().normalize())) : 0;
    const eligibility = evaluatePumpEligibility({
      contactCount: contacts.contactCount,
      normalY: supportNormal.y,
      normalDelta: this.pumpCurvatureMemory,
      contactSpread: contacts.contactSpread,
      tangentSpeed,
      ridingAlignment,
      landingWindow: this.pumpLandingWindow,
    });
    const phaseInfo = phaseFromMotion(supportNormal.y, this.velocity.y);
    this.pumpPhase = phaseInfo.phase;
    this.pumpQuality = pumpTimingQuality(this.pumpPhase);
    this.pumpTangentSpeed = tangentSpeed;

    const nearCoping = this.grounded && this.movementState === MOVEMENT_STATE.GROUND
      ? Boolean(this.transitions.approachAt(this.position, this.normal, this.velocity)) : false;
    this.pumpEligible = Boolean(eligibility.eligible && !nearCoping);

    if (input.ollieHeld && this.pumpEligible) this.pumpHoldTime += dt;
    else if (!input.ollieHeld) this.pumpHoldTime = 0;
    else this.pumpHoldTime *= Math.exp(-8 * dt);

    let releaseAction = null;
    if (input.ollieReleased) {
      releaseAction = resolveOllieRelease({
        grounded: this.grounded,
        pumpEligible: this.pumpEligible,
        holdTime: this.pumpHoldTime,
        cooldown: this.pumpCooldown,
        nearCoping,
      });

      if (releaseAction === 'pump') {
        this.applyPump(this.pumpQuality, {
          normal: supportNormal,
          contactCount: contacts.contactCount,
          curvature: eligibility.curvature,
        });
        this.pumpCooldown = PUMP_CONFIG.cooldown;
        this.pumpState = 'PUMP';
        this.pumpPresentationTimer = 0.18;
        this.charge = 0;
        this.jumpBuffer = 0;
        this.jumpCharge = 0;
      } else if (releaseAction === 'pumpBlocked') {
        // A release during the refractory period is still a pump attempt, never an accidental Ollie.
        this.charge = 0;
        this.jumpBuffer = 0;
        this.jumpCharge = 0;
      } else {
        // Flat/near-coping releases and airborne jump buffering retain the existing Ollie semantics.
        this.releaseJump();
      }
      this.pumpHoldTime = 0;
    }

    if (this.pumpDebugEnabled) {
      this.pumpDebug = {
        eligible: this.pumpEligible,
        contactCount: contacts.contactCount,
        slopeDeg: eligibility.slopeDeg,
        curvature: eligibility.curvature,
        normalDelta,
        contactSpread: contacts.contactSpread,
        phase: this.pumpPhase,
        timingQuality: this.pumpQuality,
        energyAdded: this.pumpLastEnergy,
        deltaSpeed: this.pumpLastDeltaSpeed,
        tangentSpeed: this.pumpTangentSpeed,
        cooldown: this.pumpCooldown,
        holdTime: this.pumpHoldTime,
        landingWindow: this.pumpLandingWindow,
        landingImpact: this.pumpLandingImpact,
        nearCoping,
        releaseAction,
      };
    }
  }

  advance(delta, input = {}) {
    this.gameplayEvents = [];
    const grindRelease = Boolean(this.grind && input.ollieReleased);
    if (input.ollieReleased && !this.grind) this.pumpReleaseQueued = true;
    super.advance(delta, { ...input, ollieReleased: grindRelease });
  }

  step(dt, input = {}) {
    const releaseNow = this.pumpReleaseQueued;
    this.updatePumpState(dt, { ...input, ollieReleased: releaseNow });
    if (releaseNow) this.pumpReleaseQueued = false;
    super.step(dt, { ...input, ollieReleased: false });
  }

  takeoff(impulse = 0, transition = null) {
    this.pumpEligible = false;
    this.pumpHoldTime = 0;
    this.pumpPreviousNormal = null;
    super.takeoff(impulse, transition);
  }

  land(support) {
    const impactSpeed = Math.max(0, -this.velocity.dot(support.normal));
    const landed = super.land(support);
    if (!landed) return false;
    this.pumpLandingWindow = PUMP_CONFIG.landingWindow;
    this.pumpLandingImpact = clamp(impactSpeed / 8, 0, 1);
    this.pumpPreviousNormal = support.normal.clone();
    return true;
  }
}
