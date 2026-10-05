import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  naturalRampReturnProgress,
  rampReturnFacing,
  rampReturnFakie,
  rampReturnHalfTurns,
  transitionAirSpinInput,
} from '../src/game/StableRampReturnSkillStreetPhysics.js';

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

test('vert spin ignores steering drift when no explicit spin is pressed', () => {
  assert.equal(transitionAirSpinInput({ steer: 1, spin: 0 }), 0);
  assert.equal(transitionAirSpinInput({ steer: -1, spin: 0 }), 0);
});

test('explicit vert spin survives while steering remains independent', () => {
  assert.equal(transitionAirSpinInput({ steer: 0.8, spin: 1 }), 1);
  assert.equal(transitionAirSpinInput({ steer: -0.8, spin: -1 }), -1);
  assert.equal(transitionAirSpinInput({ steer: 0.4, spin: 2 }), 1);
});
