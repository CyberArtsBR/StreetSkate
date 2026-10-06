import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { MOVEMENT_STATE } from '../src/game/StreetPhysics.js';

function flatWorld() {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(20, 0.1, 20),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  floor.position.y = -0.05;
  root.add(floor);
  root.updateMatrixWorld(true);
  return root;
}

function support(normal = new THREE.Vector3(0, 1, 0)) {
  return {
    supported: true,
    count: 4,
    frontSupported: 2,
    rearSupported: 2,
    position: new THREE.Vector3(0, 0.015, 0),
    supportPoint: new THREE.Vector3(0, 0, 0),
    normal: normal.clone().normalize(),
    maxWheelGap: 0,
    contacts: [],
  };
}

function physics() {
  return new StatefulSkillStreetPhysics({
    collision: flatWorld(),
    spawn: [0, 0.5, 0],
    rails: [],
  });
}

test('normal landing finishes with no hidden contact yaw write', () => {
  const p = physics();
  const s = support();
  p.setMovementState(MOVEMENT_STATE.AIR);
  p.airTime = 0.4;
  p.heading = 0.37;
  p.airHeading = 0.37;
  p.groundDirection();
  p.velocity.copy(p.forward).multiplyScalar(5).add(new THREE.Vector3(0, -1.2, 0));

  assert.equal(p.land(s), true);
  assert.equal(p.landingYawInvariantViolations, 0);
  assert.equal(p.lastLandingYawInvariant?.violated, false);
  assert.ok(Math.abs(p.heading - 0.37) < 1e-10);
});

test('explicit 180 landing is player-authored yaw, not a contact yaw violation', () => {
  const p = physics();
  const s = support();
  p.setMovementState(MOVEMENT_STATE.AIR);
  p.airTime = 0.5;
  p.heading = Math.PI;
  p.airHeading = Math.PI;
  p.airSpin = Math.PI;
  p.groundDirection();
  p.velocity.set(0, -1.1, -5.5);

  assert.equal(p.land(s), true);
  assert.equal(p.landingYawInvariantViolations, 0);
  assert.equal(p.lastLandingYawInvariant?.violated, false);
  assert.ok(Math.abs(Math.abs(p.heading) - Math.PI) < 1e-10);
});
