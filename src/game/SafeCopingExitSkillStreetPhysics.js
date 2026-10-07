import * as THREE from 'three';
import {
  DeckAwareRampExitSkillStreetPhysics,
  DECK_AWARE_EXIT,
  scanDeckTransferTarget,
} from './DeckAwareRampExitSkillStreetPhysics.js';
import { RAMP_WALL_SAFETY } from './RampWallSafetySkillStreetPhysics.js';
import { PRODUCTION_BOARD_CONTACT_RIG } from './SkateboardContactRig.js';
import { PHYSICS } from './StreetPhysics.js';
import { LANDING_ROUTE, resolveLandingRoute } from './landing/LandingPolicy.js';
import {
  resolveTransferLaunchResult,
  transferDeckCanFit,
} from './core/TransferLaunchResult.js';

export const SAFE_COPING_EXIT = Object.freeze({
  boardLength: PRODUCTION_BOARD_CONTACT_RIG.deckLength,
  edgeSafety: 0.18,
  minSafeDeckWidth: PRODUCTION_BOARD_CONTACT_RIG.deckLength + 0.36,

  recoveryOutwardMax: 0.34,
  recoveryInwardMax: 5.4,
  recoveryAboveLip: 0.42,
  recoveryBelowLip: 5.6,
  recoveryNormalMinY: 0.035,
  recoveryNormalMaxY: 0.985,
  recoveryNormalAlignment: 0.16,
  recoverySnapRise: 0.46,
  recoverySnapDrop: 0.72,

  // Continuous transition re-entry. The main airborne wheel sweep is normally
  // enough, but vert return needs a second pass oriented by the actual transition
  // normal so the board cannot cross a quarter/bowl face between fixed steps.
  continuousSweepExtra: 0.22,
  continuousContactSkin: 0.018,
  autoAlignSpinToleranceDeg: 38,
});

function horizontal(vector) {
  return vector.clone().setY(0);
}

/** Compatibility export backed by the canonical transfer-deck fit rule. */
export function deckCanFitBoard(control, config = SAFE_COPING_EXIT) {
  return transferDeckCanFit(control, config);
}

export function supportMatchesOriginalTransition(support, air,
  config = SAFE_COPING_EXIT) {
  if (!support?.position || !support?.normal || !air?.frame?.lipPoint
    || !air?.frame?.deckOutward || !air?.frame?.rampInward) return false;

  const ny = Math.abs(support.normal.y);
  if (ny < config.recoveryNormalMinY || ny > config.recoveryNormalMaxY) return false;

  const outward = horizontal(air.frame.deckOutward);
  const inward = horizontal(air.frame.rampInward);
  if (outward.lengthSq() < 1e-8 || inward.lengthSq() < 1e-8) return false;
  outward.normalize();
  inward.normalize();

  const fromLip = support.position.clone().sub(air.frame.lipPoint);
  const signedOutward = horizontal(fromLip).dot(outward);
  if (signedOutward > config.recoveryOutwardMax
    || signedOutward < -config.recoveryInwardMax) return false;

  const dy = support.position.y - air.frame.lipPoint.y;
  if (dy > config.recoveryAboveLip || dy < -config.recoveryBelowLip) return false;

  const horizontalNormal = horizontal(support.normal);
  if (horizontalNormal.lengthSq() < 1e-8) return false;
  horizontalNormal.normalize();
  if (horizontalNormal.dot(inward) < config.recoveryNormalAlignment) return false;

  return true;
}

/**
 * Legacy classification helper retained for tests/migration only. It no longer
 * authorizes an automatic heading correction at touchdown.
 */
export function transitionSpinAlignmentErrorDeg(airSpin = 0) {
  const degrees = Math.abs(Number(airSpin) || 0) * 180 / Math.PI;
  const remainder = degrees % 180;
  return Math.min(remainder, 180 - remainder);
}

/** Legacy compatibility classifier; contact yaw alignment itself is removed. */
export function canAutoAlignTransitionLanding(airSpin = 0,
  config = SAFE_COPING_EXIT) {
  return transitionSpinAlignmentErrorDeg(airSpin) <= config.autoAlignSpinToleranceDeg;
}

export function originalTransitionSweep(surface, from, to, air,
  config = SAFE_COPING_EXIT) {
  if (!surface?.sweepRideable || !from || !to || !air?.frame) return null;
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const hit = surface.sweepRideable(
    from,
    to,
    point,
    normal,
    config.continuousSweepExtra,
  );
  if (!hit) return null;
  const candidate = { position: point.clone(), normal: normal.clone() };
  if (!supportMatchesOriginalTransition(candidate, air, config)) return null;
  return {
    point: point.clone(),
    normal: normal.clone(),
    fraction: hit.fraction ?? 1,
  };
}

/**
 * Coping/transition safety layer based on captured gameplay:
 *  - narrow decks must fit the real board before a straight-out transfer is allowed;
 *  - missed transfers can reconnect to the original quarter/bowl;
 *  - vert return is swept using the transition normal, not only world UP;
 *  - re-entry contact may correct position/velocity but never horizontal yaw.
 */
