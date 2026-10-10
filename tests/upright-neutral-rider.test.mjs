import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { halfPipePose } from '../src/character/HalfPipePose.js';
import { riderCrouchOffset, neutralHandOffset, outwardKneePole } from '../src/character/SkatePoseConstraints.js';

test('idle and full-speed cruising do not force a permanent crouch', () => {
  for (const speed of [0, 0.1, 0.5, 1]) {
    const pose = halfPipePose({ charge: 0, speed, air: 0, grab: 0, landing: 0 });
    assert.equal(pose.compression, 0, `speed ${speed} must have a zero baseline crouch`);
    assert.equal(riderCrouchOffset(pose.compression), 0);
  }
});

test('crouch, ollie charge, flight, grabs and landings still compress naturally', () => {
  assert.ok(halfPipePose({ charge: 0.8 }).compression > 0.8);
  assert.ok(halfPipePose({ air: 0.8, vert: true }).compression > 0.7);
  assert.ok(halfPipePose({ grab: 1 }).compression >= 0.86);
  assert.ok(halfPipePose({ landing: 0.6 }).compression > 0.2);
  assert.ok(riderCrouchOffset(1) > riderCrouchOffset(0.4));
  assert.ok(riderCrouchOffset(1) <= 0.185);
});

test('neutral hands sit nearer the body while crouching still changes the reach', () => {
  const left = neutralHandOffset(-1, true, 0, 0, 0);
  const right = neutralHandOffset(1, true, 0, 0, 0);
  assert.ok(left.x < 0 && right.x > 0);
  assert.ok(Math.abs(left.x) < 0.1 && Math.abs(right.x) < 0.1);
  assert.equal(left.y, right.y);
  assert.ok(left.y < -0.25 && left.y > -0.45);
  const crouched = neutralHandOffset(-1, true, 1, 0, 0);
  assert.ok(crouched.x < left.x);
  assert.ok(crouched.y < left.y);
});

test('knee poles retain correct sides without unnecessarily splaying at rest', () => {
  const rest = new THREE.Vector3(0, -0.2, 0.15);
  const neutralL = outwardKneePole(rest, -1, 0);
  const neutralR = outwardKneePole(rest, 1, 0);
  assert.ok(neutralL.x < 0 && neutralR.x > 0);
  assert.ok(Math.abs(neutralL.x) <= 0.1);
  const crouchedL = outwardKneePole(rest, -1, 1);
  assert.ok(Math.abs(crouchedL.x) > Math.abs(neutralL.x));
});
