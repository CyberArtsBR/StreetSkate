import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { MeshBVH } from 'three-mesh-bvh';

/** Spatial candidates without duplicating long triangles into octree children.
 * Keep the existing Three.js capsule/sphere contact mathematics unchanged. */
export class BlockTriangleIndex {
  constructor() {
    this.triangles = [];
    this.narrowPhase = new Octree();
    this.queryBounds = new THREE.Box3();
    this._candidates = null;
    this.callbacks = {
      intersectsBounds: box => box.intersectsBox(this.queryBounds),
      intersectsTriangle: (_triangle, index) => {
        this._candidates.push(this.triangles[index]);
        return false;
      },
    };
  }

  addTriangle(triangle) { this.triangles.push(triangle); }

  build() {
    if (!this.triangles.length) return;
    const positions = new Float32Array(this.triangles.length * 9);
    this.triangles.forEach((triangle, i) => {
      triangle.a.toArray(positions, i * 9);
      triangle.b.toArray(positions, i * 9 + 3);
      triangle.c.toArray(positions, i * 9 + 6);
    });
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.tree = new MeshBVH(this.geometry, { indirect: true });
  }

  query(candidates) {
    if (!this.tree) return;
    this._candidates = candidates;
    this.tree.shapecast(this.callbacks);
    this._candidates = null;
  }

  getCapsuleTriangles(capsule, candidates) {
    this.queryBounds.min.copy(capsule.start).min(capsule.end).addScalar(-capsule.radius);
    this.queryBounds.max.copy(capsule.start).max(capsule.end).addScalar(capsule.radius);
    this.query(candidates);
  }

  getSphereTriangles(sphere, candidates) {
    this.queryBounds.min.copy(sphere.center).addScalar(-sphere.radius);
    this.queryBounds.max.copy(sphere.center).addScalar(sphere.radius);
    this.query(candidates);
  }

  triangleCapsuleIntersect(capsule, triangle) {
    return this.narrowPhase.triangleCapsuleIntersect(capsule, triangle);
  }

  triangleSphereIntersect(sphere, triangle) {
    return this.narrowPhase.triangleSphereIntersect(sphere, triangle);
  }
}
