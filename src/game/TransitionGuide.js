import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/** Only curved bowl/quarter-pipe coping paths use the half-pipe air rule. */
export class TransitionGuide {
  constructor(rails = []) {
    this.edges = [];
    for (const rail of rails) {
      if (!/coping/i.test(rail.name)) continue;
      for (let i = 1; i < rail.points.length; i++) {
        this.edges.push([new THREE.Vector3(...rail.points[i - 1]), new THREE.Vector3(...rail.points[i])]);
      }
    }
  }

  launchAt(position, normal, velocity) {
    // No speed threshold changes the launch angle. Height still follows energy.
    if (velocity.y <= 0 || normal.y > 0.5) return null;
    const outward = normal.clone().setY(0).normalize().negate();
    const horizontal = velocity.clone().setY(0);
    if (horizontal.lengthSq() > 0.001 && horizontal.normalize().dot(outward) < 0.4) return null;
    let closest = null, distance = 0.5;
    for (const [a, b] of this.edges) {
      const edge = b.clone().sub(a).setY(0);
      const t = THREE.MathUtils.clamp(position.clone().sub(a).setY(0).dot(edge) / Math.max(edge.lengthSq(), 1e-8), 0, 1);
      const lip = a.clone().lerp(b, t);
      const gap = position.clone().sub(lip).setY(0).length();
      // Coping centre is 2.5 cm above the riding surface.
      const height = lip.y - 0.025;
      if (gap >= distance || position.y < height - 0.18 || position.y > height + 0.25) continue;
      closest = { lip, outward, normal: normal.clone() };
      distance = gap;
    }
    return closest;
  }

  begin(position, velocity, edge) {
    const speed = Math.max(3.6, Math.min(20, velocity.length()));
    const anchor = position.clone();
    // Keep the return line on the inside of the lip, including a skipped edge step.
    const outside = anchor.clone().sub(edge.lip).dot(edge.outward);
    if (outside > -0.04) anchor.addScaledVector(edge.outward, -0.04 - outside);
    position.x = anchor.x; position.z = anchor.z;
    velocity.set(0, speed, 0);
    return { anchor, direction: edge.outward, normal: edge.normal, speed, apexPassed: false, transferring: false };
  }

  advance(air, position, velocity, drive, dt) {
    if (velocity.y <= 0) air.apexPassed = true;
    if (air.apexPassed && drive > 0 && !air.transferring) {
      air.transferring = true;
      // Intentional forward input after the apex clears the coping.
      velocity.x = air.direction.x * 3;
      velocity.z = air.direction.z * 3;
    }
    if (air.transferring) {
      const speed = Math.min(9, Math.hypot(velocity.x, velocity.z) + Math.max(0, drive) * 9 * dt);
      velocity.x = air.direction.x * speed;
      velocity.z = air.direction.z * speed;
    } else {
      position.x = air.anchor.x; position.z = air.anchor.z;
      velocity.x = 0; velocity.z = 0;
    }
  }

  presentationNormal(air, verticalSpeed) {
    if (air.transferring) return UP;
    const level = 1 - THREE.MathUtils.clamp(Math.abs(verticalSpeed) / air.speed, 0, 1);
    const blend = THREE.MathUtils.smoothstep(level, 0, 0.72);
    return air.normal.clone().lerp(UP, blend).normalize();
  }
}
