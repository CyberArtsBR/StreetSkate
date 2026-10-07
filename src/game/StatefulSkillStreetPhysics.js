import * as THREE from 'three';
import { StableRampReturnSkillStreetPhysics } from './StableRampReturnSkillStreetPhysics.js';
import { ARCADE_PARK_MOBILITY } from './ArcadeParkMobilitySkillStreetPhysics.js';
import { MOVEMENT_STATE } from './StreetPhysics.js';
import {
  PUMP_CONFIG,
  computePumpEnergy,
  evaluatePumpEligibility,
  phaseFromMotion,
  pumpEventTier,
  pumpTimingQuality,
} from './PumpSystem.js';
import { OLLIE_COMMAND } from '../input/InputInterpreter.js';
import { CoreSkateController } from './core/CoreSkateController.js';
import { PlayerState } from './core/PlayerState.js';
import { legacyStateViolations } from './core/LegacyStateInvariants.js';
import { rampLaunchBonus, updateRampLaunchMemory } from './core/LaunchEnergyModel.js';
import { captureTakeoffContext } from './core/TakeoffContext.js';
import {
  applyLandingPostPipeline,
  captureLandingPostContext,
} from './core/LandingPostPipeline.js';

const clamp = THREE.MathUtils.clamp;

/** Skill-based transition pumping layered on top of board contact + vert physics. */
export class StatefulSkillStreetPhysics extends StableRampReturnSkillStreetPhysics {
  constructor(options = {}) {
    super(options);
    // Phase 1 composition root: canonical state, transition authority and body
    // collision are shared services instead of separate ownership hidden at
    // different prototype levels.
    this.coreController = new CoreSkateController({
      rails: options.rails || [],
      surface: this.surface,
      playerState: this.playerState,
    });
    this.coreController.bindLegacyRuntime(this);
    this.syncMovementState();
    this.syncCanonicalState();
  }

  syncMovementState() {
    if (this.bailTime > 0) this.movementState = MOVEMENT_STATE.BAIL;
    else if (this.grind) this.movementState = MOVEMENT_STATE.GRIND;
    else if (this.wallRide) this.movementState = MOVEMENT_STATE.WALLRIDE;
    else if (this.grounded) this.movementState = this.manual ? MOVEMENT_STATE.MANUAL : MOVEMENT_STATE.GROUND;
    else if (this.transitionAir) this.movementState = MOVEMENT_STATE.VERT_AIR;
    else this.movementState = MOVEMENT_STATE.AIR;
    return this.movementState;
  }

  syncCanonicalState() {
    this.playerState ||= new PlayerState();
    const canonical = this.coreController
      ? this.coreController.syncState(this)
      : this.playerState.syncFromLegacy(this);
    this.playerState = canonical;
    this.stateInvariantViolations = legacyStateViolations(this, canonical);
    return canonical;
  }

  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.landingYawInvariantViolations = 0;
    this.lastLandingYawInvariant = null;
    this.playerState ||= new PlayerState();
    this.stateInvariantViolations = [];
    this.syncMovementState();
    this.syncCanonicalState();
    this.rampLaunchMemory = 0;
    this.rampLaunchMemoryTime = 0;

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

  emitGameplayEvent(type, data = {}) { this.gameplayEvents.push({ type, ...data }); }
  drainGameplayEvents() { const events = this.gameplayEvents; this.gameplayEvents = []; return events; }

  rememberRampClimb(dt = 0) {
    if (this.coreController) return this.coreController.updateRampEnergy(this, dt);

    const sample = this.grounded
      ? rampLaunchBonus({
        speed: this.velocity?.length?.() || 0,
        normalY: this.normal?.y ?? 1,
        verticalSpeed: this.velocity?.y ?? 0,
      })
      : 0;
    const memory = updateRampLaunchMemory({
      previousBoost: this.rampLaunchMemory,
      previousTime: this.rampLaunchMemoryTime,
      sampleBoost: sample,
      dt,
    });
    this.rampLaunchMemory = memory.boost;
    this.rampLaunchMemoryTime = memory.time;
    return sample;
  }

