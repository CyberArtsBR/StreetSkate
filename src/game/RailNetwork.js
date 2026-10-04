import * as THREE from 'three';
import {
  GRIND_CAPTURE,
  captureEligibility,
  contactLongitudinalOffsets,
  grindProfile,
  projectedGrindSpeed,
  railSurfaceHeight,
} from './SkateSystems.js';

const clamp = THREE.MathUtils.clamp;

export class RailNetwork {
  constructor(rails = []) {
    this.rails = rails.map((rail, railIndex) => {
      const points = rail.points.map(p => new THREE.Vector3(...p));
      const cumulative = [0];
      for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + points[i].distanceTo(points[i - 1]));
      const closed = points.length > 2 && points[0].distanceTo(points.at(-1)) < 0.6;
      const name = rail.name || `Rail ${railIndex + 1}`;
      return {
        name,
        points,
        cumulative,
        length: cumulative.at(-1) || 0,
        closed,
        radius: Math.max(0.04, rail.radius || 0.055),
        coping: /coping/i.test(name),
      };
    }).filter(rail => rail.length > 0.05);
  }

  nearest(position, maxDistance = 0.9) {
    let best = null;
    let bestDistance = maxDistance;
    for (const rail of this.rails) {
      for (let i = 1; i < rail.points.length; i++) {
        const a = rail.points[i - 1], b = rail.points[i];
        const edge = b.clone().sub(a);
        const lengthSq = edge.lengthSq();
        if (lengthSq < 1e-8) continue;
        const t = clamp(position.clone().sub(a).dot(edge) / lengthSq, 0, 1);
        const point = a.clone().addScaledVector(edge, t);
        const delta = position.clone().sub(point);
        const distance = delta.length();
        if (distance >= bestDistance || Math.abs(delta.y) > 0.95) continue;
        bestDistance = distance;
        const segmentLength = Math.sqrt(lengthSq);
        best = {
          rail, railName: rail.name, segment: i - 1, segmentT: t,
          s: rail.cumulative[i - 1] + segmentLength * t,
          point, tangent: edge.multiplyScalar(1 / segmentLength), distance,
        };
      }
    }
    return best;
  }

  capture(position, velocity, options = {}, legacyForward = null) {
    if (typeof options === 'number') options = { maxDistance: options, forward: legacyForward };
    const {
      maxDistance = GRIND_CAPTURE.distance,
      forward = new THREE.Vector3(0, 0, -1),
      trick = { name: '50-50' },
    } = options || {};
    const profile = grindProfile(trick?.name);
    const flatForward = forward.clone().setY(0);
    if (flatForward.lengthSq() < 1e-8) flatForward.set(0, 0, -1);
    flatForward.normalize();

    let best = null;
    for (const longitudinal of contactLongitudinalOffsets(profile)) {
      const contact = position.clone().addScaledVector(flatForward, longitudinal);
      const hit = this.nearest(contact, maxDistance + 0.18);
      if (!hit) continue;
      const surfaceY = railSurfaceHeight(hit.point.y, hit.rail.radius, profile.clearance);
      const surfaceDistance = Math.max(0, hit.distance - hit.rail.radius);
      const predictedContact = contact.clone().addScaledVector(velocity, GRIND_CAPTURE.predictionTime);
      const predicted = this.nearest(predictedContact, maxDistance + 0.18);
      const predictedDistance = predicted?.rail === hit.rail ? Math.max(0, predicted.distance - hit.rail.radius) : surfaceDistance;
      const trajectoryClosing = surfaceDistance - predictedDistance;
      const horizontal = velocity.clone().setY(0);
      const tangentHorizontal = hit.tangent.clone().setY(0);
      if (horizontal.lengthSq() < 1e-8 || tangentHorizontal.lengthSq() < 1e-8) continue;
      horizontal.normalize(); tangentHorizontal.normalize();
      const tangentAlignment = horizontal.dot(tangentHorizontal);
      const tangentSpeed = velocity.dot(hit.tangent);
      const eligibility = captureEligibility({
        surfaceDistance,
        verticalDelta: contact.y - surfaceY,
        velocityY: velocity.y,
        tangentAlignment,
        tangentSpeed,
        trajectoryClosing,
        trickName: profile.name,
      });
      if (!eligibility.eligible) continue;
      const score = surfaceDistance + Math.abs(contact.y - surfaceY) * 0.55;
      if (!best || score < best.score) {
        best = {
          score, rail: hit.rail, s: hit.s, point: hit.point, tangent: hit.tangent,
          direction: tangentSpeed >= 0 ? 1 : -1,
          speed: projectedGrindSpeed(tangentSpeed),
          projectedSpeed: Math.abs(tangentSpeed),
          surfaceDistance,
          verticalDelta: contact.y - surfaceY,
          trajectoryClosing,
          contactLongitudinal: longitudinal,
          profile,
        };
      }
    }
    return best;
  }

  sample(rail, s, { clearance = 0 } = {}) {
    if (rail.closed && rail.length > 0) s = ((s % rail.length) + rail.length) % rail.length;
    if (!rail.closed && (s < 0 || s > rail.length)) return null;
    s = clamp(s, 0, rail.length);
    let segment = 0;
    while (segment + 1 < rail.cumulative.length && rail.cumulative[segment + 1] < s) segment++;
    const a = rail.points[segment];
    const b = rail.points[Math.min(segment + 1, rail.points.length - 1)];
    const length = Math.max(1e-8, a.distanceTo(b));
    const t = clamp((s - rail.cumulative[segment]) / length, 0, 1);
    const center = a.clone().lerp(b, t);
    center.y = railSurfaceHeight(center.y, rail.radius, clearance);
    return { point: center, tangent: b.clone().sub(a).normalize(), s, radius: rail.radius, clearance };
  }
}
