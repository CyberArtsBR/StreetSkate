import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const RADIUS = 0.23;
const SKIN = 0.003;

export class ParkCollision {
  constructor(root) {
    this.root = root;
    this.ray = new THREE.Raycaster();
    this.meshes = []; this.ridingMeshes = [];
    this.blocks = new Octree();
    this.capsule = new Capsule();
    root.updateMatrixWorld(true);
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.side = THREE.DoubleSide;
      this.meshes.push(mesh);
      const rideable = mesh.userData.surface !== 'solid';
      if (rideable) this.ridingMeshes.push(mesh);
      const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index;
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 3) {
        const vertices = [0, 1, 2].map(j => new THREE.Vector3()
          .fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
        const triangle = new THREE.Triangle(...vertices);
        const normal = triangle.getNormal(new THREE.Vector3());
        // Riding faces are handled at the board's contact point. Treating a
        // rising bank or an airborne landing as a torso wall caused the sticking.
        if (rideable && normal.y > 0.035) continue;
        triangle.faceNormal = normal;
        triangle.railId = mesh.userData.railId || null;
        this.blocks.addTriangle(triangle);
      }
    });
    this.blocks.build();
  }

  normal(hit) {
    return hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
  }

  ground(position, rise = 0.14, drop = 0.2) {
    this.ray.set(position.clone().addScaledVector(UP, rise), DOWN);
    this.ray.far = rise + drop;
    for (const hit of this.ray.intersectObjects(this.ridingMeshes, false)) {
      const normal = this.normal(hit);
      if (normal.y > 0.035) return { point: hit.point, normal };
    }
    return null;
  }

  landing(from, to) {
    const origin = from.clone().addScaledVector(UP, -0.015);
    const motion = to.clone().sub(from), distance = motion.length();
    if (distance < 1e-8) return null;
    this.ray.set(origin, motion.clone().normalize()); this.ray.far = distance + 0.002;
    for (const hit of this.ray.intersectObjects(this.ridingMeshes, false)) {
      const normal = this.normal(hit);
      if (normal.y > 0.035 && motion.dot(normal) < -1e-7) return { point: hit.point, normal };
    }
    return null;
  }

  /** Swept, finite-height body with sliding and overlap recovery. No velocity damping. */
  move(from, desired, velocity, { fromUp = UP, toUp = UP, forward = new THREE.Vector3(0, 0, -1), grounded = false, ignoreRail = null } = {}) {
    const position = from.clone();
    const travel = desired.clone().sub(from);
    // Translation AND body rotation are subdivided so a thin post cannot be skipped.
    const steps = Math.max(1, Math.ceil((travel.length() + fromUp.distanceTo(toUp) * 1.5) / 0.09));
    const increment = travel.multiplyScalar(1 / steps);
    const contacts = [];
    for (let step = 1; step <= steps; step++) {
      const before = position.clone();
      position.add(increment);
      const axis = fromUp.clone().lerp(toUp, step / steps).normalize();
      for (let iteration = 0; iteration < 5; iteration++) {
        const shapes = [{ start: position.clone().addScaledVector(axis, 0.27), end: position.clone().addScaledVector(axis, 1.48), radius: RADIUS, height: 0.875 }];
        if (grounded) {
          const along = forward.clone().projectOnPlane(axis).normalize().multiplyScalar(0.35);
          const deck = position.clone().addScaledVector(axis, 0.13);
          shapes.push({ start: deck.clone().sub(along), end: deck.clone().add(along), radius: 0.115, height: 0.13 });
        }
        let deepest = null;
        for (const shape of shapes) {
          this.capsule.set(shape.start, shape.end, shape.radius);
          const candidates = [];
          this.blocks.getCapsuleTriangles(this.capsule, candidates);
          for (const triangle of candidates) {
            if (ignoreRail && triangle.railId === ignoreRail) continue;
            // Keep contacts on their original side, including when moving away.
            const previousCenter = before.clone().addScaledVector(axis, shape.height);
            const face = triangle.faceNormal.dot(previousCenter.sub(triangle.a)) < 0
              ? new THREE.Triangle(triangle.c, triangle.b, triangle.a) : triangle;
            const hit = this.blocks.triangleCapsuleIntersect(this.capsule, face);
            if (!hit || hit.depth < 0.00001 || (deepest && hit.depth <= deepest.depth)) continue;
            deepest = { ...hit, railId: triangle.railId };
          }
        }
        if (!deepest) break;
        let normal = deepest.normal.clone();
        let depth = deepest.depth + SKIN;
        if (grounded) {
          // A ground contact with a rail/step must not push the whole skater up
          // onto it. Keep movement along the supporting plane instead.
          const tangent = normal.clone().projectOnPlane(toUp);
          const length = tangent.length();
          if (length > 0.12) {
            normal.copy(tangent).divideScalar(length);
            depth = Math.min(0.35, depth / length);
          } else {
            normal.copy(increment).projectOnPlane(toUp).negate();
            if (normal.lengthSq() < 1e-8) continue;
            normal.normalize();
          }
        }
        position.addScaledVector(normal, depth);
        const into = velocity.dot(normal);
        if (into < 0) velocity.addScaledVector(normal, -into);
        contacts.push({ ...deepest, normal, distance: 0 });
      }
    }
    return { position, contacts };
  }

  wallContact(position, wallNormal, reach = 0.52) {
    const origin = position.clone().addScaledVector(UP, 0.68).addScaledVector(wallNormal, 0.08);
    const direction = wallNormal.clone().negate().normalize();
    this.ray.set(origin, direction); this.ray.far = reach;
    for (const hit of this.ray.intersectObjects(this.meshes, false)) {
      const normal = this.normal(hit);
      if (normal.dot(direction) > 0) normal.negate();
      if (Math.abs(normal.y) < 0.35 && normal.dot(wallNormal) > 0.7) return { point: hit.point, normal, distance: hit.distance };
    }
    return null;
  }

  camera(from, desired) {
    const d = desired.clone().sub(from);
    if (d.lengthSq() < 1e-8) return desired;
    this.ray.set(from, d.clone().normalize()); this.ray.far = d.length();
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    return hit ? from.clone().addScaledVector(d.normalize(), Math.max(0.1, hit.distance - 0.2)) : desired;
  }
}
