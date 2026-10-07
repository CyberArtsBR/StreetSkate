import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ParkCollision } from '../src/game/ParkCollision.js';
import { CollisionResolver } from '../src/game/collision/CollisionResolver.js';

function world({ corner = false } = {}) {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.1, 20), material);
  floor.position.y = -0.05;
  root.add(floor);

  const zWall = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.04), material.clone());
  zWall.position.set(0, 1.5, 0);
  zWall.userData.surface = 'solid';
  root.add(zWall);

  if (corner) {
    const xWall = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3, 8), material.clone());
    xWall.position.set(0, 1.5, 0);
    xWall.userData.surface = 'solid';
    root.add(xWall);
  }
  root.updateMatrixWorld(true);
  return root;
}

function run(root, speed, { corner = false } = {}) {
  const resolver = new CollisionResolver(new ParkCollision(root));
  const dt = 1 / 120;
  let position = corner
    ? new THREE.Vector3(1.25, 0.015, 1.25)
    : new THREE.Vector3(0, 0.015, 1.25);
  let direction = corner
    ? new THREE.Vector3(-1, 0, -1).normalize()
    : new THREE.Vector3(0.55, 0, -1).normalize();
  let velocity = direction.multiplyScalar(speed);
  let contacts = 0;

  for (let frame = 0; frame < 120; frame++) {
    const result = resolver.resolveBody({
      from: position,
      desired: position.clone().addScaledVector(velocity, dt),
      velocity,
      grounded: true,
      fromUp: new THREE.Vector3(0, 1, 0),
      toUp: new THREE.Vector3(0, 1, 0),
      forward: direction,
    });
    position = result.position;
    velocity = result.velocity;
    contacts += result.contactCount;
    assert.equal('heading' in result, false);
    assert.equal('yaw' in result, false);
  }
  return { position, velocity, contacts };
}

test('oblique wall contact slides without tunnelling at skate speeds', () => {
  for (const speed of [3, 6, 9, 12, 15, 17]) {
    const result = run(world(), speed);
    assert.ok(result.position.z > 0.12, `${speed}m/s crossed the wall: z=${result.position.z}`);
    assert.ok(result.velocity.z >= -1e-7, `${speed}m/s retained inward Z velocity`);
    assert.ok(result.position.x > 0.15, `${speed}m/s lost tangential slide`);
    assert.ok(result.contacts > 0);
  }
});

test('diagonal corner impact cannot tunnel through either wall', () => {
  for (const speed of [3, 6, 9, 12, 15, 17]) {
    const result = run(world({ corner: true }), speed, { corner: true });
    assert.ok(result.position.x > 0.12, `${speed}m/s crossed X wall: x=${result.position.x}`);
    assert.ok(result.position.z > 0.12, `${speed}m/s crossed Z wall: z=${result.position.z}`);
    assert.ok(result.velocity.x >= -1e-7, `${speed}m/s retained inward X velocity`);
    assert.ok(result.velocity.z >= -1e-7, `${speed}m/s retained inward Z velocity`);
    assert.ok(result.contacts > 0);
  }
});
