import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const RADIUS = 0.23;
const SKIN = 0.003;
const WHEELBASE = 0.64;
const WHEEL_TRACK = 0.2;
const EPS = 1e-8;

export class ParkCollision {
  constructor(root) {
    this.root = root;
    this.ray = new THREE.Raycaster();
    this.meshes = []; this.ridingMeshes = [];
    this.blocks = new Octree();
    this.capsule = new Capsule();
    this._normalMatrix = new THREE.Matrix3();
    this._rayHits = [];
    this._direction = new THREE.Vector3();
    this._motion = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._sphere = new THREE.Sphere(new THREE.Vector3(), 0.04);
    this._sphereTriangles = [];
    this._probeResult = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, fraction: 1 };
    this._sweepResult = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, fraction: 1 };
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
        if (rideable && normal.y > 0.035) continue;
        triangle.faceNormal = normal;
        triangle.railId = mesh.userData.railId || null;
        this.blocks.addTriangle(triangle);
      }
    });
    this.blocks.build();
  }

  normal(hit, target = new THREE.Vector3()) {
    this._normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    return target.copy(hit.face.normal).applyNormalMatrix(this._normalMatrix).normalize();
  }

  rayRideable(origin, direction, maxDistance, pointOut, normalOut, minNormalY = 0.035) {
    this.ray.set(origin, direction);
    this.ray.far = maxDistance;
    this._rayHits.length = 0;
    this.ray.intersectObjects(this.ridingMeshes, false, this._rayHits);
    for (const hit of this._rayHits) {
      this.normal(hit, normalOut);
      if (normalOut.y <= minNormalY) continue;
      pointOut.copy(hit.point);
      const result = this._probeResult;
      result.point.copy(pointOut); result.normal.copy(normalOut);
      result.distance = hit.distance; result.fraction = maxDistance > EPS ? hit.distance / maxDistance : 0;
      return result;
    }
    return null;
  }

  probeRideable(expected, supportNormal, rise, drop, pointOut, normalOut) {
    this._direction.copy(supportNormal).normalize();
    this._origin.copy(expected).addScaledVector(this._direction, rise);
    this._direction.negate();
    let hit = this.rayRideable(this._origin, this._direction, rise + drop, pointOut, normalOut);
    if (hit) {
      hit.distance -= rise;
      return hit;
    }
    // A very short vertical fallback bridges triangle seams when the support
    // normal turns quickly. Its short reach cannot behave like a stair ray.
    if (Math.abs(supportNormal.y) < 0.94) {
      const fallbackRise = 0.055;
      this._origin.copy(expected).addScaledVector(UP, fallbackRise);
      hit = this.rayRideable(this._origin, DOWN, fallbackRise + Math.min(drop, 0.055), pointOut, normalOut);
      if (hit) hit.distance -= fallbackRise;
    }
    return hit;
  }

  sweepRideable(from, to, pointOut, normalOut, extra = 0) {
    this._motion.copy(to).sub(from);
    const distance = this._motion.length();
    if (distance < EPS) return null;
    this._direction.copy(this._motion).multiplyScalar(1 / distance);
    const hit = this.rayRideable(from, this._direction, distance + extra, pointOut, normalOut);
    if (!hit || this._motion.dot(normalOut) >= -1e-7) return null;
    const result = this._sweepResult;
    result.point.copy(pointOut); result.normal.copy(normalOut);
    result.distance = hit.distance;
    result.fraction = THREE.MathUtils.clamp(hit.distance / Math.max(distance, EPS), 0, 1);
    return result;
  }

  /** Small finite sphere sweep used only by nose/tail clearance probes. */
  sweepSolidSphere(from, to, radius, pointOut, normalOut, ignoreRail = null) {
    this._motion.copy(to).sub(from);
    const distance = this._motion.length();
    if (distance < EPS) return null;
    this._direction.copy(this._motion).multiplyScalar(1 / distance);

    // Centerline entry first: prevents a thin riser/ledge from being skipped at speed.
    this.ray.set(from, this._direction); this.ray.far = distance + radius;
    this._rayHits.length = 0;
    this.ray.intersectObjects(this.meshes, false, this._rayHits);
    for (const hit of this._rayHits) {
      if (ignoreRail && hit.object.userData.railId === ignoreRail) continue;
      this.normal(hit, normalOut);
      if (normalOut.dot(this._direction) > 0) normalOut.negate();
      if (normalOut.y > 0.72 || normalOut.dot(this._direction) > -0.04) continue;
      const contactDistance = Math.max(0, hit.distance - radius);
      if (contactDistance > distance) continue;
      pointOut.copy(hit.point);
      const result = this._sweepResult;
      result.point.copy(pointOut); result.normal.copy(normalOut);
      result.distance = contactDistance; result.fraction = contactDistance / distance;
      return result;
    }

    const spacing = Math.max(0.015, radius * 0.7);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    this._sphere.radius = radius;
    for (let i = 1; i <= steps; i++) {
      const fraction = i / steps;
      this._sphere.center.copy(from).addScaledVector(this._motion, fraction);
      this._sphereTriangles.length = 0;
      this.blocks.getSphereTriangles(this._sphere, this._sphereTriangles);
      let deepest = null;
      for (const triangle of this._sphereTriangles) {
        if (ignoreRail && triangle.railId === ignoreRail) continue;
        const hit = this.blocks.triangleSphereIntersect(this._sphere, triangle);
        if (!hit || hit.depth < 1e-6 || (deepest && hit.depth <= deepest.depth)) continue;
        deepest = hit;
      }
      if (!deepest) continue;
      normalOut.copy(deepest.normal);
      if (normalOut.dot(this._direction) > 0) normalOut.negate();
      if (normalOut.y > 0.72 || normalOut.dot(this._direction) > -0.04) continue;
      pointOut.copy(this._sphere.center).addScaledVector(normalOut, -radius + deepest.depth);
      const result = this._sweepResult;
      result.point.copy(pointOut); result.normal.copy(normalOut);
      result.distance = distance * fraction; result.fraction = fraction;
      return result;
    }
    return null;
  }

  ground(position, rise = 0.14, drop = 0.2) {
    this._origin.copy(position).addScaledVector(UP, rise);
    const hit = this.rayRideable(this._origin, DOWN, rise + drop, this._point, this._normal);
    return hit ? { point: hit.point.clone(), normal: hit.normal.clone() } : null;
  }

  landing(from, to) {
    this._origin.copy(from).addScaledVector(UP, -0.015);
    const hit = this.sweepRideable(this._origin, to, this._point, this._normal, 0.002);
    return hit ? { point: hit.point.clone(), normal: hit.normal.clone() } : null;
  }

  /** Compatibility sampler for older pump/vert harnesses. Main riding uses SkateboardContactRig. */
  wheelSupport(center, forward, surfaceNormal, { rise = 0.24, drop = 0.42 } = {}) {
    const normal = surfaceNormal.clone().normalize();
    const boardForward = forward.clone().projectOnPlane(normal);
    if (boardForward.lengthSq() < 1e-7) return null;
    boardForward.normalize();
    const right = boardForward.clone().cross(normal).normalize();
    const offsets = [
      { longitudinal: WHEELBASE * 0.5, lateral: -WHEEL_TRACK * 0.5, truck: 'front' },
      { longitudinal: WHEELBASE * 0.5, lateral: WHEEL_TRACK * 0.5, truck: 'front' },
      { longitudinal: -WHEELBASE * 0.5, lateral: -WHEEL_TRACK * 0.5, truck: 'rear' },
      { longitudinal: -WHEELBASE * 0.5, lateral: WHEEL_TRACK * 0.5, truck: 'rear' },
    ];
    const wheels = [];
    for (const offset of offsets) {
      const planar = boardForward.clone().multiplyScalar(offset.longitudinal).addScaledVector(right, offset.lateral);
      const expected = center.clone().add(planar);
      const p = new THREE.Vector3(), n = new THREE.Vector3();
      const hit = this.probeRideable(expected, normal, rise, drop, p, n);
      if (!hit || n.dot(normal) < 0.32) continue;
      wheels.push({
        point: p.clone(), normal: n.clone(), truck: offset.truck,
        longitudinal: offset.longitudinal, lateral: offset.lateral,
        centerEstimate: p.clone().sub(planar), gap: hit.distance,
      });
    }
    const front = wheels.filter(w => w.truck === 'front').length;
    const rear = wheels.filter(w => w.truck === 'rear').length;
    if (wheels.length < 2 || front < 1 || rear < 1) return null;
    const point = new THREE.Vector3(), averagedNormal = new THREE.Vector3();
    let maxGap = 0;
    for (const wheel of wheels) { point.add(wheel.centerEstimate); averagedNormal.add(wheel.normal); maxGap = Math.max(maxGap, Math.abs(wheel.gap)); }
    point.multiplyScalar(1 / wheels.length); averagedNormal.normalize();
    return { point, normal: averagedNormal, wheels, wheelCount: wheels.length, frontSupported: front, rearSupported: rear, maxWheelGap: maxGap, boardForward };
  }

  boardLanding(from, to, forward) {
    const centerHit = this.landing(from, to);
    if (!centerHit) return null;
    const tangentForward = forward.clone().projectOnPlane(centerHit.normal);
    if (tangentForward.lengthSq() < 1e-7) tangentForward.copy(to).sub(from).projectOnPlane(centerHit.normal);
    if (tangentForward.lengthSq() < 1e-7) return null;
    tangentForward.normalize();
    const support = this.wheelSupport(centerHit.point, tangentForward, centerHit.normal);
    if (!support) return null;
    return { ...centerHit, ...support, centerHit: centerHit.point.clone() };
  }

  /** Swept torso/body capsule with sliding and overlap recovery. Board support is separate. */
  move(from, desired, velocity, { fromUp = UP, toUp = UP, forward = new THREE.Vector3(0, 0, -1), grounded = false, ignoreRail = null } = {}) {
    const position = from.clone();
    const travel = desired.clone().sub(from);
    const steps = Math.max(1, Math.ceil((travel.length() + fromUp.distanceTo(toUp) * 1.5) / 0.09));
    const increment = travel.multiplyScalar(1 / steps);
    const contacts = [];
    for (let step = 1; step <= steps; step++) {
      const before = position.clone();
      position.add(increment);
      const axis = fromUp.clone().lerp(toUp, step / steps).normalize();
      for (let iteration = 0; iteration < 5; iteration++) {
        // Only the rider/body capsule lives here. The old grounded deck capsule
        // was intentionally removed; wheel + nose/tail probes own board contact.
        const shape = { start: position.clone().addScaledVector(axis, 0.27), end: position.clone().addScaledVector(axis, 1.48), radius: RADIUS, height: 0.875 };
        let deepest = null;
        this.capsule.set(shape.start, shape.end, shape.radius);
        const candidates = [];
        this.blocks.getCapsuleTriangles(this.capsule, candidates);
        for (const triangle of candidates) {
          if (ignoreRail && triangle.railId === ignoreRail) continue;
          const previousCenter = before.clone().addScaledVector(axis, shape.height);
          const face = triangle.faceNormal.dot(previousCenter.sub(triangle.a)) < 0
            ? new THREE.Triangle(triangle.c, triangle.b, triangle.a) : triangle;
          const hit = this.blocks.triangleCapsuleIntersect(this.capsule, face);
          if (!hit || hit.depth < 0.00001 || (deepest && hit.depth <= deepest.depth)) continue;
          deepest = { ...hit, railId: triangle.railId };
        }
        if (!deepest) break;
        let hitNormal = deepest.normal.clone();
        let depth = deepest.depth + SKIN;
        if (grounded) {
          const tangent = hitNormal.clone().projectOnPlane(toUp);
          const length = tangent.length();
          if (length > 0.12) {
            hitNormal.copy(tangent).divideScalar(length);
            depth = Math.min(0.35, depth / length);
          } else {
            hitNormal.copy(increment).projectOnPlane(toUp).negate();
            if (hitNormal.lengthSq() < 1e-8) continue;
            hitNormal.normalize();
          }
        }
        position.addScaledVector(hitNormal, depth);
        const into = velocity.dot(hitNormal);
        if (into < 0) velocity.addScaledVector(hitNormal, -into);
        contacts.push({ ...deepest, normal: hitNormal, distance: 0 });
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

  camera(from, desired, radius = 0.28) {
    const d = desired.clone().sub(from);
    if (d.lengthSq() < 1e-8) return desired;
    const length = d.length(), direction = d.clone().normalize();
    const right = new THREE.Vector3().crossVectors(direction, UP);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, direction).normalize();
    let clearance = length;
    // A camera has volume: center plus near-plane probes protect the lens from
    // ramp edges and posts that a single ray misses.
    for (const offset of [new THREE.Vector3(), right.clone().multiplyScalar(radius),
      right.clone().multiplyScalar(-radius), up.clone().multiplyScalar(radius),
      up.clone().multiplyScalar(-radius)]) {
      this.ray.set(from.clone().add(offset), direction); this.ray.far = length;
      const hit = this.ray.intersectObjects(this.meshes, false)[0];
      if (hit) clearance = Math.min(clearance, Math.max(0, hit.distance - radius));
    }
    return from.clone().addScaledVector(direction, clearance);
  }
}
