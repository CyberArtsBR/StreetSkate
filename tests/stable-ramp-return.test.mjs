import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  rampReturnFacing,
  rampReturnFakie,
  rampReturnHalfTurns,
} from '../src/game/StableRampReturnSkillStreetPhysics.js';

test('straight ramp return preserves takeoff facing instead of snapping 180', () => {
  const takeoff = new THREE.Vector3(0, 0, -1);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: 0 });
  assert.ok(returned.dot(takeoff) > 0.999999);
});

test('passive reversal down the ramp does not toggle fakie state', () => {
  assert.equal(rampReturnFakie(false, 0), false);
  assert.equal(rampReturnFakie(true, 0), true);
});

test('real 180 flips facing and toggles fakie', () => {
  const takeoff = new THREE.Vector3(0, 0, -1);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: Math.PI });
  assert.ok(returned.dot(takeoff) < -0.999999);
  assert.equal(rampReturnFakie(false, Math.PI), true);
  assert.equal(rampReturnHalfTurns(Math.PI), 1);
});

test('360 preserves facing and fakie state', () => {
  const takeoff = new THREE.Vector3(1, 0, 0);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: Math.PI * 2 });
  assert.ok(returned.dot(takeoff) > 0.999999);
  assert.equal(rampReturnFakie(false, Math.PI * 2), false);
  assert.equal(rampReturnHalfTurns(Math.PI * 2), 2);
});

test('small steering noise cannot be mistaken for a 180', () => {
  const takeoff = new THREE.Vector3(0.2, 0, -1).normalize();
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: THREE.MathUtils.degToRad(35) });
  assert.ok(returned.dot(takeoff) > 0.999999);
  assert.equal(rampReturnHalfTurns(THREE.MathUtils.degToRad(35)), 0);
  assert.equal(rampReturnFakie(false, THREE.MathUtils.degToRad(35)), false);
});
