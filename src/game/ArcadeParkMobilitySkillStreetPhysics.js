import * as THREE from 'three';
import {
  SafeCopingExitSkillStreetPhysics,
  canAutoAlignTransitionLanding,
  supportMatchesOriginalTransition,
} from './SafeCopingExitSkillStreetPhysics.js';
import {
  GRIND_CAPTURE,
  contactLongitudinalOffsets,
  createBalanceState,
  grindProfile,
  projectedGrindSpeed,
  railSurfaceHeight,
} from './SkateSystems.js';

const clamp = THREE.MathUtils.clamp;

export const ARCADE_PARK_MOBILITY = Object.freeze({
  // THPS-style rail magnetism. This is only consulted while airborne with an
  // explicit grind intent, so normal riding cannot snap to nearby rails.
  railCaptureDistance: 0.52,
  railCaptureAbove: 0.46,
  railCaptureBelow: 0.44,
  railMaxRiseVelocity: 4.2,
  railPredictionTime: 0.16,
  railAlignmentRelax: 0.58,
  railMaxAlignmentSlack: 0.16,
  railMinTangentSpeed: 0.12,
  railBlendTime: 0.14,

  // Tighter arcade carving without changing regular/fakie semantics.
  turnGainLowSpeed: 1.55,
  turnGainHighSpeed: 1.78,
  turnGainFullSpeed: 12.5,
  manualTurnGain: 1.14,

  // Re-entry steering protection. A steep transition has almost no horizontal
  // tangent near vertical, so tiny lateral drift must never become a 90-degree
  // heading snap on the first grounded frame. Lock steering/wall recovery very
  // briefly, then blend the tighter carve back in.
  rampReentrySteerLock: 0.20,
  rampReentryHardLock: 0.08,
  rampReentrySlopeY: 0.995,
});

function horizontal(source, fallback = null) {
  const out = source?.clone?.() || new THREE.Vector3();
  out.y = 0;
  if (out.lengthSq() > 1e-8) return out.normalize();
  if (fallback?.lengthSq?.() > 1e-8) {
    out.copy(fallback).setY(0);
    if (out.lengthSq() > 1e-8) return out.normalize();
  }
  return out.set(0, 0, -1);
}

function headingFrom(direction, fallback = 0) {
  const flat = horizontal(direction);
  if (flat.lengthSq() < 1e-8) return fallback;
  return Math.atan2(-flat.x, -flat.z);
}

export function arcadeTurnGain(speed, config = ARCADE_PARK_MOBILITY) {
  const t = clamp(Math.abs(Number(speed) || 0) / config.turnGainFullSpeed, 0, 1);
  return THREE.MathUtils.lerp(config.turnGainLowSpeed, config.turnGainHighSpeed, t);
}

export function rampReentrySteerScale(remaining = 0, config = ARCADE_PARK_MOBILITY) {
  const left = Math.max(0, Number(remaining) || 0);
  if (left <= 0) return 1;
  const elapsed = Math.max(0, config.rampReentrySteerLock - left);
  if (elapsed <= config.rampReentryHardLock) return 0;
  const blendDuration = Math.max(0.001,
    config.rampReentrySteerLock - config.rampReentryHardLock);
  return clamp((elapsed - config.rampReentryHardLock) / blendDuration, 0, 1);
}

/**
 * Stable board-facing direction for vert return. Near the vertical section of a
 * quarter/pool, projecting velocity onto the transition can leave almost zero XZ
 * magnitude. Any tiny sideways drift then dominates and can rotate heading 90°.
 * The authored local ramp axis is the authoritative horizontal reference; spins
 * only decide whether the deck faces with or against that travel direction.
 */
export function transitionReturnBoardDirection({
  rampInward = null,
  fallbackTravel = null,
  rollingSign = 1,
  airSpin = 0,
} = {}) {
  const travel = horizontal(rampInward, fallbackTravel);
  const halfTurns = Math.round((Math.abs(Number(airSpin) || 0) * 180 / Math.PI) / 180);
  const initialDeckSign = rollingSign < 0 ? -1 : 1;
  const spinSign = halfTurns % 2 === 1 ? -1 : 1;
  return travel.multiplyScalar(initialDeckSign * spinSign);
}

