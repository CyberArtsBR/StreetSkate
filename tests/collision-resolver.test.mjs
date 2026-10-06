import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ParkCollision } from '../src/game/ParkCollision.js';
import {
  CollisionResolver,
  collisionResult,
} from '../src/game/collision/CollisionResolver.js';

function wallWorld() {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 12), material);
  floor.position.y = -0.05;
  root.add(floor);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.10), material.clone());
  wall.position.set(0, 1.5, 0);
  wall.userData.surface = 'solid';
  root.add(wall);
  root.updateMatrixWorld(true);
  return root;
}

test('collision result has no yaw authority by contract', () => {
  const result = collisionResult({
    position: new THREE.Vector3(1, 2, 3),
    velocity: new THREE.Vector3(4, 5, 6),
    contacts: [],
  });
  assert.equal('heading' in result, false);
  assert.equal('yaw' in result, false);
  assert.equal('orientation' in result, false);
});

test('resolver contains ParkCollision velocity mutation inside the result', () => {
  const fakeSurface = {
    move(from, desired, velocity) {
      velocity.set(1, 2, 3);
      return { position: desired.clone(), contacts: [] };
    },
  };
  const resolver = new CollisionResolver(fakeSurface);
  const inputVelocity = new THREE.Vector3(9, 8, 7);
  const result = resolver.resolveBody({
    from: new THREE.Vector3(),
    desired: new THREE.Vector3(0, 0, -1),
    velocity: inputVelocity,
  });

  assert.deepEqual(inputVelocity.toArray(), [9, 8, 7], 'resolver mutated caller velocity');
  assert.deepEqual(result.velocity.toArray(), [1, 2, 3]);
});

test('continuous body collision does not tunnel through a wall at skate speeds', () => {
  const surface = new ParkCollision(wallWorld());
  const resolver = new CollisionResolver(surface);
  const dt = 1 / 120;

  for (const speed of [3, 6, 9, 12, 15]) {
    let position = new THREE.Vector3(0, 0.015, 1.25);
    let velocity = new THREE.Vector3(0, 0, -speed);
    let contacts = 0;

    for (let frame = 0; frame < 120; frame++) {
      const desired = position.clone().addScaledVector(velocity, dt);
      const result = resolver.resolveBody({
        from: position,
        desired,
        velocity,
        grounded: true,
        fromUp: new THREE.Vector3(0, 1, 0),
        toUp: new THREE.Vector3(0, 1, 0),
        forward: new THREE.Vector3(0, 0, -1),
      });
      position = result.position;
      velocity = result.velocity;
      contacts += result.contactCount;
      if (velocity.lengthSq() < 1e-8) break;
    }

    assert.ok(position.z > 0.18,
      `${speed}m/s tunneled through wall, final z=${position.z}`);
    assert.ok(velocity.z >= -1e-7,
      `${speed}m/s kept velocity into wall: ${velocity.z}`);
    assert.ok(contacts > 0, `${speed}m/s produced no collision contact`);
  }
});
