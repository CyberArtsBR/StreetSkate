import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { MOVEMENT_STATE } from '../src/game/StreetPhysics.js';
import {
  naturalRampReturnProgress,
  rampReturnFacing,
  rampReturnFakie,
  rampReturnHalfTurns,
  transitionAirSpinInput,
} from '../src/game/StableRampReturnSkillStreetPhysics.js';

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

test('straight same-wall return preserves takeoff facing with no automatic yaw', () => {
  const takeoff = new THREE.Vector3(0, 0, -1);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: 0 });
  assert.ok(returned.dot(takeoff) > 0.999999);
  assert.equal(rampReturnHalfTurns(0), 0);
  assert.equal(rampReturnFakie(false, 0), false);
});

test('passive ramp return has zero automatic turnaround progress at every phase', () => {
  assert.equal(naturalRampReturnProgress({ verticalSpeed: 6, launchVertical: 8 }), 0);
  assert.equal(naturalRampReturnProgress({ verticalSpeed: 0, launchVertical: 8 }), 0);
  assert.equal(naturalRampReturnProgress({ verticalSpeed: -7, launchVertical: 8 }), 0);
});

test('passive ramp return preserves existing fakie presentation instead of toggling it', () => {
  assert.equal(rampReturnFakie(false, 0), false);
  assert.equal(rampReturnFakie(true, 0), true);
});

test('real explicit 180 alone reverses facing and toggles fakie', () => {
  const takeoff = new THREE.Vector3(0, 0, -1);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: Math.PI });
  assert.ok(returned.dot(takeoff) < -0.999999);
  assert.equal(rampReturnFakie(false, Math.PI), true);
  assert.equal(rampReturnHalfTurns(Math.PI), 1);
});

test('explicit 360 preserves takeoff facing and regular presentation', () => {
  const takeoff = new THREE.Vector3(1, 0, 0);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: Math.PI * 2 });
  assert.ok(returned.dot(takeoff) > 0.999999);
  assert.equal(rampReturnFakie(false, Math.PI * 2), false);
  assert.equal(rampReturnHalfTurns(Math.PI * 2), 2);
});

test('small steering noise cannot be mistaken for a 180', () => {
  assert.equal(rampReturnHalfTurns(THREE.MathUtils.degToRad(35)), 0);
  assert.equal(rampReturnFakie(false, THREE.MathUtils.degToRad(35)), false);
});

test('air spin ignores steering drift when no explicit spin is pressed', () => {
  assert.equal(transitionAirSpinInput({ steer: 1, spin: 0 }), 0);
  assert.equal(transitionAirSpinInput({ steer: -1, spin: 0 }), 0);
});

test('explicit air spin survives while steering remains independent', () => {
  assert.equal(transitionAirSpinInput({ steer: 0.8, spin: 1 }), 1);
  assert.equal(transitionAirSpinInput({ steer: -0.8, spin: -1 }), -1);
  assert.equal(transitionAirSpinInput({ steer: 0.4, spin: 2 }), 1);
});

test('generic AIR from a ramp cannot rotate from residual steering', () => {
  const p = new StatefulSkillStreetPhysics({
    collision: flatWorld(),
    spawn: [0, 0.5, 0],
    rails: [],
  });
  p.position.set(0, 4, 0);
  p.heading = 0.35;
  p.airHeading = 0.35;
  p.airTakeoffHeading = 0.35;
  p.airTakeoffFromRamp = true;
  p.airSpin = 0;
  p.steer = 1;
  p.velocity.set(0, 2.5, -4);
  p.transitionAir = null;
  p.setMovementState(MOVEMENT_STATE.AIR);
  p.grounded = false;

  const before = p.position.clone();
  p.stepAir(1 / 120, { steer: 1, spin: 0 }, 0, before);
  assert.ok(Math.abs(p.airSpin) < 1e-9, `residual steer created airSpin=${p.airSpin}`);
  assert.ok(Math.abs(p.heading - 0.35) < 1e-9,
    `generic ramp air changed heading without spin input: ${p.heading}`);
});

test('full runtime ramp touchdown keeps airborne yaw on a near-vertical transition', () => {
  const p = new StatefulSkillStreetPhysics({
    collision: flatWorld(),
    spawn: [0, 0.5, 0],
    rails: [],
  });

  const takeoffHeading = THREE.MathUtils.degToRad(2);
  p.position.set(0, 2, 0);
  p.heading = takeoffHeading;
  p.airHeading = takeoffHeading;
  p.airTakeoffHeading = takeoffHeading;
  p.airTakeoffFacing.set(-Math.sin(takeoffHeading), 0, -Math.cos(takeoffHeading));
  p.airTakeoffFromRamp = true;
  p.airTakeoffFakie = false;
  p.airTakeoffStance = 1;
  p.airSpin = 0;
  p.airDirection();
  p.setMovementState(MOVEMENT_STATE.AIR);
  p.grounded = false;
  p.airTime = 0.30;
  p.velocity.set(0, -0.10, 0);

  const support = {
    count: 4,
    frontSupported: 2,
    rearSupported: 2,
    position: p.position.clone(),
    normal: new THREE.Vector3(0, 0.05, 0.99875).normalize(),
  };

  assert.equal(p.land(support), true);
  assert.ok(Math.abs(p.heading - takeoffHeading) < 1e-9,
    `runtime ramp touchdown snapped yaw: expected=${takeoffHeading}, got=${p.heading}`);
});
