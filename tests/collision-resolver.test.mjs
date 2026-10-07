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

  for (const speed of [3, 6, 9, 12, 15, 17]) {
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


function obstacleWorld({ width = 6, height = 3, depth = 0.02 } = {}) {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 12), material);
  floor.position.y = -0.05;
  root.add(floor);

  const obstacle = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material.clone(),
  );
  obstacle.position.set(0, height * 0.5, 0);
  obstacle.userData.surface = 'solid';
  root.add(obstacle);
  root.updateMatrixWorld(true);
  return root;
}

function simulateIntoObstacle(root, speed = 17) {
  const resolver = new CollisionResolver(new ParkCollision(root));
  const dt = 1 / 120;
  let position = new THREE.Vector3(0, 0.015, 1.25);
  let velocity = new THREE.Vector3(0, 0, -speed);
  let contactCount = 0;

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
    contactCount += result.contactCount;
    if (velocity.lengthSq() < 1e-8) break;
  }
  return { position, velocity, contactCount };
}

test('thin solids do not tunnel at 17 m/s', () => {
  const cases = [
    ['thin wall', obstacleWorld({ width: 6, height: 3, depth: 0.02 })],
    ['low ledge face', obstacleWorld({ width: 6, height: 0.68, depth: 0.025 })],
    ['narrow post', obstacleWorld({ width: 0.08, height: 2.4, depth: 0.04 })],
  ];

  for (const [label, root] of cases) {
    const result = simulateIntoObstacle(root, 17);
    assert.ok(result.position.z > 0.12,
      `${label} tunneled at 17m/s, z=${result.position.z}`);
    assert.ok(result.velocity.z >= -1e-7,
      `${label} kept velocity into solid: ${result.velocity.z}`);
    assert.ok(result.contactCount > 0, `${label} produced no collision contact`);
  }
});

test('thin-solid collision does not own yaw data', () => {
  const result = simulateIntoObstacle(
    obstacleWorld({ width: 0.08, height: 2.4, depth: 0.04 }),
    17,
  );
  assert.equal('heading' in result, false);
  assert.equal('yaw' in result, false);
});