export function arcadeGrindEligibility({
  surfaceDistance = Infinity,
  verticalDelta = 0,
  velocityY = 0,
  tangentAlignment = 0,
  tangentSpeed = 0,
  profile = grindProfile('50-50'),
  config = ARCADE_PARK_MOBILITY,
} = {}) {
  if (velocityY > config.railMaxRiseVelocity) return false;
  if (surfaceDistance > config.railCaptureDistance) return false;
  if (verticalDelta < -config.railCaptureBelow || verticalDelta > config.railCaptureAbove) return false;

  const alignment = Math.abs(tangentAlignment);
  const minAlignment = Math.max(0.08, profile.approach.minAlignment * config.railAlignmentRelax);
  const maxAlignment = Math.min(1, profile.approach.maxAlignment + config.railMaxAlignmentSlack);
  if (alignment < minAlignment || alignment > maxAlignment) return false;
  if (Math.abs(tangentSpeed) < Math.min(profile.approach.minTangentSpeed, config.railMinTangentSpeed)) return false;
  return true;
}

/**
 * THPS-like park mobility layer:
 * - explicit grind input gets a forgiving airborne rail/handrail magnet;
 * - steering gets a tighter carve radius at park speeds;
 * - transition re-entry keeps a stable ramp-axis heading and cannot trigger a
 *   false 90-degree wall recovery immediately after touchdown.
 *
 * Ramp launch energy is intentionally NOT owned here anymore. Phase 1 moved all
 * ramp bonus composition to LaunchEnergyModel / UnifiedRampFeel so this layer can
 * never inject a second hidden takeoff boost.
 */
