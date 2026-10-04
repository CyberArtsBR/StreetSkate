import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const CAPTURE_SCALE = 1.3;

/** Curved bowl/quarter-pipe coping paths use a locked vertical-air rule. */
export class TransitionGuide {
  constructor(rails = []) {
    this.edges = [];
    for (const rail of rails) {
      if (!/coping/i.test(rail.name)) continue;
      for (let i = 1; i < rail.points.length; i++) {
        this.edges.push({
          a: new THREE.Vector3(...rail.points[i - 1]),
          b: new THREE.Vector3(...rail.points[i]),
          name: rail.name,
        });
      }
    }
  }

  candidate(position, normal, velocity, { maxGap, below, above, maxNormalY, minAlignment }) {
    if (!normal || normal.y > maxNormalY) return null;
    const outward = normal.clone().setY(0);
    if (outward.lengthSq() < 1e-6) return null;
    outward.normalize().negate();
    const horizontal = velocity.clone().setY(0);
    if (horizontal.lengthSq() > 0.001 && horizontal.normalize().dot(outward) < minAlignment) return null;

    let closest = null;
    let distance = maxGap;
    for (const edgeInfo of this.edges) {
      const { a, b } = edgeInfo;
      const edge = b.clone().sub(a).setY(0);
      const t = THREE.MathUtils.clamp(
        position.clone().sub(a).setY(0).dot(edge) / Math.max(edge.lengthSq(), 1e-8), 0, 1,
      );
      const lip = a.clone().lerp(b, t);
      const gap = position.clone().sub(lip).setY(0).length();
      const lipSurfaceY = lip.y - 0.025;
      if (gap >= distance || position.y < lipSurfaceY - below || position.y > lipSurfaceY + above) continue;
      closest = { lip, outward, normal: normal.clone(), name: edgeInfo.name, gap };
      distance = gap;
    }
    return closest;
  }

  /** A wider zone used to hold a released ollie until the rider reaches the coping. */
  approachAt(position, normal, velocity) {
    if (velocity.y < 0.05) return null;
    return this.candidate(position, normal, velocity, {
      maxGap: 1.45 * CAPTURE_SCALE,
      below: 1.55 * CAPTURE_SCALE,
      above: 0.28 * CAPTURE_SCALE,
      maxNormalY: 0.86,
      minAlignment: 0.12,
    });
  }

  /** Tight lip capture used for the actual vertical launch. */
  launchAt(position, normal, velocity) {
    if (velocity.y <= -0.05) return null;
    return this.candidate(position, normal, velocity, {
      maxGap: 0.5 * CAPTURE_SCALE,
      below: 0.24 * CAPTURE_SCALE,
      above: 0.28 * CAPTURE_SCALE,
      maxNormalY: 0.68,
      minAlignment: 0.18,
    });
  }

  begin(position, velocity, edge) {
    const speed = Math.max(3.8, Math.min(21, velocity.length()));
    // Lock the rider just inside the lip instead of preserving the old forward
    // trajectory. This guarantees a same-transition return unless vert-exit is held.
    const anchor = edge.lip.clone().addScaledVector(edge.outward, -0.16);
    anchor.y = position.y;
    position.x = anchor.x;
    position.z = anchor.z;
    velocity.set(0, speed, 0);
    return {
      anchor,
      direction: edge.outward,
      normal: edge.normal,
      speed,
      apexPassed: false,
      transferring: false,
      copingName: edge.name,
    };
  }

  advance(air, position, velocity, breakOut, dt) {
    if (velocity.y <= 0) air.apexPassed = true;
    // Only the explicit Ctrl/L2 vert-exit command sends the rider over the deck.
    if (air.apexPassed && breakOut && !air.transferring) {
      air.transferring = true;
      velocity.x = air.direction.x * 3;
      velocity.z = air.direction.z * 3;
    }
    if (air.transferring) {
      const speed = Math.min(9, Math.hypot(velocity.x, velocity.z) + 9 * dt);
      velocity.x = air.direction.x * speed;
      velocity.z = air.direction.z * speed;
    } else {
      position.x = air.anchor.x;
      position.z = air.anchor.z;
      velocity.x = 0;
      velocity.z = 0;
    }
  }

  presentationNormal(air, verticalSpeed) {
    if (air.transferring) return UP;
    const level = 1 - THREE.MathUtils.clamp(Math.abs(verticalSpeed) / air.speed, 0, 1);
    const blend = THREE.MathUtils.smoothstep(level, 0, 0.72);
    return air.normal.clone().lerp(UP, blend).normalize();
  }
}
