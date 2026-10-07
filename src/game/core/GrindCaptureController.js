import * as THREE from 'three';
import {
  contactLongitudinalOffsets,
  grindProfile,
  projectedGrindSpeed,
  railSurfaceHeight,
} from '../SkateSystems.js';

const clamp = THREE.MathUtils.clamp;

export const GRIND_CAPTURE_POLICY = Object.freeze({
  railCaptureDistance: 0.52,
  railCaptureAbove: 0.46,
  railCaptureBelow: 0.44,
  railMaxRiseVelocity: 4.2,
  railPredictionTime: 0.16,
  railAlignmentRelax: 0.58,
  railMaxAlignmentSlack: 0.16,
  railMinTangentSpeed: 0.12,
  railBlendTime: 0.14,
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

/**
 * Pure THPS-style rail capture eligibility.
 *
 * This function owns only the decision boundary. It does not mutate player,
 * rail, trick, camera or movement state.
 */
export function grindCaptureEligibility({
  surfaceDistance = Infinity,
  verticalDelta = 0,
  velocityY = 0,
  tangentAlignment = 0,
  tangentSpeed = 0,
  profile = grindProfile('50-50'),
  config = GRIND_CAPTURE_POLICY,
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
 * Canonical magnetic grind-capture query.
 *
 * Geometry evidence comes from RailNetwork; this function only ranks eligible
 * contacts and returns an immutable-ish capture description. The caller remains
 * responsible for entering grind state.
 */
export function resolveMagneticGrindCapture({
  position,
  forward,
  velocity,
  railNetwork,
  trick = null,
  gravity = 20,
  config = GRIND_CAPTURE_POLICY,
} = {}) {
  if (!position?.clone || !velocity?.clone || !railNetwork?.nearest) return null;

  const profile = grindProfile(trick?.name);
  const flatForward = horizontal(forward, velocity);
  let best = null;

  for (const longitudinal of contactLongitudinalOffsets(profile)) {
    const contact = position.clone().addScaledVector(flatForward, longitudinal);
    const hit = railNetwork.nearest(contact, config.railCaptureDistance + 0.20);
    if (!hit) continue;

    const surfaceY = railSurfaceHeight(hit.point.y, hit.rail.radius, profile.clearance);
    const verticalDelta = contact.y - surfaceY;
    const surfaceDistance = Math.max(0, hit.distance - hit.rail.radius);
    const horizontalVelocity = horizontal(velocity, flatForward);
    const tangentHorizontal = horizontal(hit.tangent);
    const tangentAlignment = horizontalVelocity.dot(tangentHorizontal);
    const tangentSpeed = velocity.dot(hit.tangent);

    if (!grindCaptureEligibility({
      surfaceDistance,
      verticalDelta,
      velocityY: velocity.y,
      tangentAlignment,
      tangentSpeed,
      profile,
      config,
    })) continue;

    const predictedContact = contact.clone().addScaledVector(
      velocity,
      config.railPredictionTime,
    );
    predictedContact.y -= 0.5 * gravity * config.railPredictionTime ** 2;
    const predicted = railNetwork.nearest(
      predictedContact,
      config.railCaptureDistance + 0.22,
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
