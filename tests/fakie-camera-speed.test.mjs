import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { resolveTravelFollowDirection } from '../src/game/FollowCamera.js';
import { MOMENTUM_ROLL } from '../src/game/MomentumRollSkillStreetPhysics.js';
import { MOVEMENT_STATE } from '../src/game/StreetPhysics.js';

function floorWorld() {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(100, 0.1, 100), new THREE.MeshBasicMaterial());
  floor.position.y = -0.05;
  root.add(floor);
  root.updateMatrixWorld(true);
  return root;
}

function physics() {
  return new StatefulSkillStreetPhysics({ collision: floorWorld(), spawn: [0, 0.5, 0], rails: [] });
}

function setRolling(p, heading, signedSpeed) {
  p.position.set(0, 0.015, 0);
  p.normal.set(0, 1, 0);
  p.heading = heading;
  p.groundDirection();
  p.setMovementState(MOVEMENT_STATE.GROUND);
  p.velocity.copy(p.forward).multiplyScalar(signedSpeed);
  p.rollingSign = signedSpeed < 0 ? -1 : 1;
}

test('camera follows world travel after 180 instead of deck nose', () => {
  const player = {
    forward: new THREE.Vector3(0, 0, 1),
    velocity: new THREE.Vector3(0, 0, -6),
  };
  const previous = new THREE.Vector3(0, 0, -1);
  const direction = resolveTravelFollowDirection(player, previous, true);
  assert.ok(direction.z < -0.999, `camera crossed to deck-facing side after 180: ${direction.z}`);
});

test('camera keeps previous travel side if fakie rider briefly becomes nearly stationary', () => {
  const player = {
    forward: new THREE.Vector3(0, 0, 1),
    velocity: new THREE.Vector3(0.01, 0, -0.01),
  };
  const previous = new THREE.Vector3(0, 0, -1);
  const direction = resolveTravelFollowDirection(player, previous, true);
  assert.ok(direction.z < -0.999, 'camera should not orbit 180 merely because fakie speed becomes small');
});

test('fakie steering is inverted relative to regular while camera stays travel-oriented', () => {
  const regular = physics();
  const fakie = physics();
  setRolling(regular, 0, 5.5);
  setRolling(fakie, Math.PI, -5.5);

  regular.steer = 1;
  fakie.steer = 1;
  const regularHeading = regular.heading;
  const fakieHeading = fakie.heading;
  regular.stepGround(1 / 120, { brake: false }, 0);
  fakie.stepGround(1 / 120, { brake: false }, 0);

  const regularDelta = regular.heading - regularHeading;
  const fakieDelta = fakie.heading - fakieHeading;
  assert.ok(regularDelta * fakieDelta < 0,
    `fakie steering must invert: regular=${regularDelta}, fakie=${fakieDelta}`);
});

test('neutral flat skating reaches the faster cruise without forward throttle', () => {
  const p = physics();
  setRolling(p, 0, 0);
  const dt = 1 / 120;
  for (let i = 0; i < 3 * 120; i++) {
    p.steer = 0;
    p.stepGround(dt, { brake: false }, 0);
  }
  const speed = Math.abs(p.velocity.dot(p.forward));
  assert.ok(MOMENTUM_ROLL.autoPushTarget >= 8.5, `cruise target too low: ${MOMENTUM_ROLL.autoPushTarget}`);
  assert.ok(speed > 7.5, `neutral cruise should build useful speed, got ${speed}`);
  assert.ok(speed <= MOMENTUM_ROLL.autoPushTarget + 0.2, `neutral cruise exceeded target: ${speed}`);
});