  samplePumpContacts() {
    if (!this.grounded || this.movementState !== MOVEMENT_STATE.GROUND || this.manual || this.grind || this.wallRide || this.bailTime > 0) {
      return { support: null, contactCount: 0, normal: this.normal.clone(), contactSpread: 0 };
    }

    // Consume the exact wheel contacts that currently support the board. This
    // avoids a second approximate wheel rig and four extra terrain probes/step.
    const support = this.lastWheelSupport?.supported ? this.lastWheelSupport : null;
    if (!support) return { support: null, contactCount: 0, normal: this.normal.clone(), contactSpread: 0 };

    const normal = support.normal.clone().normalize();
    let contactSpread = 0;
    for (const wheel of support.contacts || []) {
      if (!wheel.valid) continue;
      contactSpread = Math.max(contactSpread, wheel.normal.angleTo(normal));
    }
    return { support, contactCount: support.count || 0, normal, contactSpread };
  }

  applyPump(quality, state) {
    const tangent = this.velocity.clone().projectOnPlane(state.normal);
    const tangentSpeed = tangent.length();
    if (tangentSpeed < 1e-6) return { nextSpeed: tangentSpeed, deltaSpeed: 0, specificEnergy: 0, capFactor: 1 };

    const compression = Math.max(this.charge, clamp(this.pumpHoldTime / 0.28, 0, 1));
    const geometryFactor = clamp(0.68 + state.contactCount * 0.07 + Math.min(state.curvature * 1.6, 0.12), 0.55, 1);
    const result = computePumpEnergy({ tangentSpeed, quality, compression, geometryFactor });
    if (result.deltaSpeed > 0) this.velocity.copy(tangent.normalize()).multiplyScalar(result.nextSpeed);

    this.pumpLastEnergy = result.specificEnergy;
    this.pumpLastDeltaSpeed = result.deltaSpeed;
    this.pumpTangentSpeed = result.nextSpeed;
    const data = { quality, energyAdded: result.specificEnergy, deltaSpeed: result.deltaSpeed, tangentSpeed: result.nextSpeed, phase: this.pumpPhase };
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
    const normalDelta = this.pumpPreviousNormal && contacts.contactCount ? this.pumpPreviousNormal.angleTo(supportNormal) : 0;
    if (contacts.contactCount) this.pumpPreviousNormal = supportNormal.clone();
    else if (!this.grounded) this.pumpPreviousNormal = null;

    this.pumpCurvatureMemory = Math.max(this.pumpCurvatureMemory, normalDelta, contacts.contactSpread);
    const tangent = this.velocity.clone().projectOnPlane(supportNormal);
    const tangentSpeed = tangent.length();
    const ridingAlignment = tangentSpeed > 1e-6 ? Math.abs(this.forward.dot(tangent.clone().normalize())) : 0;
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

    const transitionApproach = this.grounded && this.movementState === MOVEMENT_STATE.GROUND
      ? this.transitions.approachAt(this.position, this.normal, this.velocity) : null;
    const nearCoping = Boolean(transitionApproach?.supportsVert);
    this.pumpEligible = Boolean(eligibility.eligible && !nearCoping);

    if (input.ollieHeld && this.pumpEligible) this.pumpHoldTime += dt;
    // Preserve accumulated compression through the physical release frame.
    // Clearing before interpretation made a normal held->released input report
    // zero hold time and could make real pumps unreachable at runtime.
    else if (!input.ollieHeld && !input.ollieReleased) this.pumpHoldTime = 0;
    else if (!input.ollieReleased) this.pumpHoldTime *= Math.exp(-8 * dt);

    let releaseCommand = OLLIE_COMMAND.NONE;
    if (input.ollieReleased) {
      releaseCommand = this.coreController.interpretOllieRelease({
        ollieReleased: true,
        grinding: false,
        grounded: this.grounded,
        nearCoping,
        pumpEligible: this.pumpEligible,
        pumpHoldTime: this.pumpHoldTime,
        pumpCooldown: this.pumpCooldown,
        pumpMinHold: PUMP_CONFIG.minHold,
      });

      if (releaseCommand === OLLIE_COMMAND.PUMP) {
        this.applyPump(this.pumpQuality, { normal: supportNormal, contactCount: contacts.contactCount, curvature: eligibility.curvature });
        this.pumpCooldown = PUMP_CONFIG.cooldown;
        this.pumpState = 'PUMP';
        this.pumpPresentationTimer = 0.18;
        this.charge = 0; this.jumpBuffer = 0; this.jumpCharge = 0;
      } else if (releaseCommand === OLLIE_COMMAND.PUMP_BLOCKED) {
        this.charge = 0; this.jumpBuffer = 0; this.jumpCharge = 0;
      } else if (releaseCommand !== OLLIE_COMMAND.NONE) {
        // OLLIE, VERT_OLLIE and AIR_RELEASE keep their validated legacy execution.
        // The interpreter owns semantics; releaseJump remains the temporary executor.
        this.releaseJump();
      }
      this.pumpHoldTime = 0;
    }

    if (this.pumpDebugEnabled) {
      this.pumpDebug = {
        eligible: this.pumpEligible, contactCount: contacts.contactCount, slopeDeg: eligibility.slopeDeg,
        curvature: eligibility.curvature, normalDelta, contactSpread: contacts.contactSpread,
        phase: this.pumpPhase, timingQuality: this.pumpQuality, energyAdded: this.pumpLastEnergy,
        deltaSpeed: this.pumpLastDeltaSpeed, tangentSpeed: this.pumpTangentSpeed,
        cooldown: this.pumpCooldown, holdTime: this.pumpHoldTime,
        landingWindow: this.pumpLandingWindow, landingImpact: this.pumpLandingImpact,
        nearCoping,
        transitionId: transitionApproach?.transitionId ?? null,
        releaseCommand,
      };
    }
  }