export class SafeCopingExitSkillStreetPhysics extends DeckAwareRampExitSkillStreetPhysics {
  takeoff(impulse = 0, transition = null) {
    super.takeoff(impulse, transition);
    const air = this.transitionAir;
    if (!air?.transferring || !air.frame) return;

    // Single transfer-launch authority. Lower layers provide geometry services
    // and flight/landing behavior only; they no longer mutate launch state.
    const deck = scanDeckTransferTarget(this.surface, air.frame);
    const result = resolveTransferLaunchResult({
      frame: air.frame,
      incomingSpeed: air.frame.incomingSpeed,
      launchVertical: air.launchVertical,
      lateralVelocity: air.lateralVelocity,
      deck,
      gravity: PHYSICS.gravity,
      transferConfig: RAMP_WALL_SAFETY,
      deckConfig: DECK_AWARE_EXIT,
      copingConfig: SAFE_COPING_EXIT,
    });
    if (!result?.active) return;

    air.mode = result.mode;
    air.transferring = result.transferring;
    air.exitControl = result.exitControl ? { ...result.exitControl } : null;
    air.launchVertical = result.launchVertical;
    if (result.launchHorizontal) air.launchHorizontal = result.launchHorizontal.clone();
    this.velocity.copy(result.velocity);
  }

  /** Contact alignment is intentionally inert: only player input may change yaw. */
  autoAlignOriginalTransition() {}

  land(support) {
    const air = this.transitionAir;
    const control = air?.exitControl;
    const originalTransition = Boolean(air
      && supportMatchesOriginalTransition(support, air));
    const route = resolveLandingRoute({ originalTransition });

    if (route === LANDING_ROUTE.ORIGINAL_TRANSITION) {
      // Keep the call as a compatibility seam; it is deliberately yaw-inert.
      this.autoAlignOriginalTransition(support, air);

      // Any verified contact with the original ramp outranks deck-transfer
      // filtering. This applies to both normal transfers and abort-to-return.
      const wasGeometryAware = control?.geometryAware;
      const wasTransferring = air.transferring;
      if (control?.geometryAware) control.geometryAware = false;
      air.transferring = false;
      const landed = super.land(support);
      if (!landed && this.transitionAir === air) {
        if (control && wasGeometryAware !== undefined) control.geometryAware = wasGeometryAware;
        air.transferring = wasTransferring;
      }
      return landed;
    }

    return super.land(support);
  }

  makeEmergencyTransitionSupport(hit) {
    const normal = hit.normal.clone().normalize();
    const position = hit.point.clone().addScaledVector(
      normal,
      SAFE_COPING_EXIT.continuousContactSkin,
    );
    const leadingFront = this.velocity.dot(this.forward) >= 0;
    return {
      supported: true,
      count: 1,
      frontSupported: leadingFront ? 1 : 0,
      rearSupported: leadingFront ? 0 : 1,
      position,
      supportPoint: hit.point.clone(),
      normal,
      maxWheelGap: 0,
      contacts: [],
    };
  }

  tryContinuousTransitionReentry(activeAir, before) {
    if (!activeAir?.frame || this.grounded || this.transitionAir !== activeAir) return false;
    if (!(activeAir.apexPassed || this.velocity.y <= 0.8)) return false;

    const contact = this.ensureBoardContact();
    const referenceNormal = activeAir.frame.surfaceNormal?.clone?.()
      || this.normal.clone();
    if (referenceNormal.lengthSq() < 1e-8) referenceNormal.set(0, 1, 0);
    referenceNormal.normalize();

    // First retry the real four-wheel landing with a transition-oriented basis.
    const sweptSupport = contact.solveLanding(
      before,
      this.position,
      this.heading,
      referenceNormal,
      this.velocity,
    );
    if (sweptSupport?.supported
      && supportMatchesOriginalTransition(sweptSupport, activeAir)) {
      if (this.land(sweptSupport)) return true;
      if (this.bailTime > 0) {
        this.position.copy(sweptSupport.position);
        return true;
      }
    }

    // If triangulation still prevents wheel support, center-sweep the original
    // transition as a hard anti-tunnelling barrier. This is only accepted when
    // the hit belongs to the same coping frame, so other ramps/floors cannot steal it.
    const hit = originalTransitionSweep(this.surface, before, this.position, activeAir);
    if (!hit) return false;

    const candidate = hit.point.clone().addScaledVector(
      hit.normal,
      SAFE_COPING_EXIT.continuousContactSkin,
    );
    const resolved = contact.solveGround(
      candidate,
      before,
      this.heading,
      hit.normal,
      false,
    );

    let support = resolved?.supported ? resolved : null;
    if (!support || !supportMatchesOriginalTransition(support, activeAir)) {
      support = this.makeEmergencyTransitionSupport(hit);
    }

    this.position.copy(candidate);
    if (this.land(support)) return true;
    if (this.bailTime > 0) {
      this.position.copy(support.position);
      return true;
    }

    // Final invariant: once the original transition has been swept, never allow
    // the center to continue through it even if a future landing rule rejects.
    this.position.copy(support.position);
    const into = this.velocity.dot(support.normal);
    if (into < 0) this.velocity.addScaledVector(support.normal, -into);
    return true;
  }

  stepAir(dt, input, drive, before) {
    const activeAir = this.transitionAir;
    super.stepAir(dt, input, drive, before);

    if (!activeAir || this.grounded || this.transitionAir !== activeAir) return;
    if (this.tryContinuousTransitionReentry(activeAir, before)) return;

    if (this.velocity.y > 0) return;
    if (!activeAir.exitControl?.geometryAware) return;

    const support = this.ensureBoardContact().snapToGround(
      this.position,
      this.heading,
      SAFE_COPING_EXIT.recoverySnapRise,
      SAFE_COPING_EXIT.recoverySnapDrop,
    );
    if (!support?.supported || !supportMatchesOriginalTransition(support, activeAir)) return;
    this.land(support);
  }
}
