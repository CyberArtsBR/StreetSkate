import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class RailNetwork {
  constructor(rails = []) {
    this.rails = rails.map((rail, railIndex) => {
      const points = rail.points.map(p => new THREE.Vector3(...p));
      const cumulative = [0];
      for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + points[i].distanceTo(points[i - 1]));
      const closed = points.length > 2 && points[0].distanceTo(points.at(-1)) < 0.6;
      return { name: rail.name || `Rail ${railIndex + 1}`, points, cumulative, length: cumulative.at(-1) || 0, closed };
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
        const t = THREE.MathUtils.clamp(position.clone().sub(a).dot(edge) / lengthSq, 0, 1);
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

  sample(rail, s) {
    if (rail.closed && rail.length > 0) s = ((s % rail.length) + rail.length) % rail.length;
    if (!rail.closed && (s < 0 || s > rail.length)) return null;
    s = THREE.MathUtils.clamp(s, 0, rail.length);
    let segment = 0;
    while (segment + 1 < rail.cumulative.length && rail.cumulative[segment + 1] < s) segment++;
    const a = rail.points[segment];
    const b = rail.points[Math.min(segment + 1, rail.points.length - 1)];
    const length = Math.max(1e-8, a.distanceTo(b));
    const t = THREE.MathUtils.clamp((s - rail.cumulative[segment]) / length, 0, 1);
    return { point: a.clone().lerp(b, t).addScaledVector(UP, 0.035), tangent: b.clone().sub(a).normalize(), s };
  }
}