  advance(delta, input = {}) {
    this.gameplayEvents = [];
    const immediateCommand = this.coreController.interpretOllieRelease({
      ollieReleased: Boolean(input.ollieReleased),
      grinding: Boolean(this.grind),
      grounded: this.grounded,
    });

    if (immediateCommand === OLLIE_COMMAND.GRIND_OLLIE_OUT) {
      // Preserve the validated immediate grind-pop timing, but execute the command
      // here so the base class never reinterprets this physical button release.
      this.exitGrind(true);
    } else if (input.ollieReleased) {
      this.pumpReleaseQueued = true;
    }

    // Preserve the former BaseStateful wrapper order exactly: semantic input
    // handling first, then canonical synchronization around lower execution.
    this.syncMovementState();
    this.syncCanonicalState();
    super.advance(delta, { ...input, ollieReleased: false });
    this.syncMovementState();
    this.syncCanonicalState();
  }

  step(dt, input = {}) {
    const releaseNow = this.pumpReleaseQueued;
    this.updatePumpState(dt, { ...input, ollieReleased: releaseNow });
    if (releaseNow) this.pumpReleaseQueued = false;

    this.syncMovementState();
    this.syncCanonicalState();
    super.step(dt, { ...input, ollieReleased: false });
    this.syncMovementState();
    this.syncCanonicalState();
  }

  stepGround(dt, input = {}, drive = 0) {
    // Capture climb energy before the lower ground solver can move the final
    // wheel across the lip and trigger takeoff.
    this.rememberRampClimb(dt);
    return super.stepGround(dt, input, drive);
  }

  takeoff(impulse = 0, transition = null) {
    // A support retry cannot restart an already active flight or recharge it.
    if (!this.grounded && this.transitionAir) return false;
    this.pumpEligible = false;
    this.pumpHoldTime = 0;
    this.pumpPreviousNormal = null;

    const context = this.coreController
      ? this.coreController.captureTakeoff(this, impulse, transition)
      : captureTakeoffContext({
        grounded: this.grounded,
        normal: this.normal,
        velocity: this.velocity,
        forward: this.forward,
        travelDirection: this.travelDirection,
        heading: this.heading,
        stance: this.stance,
        requestedImpulse: impulse,
        transition,
        rampLaunchMemory: this.rampLaunchMemory,
        rampLaunchMemoryTime: this.rampLaunchMemoryTime,
        rampExitIntentTime: this.rampExitIntentTime,
      });

    this.takeoffOllieRequested = context.requestedImpulse >= 4;
    const result = super.takeoff(context.composedImpulse, transition, context);
    if (context.rampContext) this.airTakeoffFromRamp = true;

    if (this.coreController) this.coreController.consumeRampEnergy(this);
    else {
      this.rampLaunchMemory = 0;
      this.rampLaunchMemoryTime = 0;
    }
    return result;
  }

  land(support) {
    if (this.deferLandingPostHooks) return super.land(support);

    const context = captureLandingPostContext(this, support, {
      rampReentrySlopeY: ARCADE_PARK_MOBILITY.rampReentrySlopeY,
    });

    this.deferLandingPostHooks = true;
    let landed = false;
    try {
      landed = super.land(support);
    } finally {
      this.deferLandingPostHooks = false;
    }
    if (!landed) return false;

    const lowerLayerHeading = this.heading;
    applyLandingPostPipeline(this, support, context, {
      lowerLayerHeading,
      rampReentrySteerLock: ARCADE_PARK_MOBILITY.rampReentrySteerLock,
      pumpLandingWindow: PUMP_CONFIG.landingWindow,
    });
    return true;
  }
}
