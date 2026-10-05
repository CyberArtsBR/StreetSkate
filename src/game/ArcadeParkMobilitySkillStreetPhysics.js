import * as THREE from 'three';
import { SafeCopingExitSkillStreetPhysics } from './SafeCopingExitSkillStreetPhysics.js';
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

  // Extra ramp energy conversion. Flat-ground ollies are unchanged; the bonus
  // only exists when the board is genuinely climbing a sloped rideable face.
  rampSlopeThresholdY: 0.992,
  rampMinVerticalSpeed: 0.08,
  rampMinSpeed: 2.4,
  rampBoostMin: 1.75,
  rampBoostMax: 4.25,
  rampBoostFullSpeed: 12.5,
  rampOllieShare: 0.68,
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

export function arcadeTurnGain(speed, config = ARCADE_PARK_MOBILITY) {
  const t = clamp(Math.abs(Number(speed) || 0) / config.turnGainFullSpeed, 0, 1);
  return THREE.MathUtils.lerp(config.turnGainLowSpeed, config.turnGainHighSpeed, t);
}

export function arcadeRampAirBoost({
  speed = 0,
  normalY = 1,
  verticalSpeed = 0,
  config = ARCADE_PARK_MOBILITY,
} = {}) {
  const ny = Math.abs(Number(normalY) || 0);
  const magnitude = Math.abs(Number(speed) || 0);
  if (ny >= config.rampSlopeThresholdY
    || verticalSpeed <= config.rampMinVerticalSpeed
    || magnitude < config.rampMinSpeed) return 0;

  const slope = clamp((config.rampSlopeThresholdY - ny) / 0.72, 0, 1);
  const energy = clamp((magnitude - config.rampMinSpeed)
    / Math.max(0.1, config.rampBoostFullSpeed - config.rampMinSpeed), 0, 1);
  const quality = clamp(0.30 + slope * 0.48 + energy * 0.34, 0, 1);
  return THREE.MathUtils.lerp(config.rampBoostMin, config.rampBoostMax, quality);
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
 * - sloped takeoffs convert more approach energy into airtime;
 * - steering gets a tighter carve radius at park speeds.
 *
 * It deliberately sits ABOVE SafeCopingExit so the validated coping, vert return
 * and anti-tunnelling rules remain authoritative.
 */
export class ArcadeParkMobilitySkillStreetPhysics extends SafeCopingExitSkillStreetPhysics {
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

      // Prefer rails the current ballistic path is converging toward. We do not
      // hard-reject a nearly parallel handrail because THPS intentionally assists
      // those catches when Grind is being held.
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
    // Keep the precise skill capture first. The magnetic fallback only widens the
    // catch when the player explicitly asked to grind and the strict capture missed.
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

  takeoff(impulse = 0, transition = null) {
    const wasGrounded = this.grounded;
    const normalY = this.normal?.y ?? 1;
    const verticalSpeed = this.velocity?.y ?? 0;
    const speed = this.velocity?.length?.() || 0;
    const rampBoost = wasGrounded
      ? arcadeRampAirBoost({ speed, normalY, verticalSpeed })
      : 0;

    const extra = impulse > 0.1
      ? rampBoost * ARCADE_PARK_MOBILITY.rampOllieShare
      : rampBoost;
    return super.takeoff(Math.max(0, impulse) + extra, transition);
  }

  stepGround(dt, input = {}, drive = 0) {
    const originalSteer = this.steer;
    const speed = this.velocity?.length?.() || 0;
    const gain = this.manual
      ? ARCADE_PARK_MOBILITY.manualTurnGain
      : arcadeTurnGain(speed);
    this.steer = clamp(originalSteer * gain, -1.8, 1.8);
    try {
      super.stepGround(dt, input, drive);
    } finally {
      // Preserve the input smoothing state. Only the physical yaw response gets
      // amplified, so presentation/camera and regular/fakie controls stay stable.
      this.steer = originalSteer;
    }
  }
}
