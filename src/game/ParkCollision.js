import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
export class ParkCollision {
  constructor(root) {
    this.root = root;
    this.ray = new THREE.Raycaster();
    this.meshes = [];
    root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh) this.meshes.push(o); });
  }

  normal(hit) {
    return hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
  }

  ground(position, rise = 0.3, drop = 0.5) {
    this.ray.set(new THREE.Vector3(position.x, position.y + rise, position.z), DOWN);
    this.ray.far = rise + drop;
    for (const hit of this.ray.intersectObjects(this.meshes, false)) {
      const normal = this.normal(hit);
      if (normal.y > 0.035) return { point: hit.point, normal };
    }
    return null;
  }

  wall(from, to, supportingNormal, grounded) {
    const delta = to.clone().sub(from);
    const length = delta.length();
    if (length < 1e-8) return null;
    const direction = delta.clone().normalize();
    for (const h of [0.18, 0.65, 1.2]) {
      this.ray.set(from.clone().addScaledVector(UP, h), direction);
      this.ray.far = length + 0.19;
      for (const hit of this.ray.intersectObjects(this.meshes, false)) {
        const normal = this.normal(hit);
        if (normal.dot(direction) >= -0.05 || normal.y > 0.55) continue;
        if (grounded && normal.y > 0.04 && normal.dot(supportingNormal) > 0.82) continue;
        return { point: hit.point, normal, distance: hit.distance };
      }
    }
    return null;
  }

  wallContact(position, wallNormal, reach = 0.52) {
    const origin = position.clone().addScaledVector(UP, 0.68).addScaledVector(wallNormal, 0.08);
    const direction = wallNormal.clone().negate().normalize();
    this.ray.set(origin, direction);
    this.ray.far = reach;
    for (const hit of this.ray.intersectObjects(this.meshes, false)) {
      const normal = this.normal(hit);
      if (normal.y < 0.55 && normal.dot(wallNormal) > 0.55) return { point: hit.point, normal, distance: hit.distance };
    }
    return null;
  }

  camera(from, desired) {
    const d = desired.clone().sub(from);
    this.ray.set(from, d.clone().normalize());
    this.ray.far = d.length();
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    return hit ? from.clone().addScaledVector(d.normalize(), Math.max(0.45, hit.distance - 0.28)) : desired;
  }
}
