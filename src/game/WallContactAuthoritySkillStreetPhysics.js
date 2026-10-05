import * as THREE from 'three';
import { ArcadeParkMobilitySkillStreetPhysics } from './ArcadeParkMobilitySkillStreetPhysics.js';
import { MOMENTUM_ROLL } from './MomentumRollSkillStreetPhysics.js';

const UP = new THREE.Vector3(0, 1, 0);

export const WALL_CONTACT_AUTHORITY = Object.freeze({
  groundMinY: 0.92,
  maxVerticalSpeed: 1.05,
  faceMaxY: 0.18,
  lowHeight: 0.30,
  highHeight: 0.96,
  lateralHeight: 0.62,
  lateralHalfWidth: 0.30,
  normalContinuity: 0.82,
  probePadding: 0.34,
  minProbeReach: 0.38,
  bodyClearance: 0.265,
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

export function wallFaceContextAllows({
  groundNormalY = 1,
  verticalSpeed = 0,
  hitNormalY = 0,
  config = WALL_CONTACT_AUTHORITY,
} = {}) {
  return Math.abs(Number(groundNormalY) || 0) >= config.groundMinY
    && Math.abs(Number(verticalSpeed) || 0) <= config.maxVerticalSpeed
    && Math.abs(Number(hitNormalY) || 0) <= config.faceMaxY;
}

/**
 * A real wall must look like a broad vertical plane, not one isolated rail/post.
 * We require the same face at low + torso height and at least one lateral sample.
 */
export function wallFaceContinuityAllows({
  low = false,
  high = false,
  lateralLeft = false,
  lateralRight = false,
} = {}) {
  return Boolean(low && high && (lateralLeft || lateralRight));
}

export function wallClearanceCorrection(distanceAlongNormal = Infinity,
  config = WALL_CONTACT_AUTHORITY) {
  const distance = Number(distanceAlongNormal);
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, config.bodyClearance - distance);
}

/**
 * Final wall-contact authority:
 * - bevelled/triangulated real walls can still trigger the intended ~90° recovery;
 * - a thin handrail/post cannot trigger it just because one ray happened to hit;
 * - the rider is kept outside the wall capsule before redirecting, preventing the
 *   recovery turn from starting from an already-clipped position.
 */
export class WallContactAuthoritySkillStreetPhysics extends ArcadeParkMobilitySkillStreetPhysics {
  wallPlaneRay(origin, direction, reach, referenceNormal = null) {
    const ray = this.surface.ray;
    ray.set(origin, direction);
    ray.far = reach;

    for (const hit of ray.intersectObjects(this.surface.meshes, false)) {
      // Authored grind rails must never masquerade as a collision wall.
      if (hit.object?.userData?.railId) continue;

      const normal = this.surface.normal(hit, new THREE.Vector3());
      if (normal.dot(direction) > 0) normal.negate();
      if (!wallFaceContextAllows({
        groundNormalY: this.normal.y,
        verticalSpeed: this.velocity.y,
        hitNormalY: normal.y,
      })) continue;

      const approach = -normal.dot(direction);
      if (approach < MOMENTUM_ROLL.wallImpactMinApproach) continue;
      if (referenceNormal && normal.dot(referenceNormal) < WALL_CONTACT_AUTHORITY.normalContinuity) continue;

      return {
        point: hit.point.clone(),
        normal,
        distance: hit.distance,
        object: hit.object,
        approach,
      };
    }
    return null;
  }

  detectGroundWallImpact(dt) {
    if (!this.grounded || this.grind || this.wallRide || this.bailTime > 0
      || this.wallImpactCooldown > 0 || (this.rampReentrySteerLock || 0) > 0) return null;

    if (!wallFaceContextAllows({
      groundNormalY: this.normal.y,
      verticalSpeed: this.velocity.y,
      hitNormalY: 0,
    })) return null;

    const horizontalVelocity = this.velocity.clone().setY(0);
    const speed = horizontalVelocity.length();
    if (speed < MOMENTUM_ROLL.wallImpactMinSpeed) return null;
    const direction = horizontalVelocity.multiplyScalar(1 / speed);
    const reach = Math.max(
      WALL_CONTACT_AUTHORITY.minProbeReach,
      speed * dt + WALL_CONTACT_AUTHORITY.probePadding,
    );

    const forwardOffset = 0.035;
    const lowOrigin = this.position.clone()
      .addScaledVector(UP, WALL_CONTACT_AUTHORITY.lowHeight)
      .addScaledVector(direction, forwardOffset);
    const low = this.wallPlaneRay(lowOrigin, direction, reach);
    if (!low) return null;

    const highOrigin = this.position.clone()
      .addScaledVector(UP, WALL_CONTACT_AUTHORITY.highHeight)
      .addScaledVector(direction, forwardOffset);
    const high = this.wallPlaneRay(highOrigin, direction, reach, low.normal);
    if (!high) return null;

    // Requiring lateral continuity rejects stair handrails and narrow posts while
    // still accepting a real wall even if the board hits close to one wall edge.
    const tangent = new THREE.Vector3(low.normal.z, 0, -low.normal.x).normalize();
    const lateralBase = this.position.clone()
      .addScaledVector(UP, WALL_CONTACT_AUTHORITY.lateralHeight)
      .addScaledVector(direction, forwardOffset);
    const left = this.wallPlaneRay(
      lateralBase.clone().addScaledVector(tangent, WALL_CONTACT_AUTHORITY.lateralHalfWidth),
      direction,
      reach,
      low.normal,
    );
    const right = this.wallPlaneRay(
      lateralBase.clone().addScaledVector(tangent, -WALL_CONTACT_AUTHORITY.lateralHalfWidth),
      direction,
      reach,
      low.normal,
    );

    if (!wallFaceContinuityAllows({ low, high, lateralLeft: left, lateralRight: right })) return null;

    const normal = low.normal.clone().add(high.normal).normalize();
    return {
      point: low.point.clone(),
      normal,
      approach: Math.max(low.approach, high.approach),
      speed,
      distance: Math.min(low.distance, high.distance),
      broadWall: true,
    };
  }

  applyWallRecovery(hit) {
    if (!hit) return false;

    // Keep the body capsule outside the wall before the 90° tangent redirect.
    // This is deliberately only for a verified broad wall; rails/posts are never
    // allowed to teleport the rider sideways.
    const signedDistance = this.position.clone().sub(hit.point).dot(hit.normal);
    const correction = wallClearanceCorrection(signedDistance);
    if (correction > 0) this.position.addScaledVector(hit.normal, correction);

    return super.applyWallRecovery(hit);
  }
}