export class ArcadeParkMobilitySkillStreetPhysics extends SafeCopingExitSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.rampReentrySteerLock = 0;
  }

  autoAlignOriginalTransition(support, air) {
    if (!supportMatchesOriginalTransition(support, air)) return;
    if (!canAutoAlignTransitionLanding(this.airSpin)) return;

    const desiredBoard = transitionReturnBoardDirection({
      rampInward: air.frame?.rampInward,
      fallbackTravel: this.travelDirection || this.velocity,
      rollingSign: this.rollingSign,
      airSpin: this.airSpin,
    });
    this.heading = headingFrom(desiredBoard, this.heading);
    this.airDirection();
  }

  land(support) {
    const wasTransitionAir = Boolean(this.transitionAir);
    const slopedTouchdown = Math.abs(support?.normal?.y ?? 1)
      < ARCADE_PARK_MOBILITY.rampReentrySlopeY;
    const landed = super.land(support);
    if (landed && (wasTransitionAir || slopedTouchdown)) {
      this.rampReentrySteerLock = ARCADE_PARK_MOBILITY.rampReentrySteerLock;
    }
    return landed;
  }

  detectGroundWallImpact(dt) {
    // Legacy wall recovery is suppressed during the transition touchdown bridge.
    // Final NoAutomaticYaw also disables automatic wall turning globally.
    if ((this.rampReentrySteerLock || 0) > 0) return null;
    return super.detectGroundWallImpact(dt);
  }

  magneticRailCapture(trick) {
    const profile = grindProfile(trick?.name);
    const flatForward = horizontal(this.forward, this.velocity);
    let best = null;

    for (const longitudinal of contactLongitudinalOffsets(profile)) {
      const contact = this.position.clone().addScaledVector(flatForward, longitudinal);
      const hit = this.railNetwork.nearest(contact, ARCADE_PARK_MOBILITY.railCaptureDistance + 0.20);
      if (!hit) continue;

      const surfaceY = railSurfaceHeight(hit.point.y, hit.rail.radius, profile.clearance);
      const verticalDelta = contact.y - surfaceY;
      const surfaceDistance = Math.max(0, hit.distance - hit.rail.radius);
      const horizontalVelocity = horizontal(this.velocity, flatForward);
      const tangentHorizontal = horizontal(hit.tangent);
      const tangentAlignment = horizontalVelocity.dot(tangentHorizontal);
      const tangentSpeed = this.velocity.dot(hit.tangent);

      if (!arcadeGrindEligibility({
        surfaceDistance,
        verticalDelta,
        velocityY: this.velocity.y,
        tangentAlignment,
        tangentSpeed,
        profile,
      })) continue;

      const predictedContact = contact.clone().addScaledVector(
        this.velocity,
        ARCADE_PARK_MOBILITY.railPredictionTime,
      );
      predictedContact.y -= 0.5 * 20 * ARCADE_PARK_MOBILITY.railPredictionTime ** 2;
      const predicted = this.railNetwork.nearest(
        predictedContact,
        ARCADE_PARK_MOBILITY.railCaptureDistance + 0.22,
      );
      const predictedDistance = predicted?.rail === hit.rail
        ? Math.max(0, predicted.distance - hit.rail.radius)
        : surfaceDistance + 0.08;
      const closingBonus = clamp(surfaceDistance - predictedDistance, -0.08, 0.18);
      const score = surfaceDistance + Math.abs(verticalDelta) * 0.42 - closingBonus * 0.55;

      if (!best || score < best.score) {
        best = {
          score,
          rail: hit.rail,
          s: hit.s,
          point: hit.point,
          tangent: hit.tangent,
          direction: tangentSpeed >= 0 ? 1 : -1,
          speed: projectedGrindSpeed(tangentSpeed),
          projectedSpeed: Math.abs(tangentSpeed),
          surfaceDistance,
          verticalDelta,
          contactLongitudinal: longitudinal,
          profile,
        };
      }
    }
    return best;
  }

  enterGrind(trick) {
    if (super.enterGrind(trick)) return true;

    const capture = this.magneticRailCapture(trick);
    if (!capture) return false;
    const sample = this.railNetwork.sample(capture.rail, capture.s, {
      clearance: capture.profile.clearance,
    });
    if (!sample) return false;

    this.grind = {
      ...capture,
      trick: { ...trick, name: capture.profile.name },
      profile: capture.profile,
      speed: capture.speed,
      time: 0,
      balance: 0,
      balanceState: createBalanceState(1.18),
      instability: 0,
      blendElapsed: 0,
      blendDuration: ARCADE_PARK_MOBILITY.railBlendTime,
      blendPosition: this.position.clone(),
      incomingVelocity: this.velocity.clone(),
      entryHeading: this.heading,
      contactClearance: capture.profile.clearance,
      contactClearanceTarget: capture.profile.clearance,
      magneticEntry: true,
    };
    this.grindBalanceState = this.grind.balanceState;
    this.grindBalance = 0;
    this.grounded = false;
    this.manual = null;
    this.flatland = null;
    this.transitionAir = null;
    this.wallRide = null;
    this.airHeading = this.heading;
    this.recordTrick(this.grind.trick.name, this.grind.trick.points || 100);
    this.stableGroundTime = 0;
    this.ensureBoardContact().clearContacts();
    this.lastWheelSupport = null;
    return true;
  }

  stepGround(dt, input = {}, drive = 0) {
    this.rampReentrySteerLock = Math.max(0,
      (this.rampReentrySteerLock || 0) - dt);

    const originalSteer = this.steer;
    const speed = this.velocity?.length?.() || 0;
    const gain = this.manual
      ? ARCADE_PARK_MOBILITY.manualTurnGain
      : arcadeTurnGain(speed);
    const reentryScale = rampReentrySteerScale(this.rampReentrySteerLock);
    this.steer = clamp(originalSteer * gain * reentryScale, -1.8, 1.8);
    try {
      super.stepGround(dt, input, drive);
    } finally {
      // Preserve the input smoothing state. Only the physical yaw response gets
      // amplified, so presentation/camera and regular/fakie controls stay stable.
      this.steer = originalSteer;
    }
  }
}
