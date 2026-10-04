import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

function closestSegmentPair(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;

  if (a <= 1e-8 && e <= 1e-8) {
    return { a: p1.clone(), b: p2.clone(), distance: p1.distanceTo(p2) };
  }
  if (a <= 1e-8) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-8) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      if (Math.abs(denom) > 1e-8) s = clamp((b * f - c * e) / denom, 0, 1);
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }

  const aPoint = p1.clone().addScaledVector(d1, s);
  const bPoint = p2.clone().addScaledVector(d2, t);
  return { a: aPoint, b: bPoint, distance: aPoint.distanceTo(bPoint) };
}

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

  capture(position, velocity, maxDistance = 0.9) {
    const hit = this.nearest(position, maxDistance);
    if (!hit) return null;
    const horizontal = velocity.clone();
    horizontal.y = 0;
    const tangentHorizontal = hit.tangent.clone();
    tangentHorizontal.y = 0;
    if (horizontal.lengthSq() > 0.2 && tangentHorizontal.lengthSq() > 0.01) {
      horizontal.normalize(); tangentHorizontal.normalize();
      if (Math.abs(horizontal.dot(tangentHorizontal)) < 0.16) return null;
    }
    const direction = velocity.dot(hit.tangent) >= 0 ? 1 : -1;
    return { rail: hit.rail, s: hit.s, direction, speed: Math.max(2.6, velocity.length()), point: hit.point, tangent: hit.tangent };
  }

  /** Solid-bar collision for rails when the rider is not already grinding them. */
  blockingContact(from, to, airborne = false) {
    const motion = to.clone().sub(from);
    if (motion.lengthSq() < 1e-8) return null;
    const probeHeights = airborne ? [0.08, 0.42, 0.82] : [0.16, 0.46, 0.88];
    let best = null;

    for (const rail of this.rails) {
      if (rail.coping) continue;
      for (let i = 1; i < rail.points.length; i++) {
        const a = rail.points[i - 1];
        const b = rail.points[i];
        for (const h of probeHeights) {
          const p0 = from.clone().addScaledVector(UP, h);
          const p1 = to.clone().addScaledVector(UP, h);
          const hit = closestSegmentPair(p0, p1, a, b);
          const clearance = rail.radius + (h < 0.25 ? 0.18 : 0.22);
          if (hit.distance >= clearance || (best && hit.distance >= best.distance)) continue;
          const normal = hit.a.clone().sub(hit.b);
          if (normal.lengthSq() < 1e-8) {
            normal.crossVectors(b.clone().sub(a).normalize(), UP);
            if (normal.dot(motion) > 0) normal.negate();
          } else normal.normalize();
          if (normal.dot(motion) > 0) normal.negate();
          best = { point: hit.b, normal, distance: hit.distance, rail };
        }
      }
    }
    return best;
  }

  sample(rail, s) {
    if (rail.closed && rail.length > 0) s = ((s % rail.length) + rail.length) % rail.length;
    if (!rail.closed && (s < 0 || s > rail.length)) return null;
    s = clamp(s, 0, rail.length);
    let segment = 0;
    while (segment + 1 < rail.cumulative.length && rail.cumulative[segment + 1] < s) segment++;
    const a = rail.points[segment];
    const b = rail.points[Math.min(segment + 1, rail.points.length - 1)];
    const length = Math.max(1e-8, a.distanceTo(b));
    const t = clamp((s - rail.cumulative[segment]) / length, 0, 1);
    return { point: a.clone().lerp(b, t).addScaledVector(UP, 0.035), tangent: b.clone().sub(a).normalize(), s };
  }
}
