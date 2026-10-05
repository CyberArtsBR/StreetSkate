import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  lerpHeading,
  naturalRampReturnProgress,
  rampReturnFacing,
  rampReturnFakie,
  rampReturnHalfTurns,
  transitionAirSpinInput,
} from '../src/game/StableRampReturnSkillStreetPhysics.js';

test('straight same-wall return faces down-ramp without becoming a trick 180', () => {
  const takeoff = new THREE.Vector3(0, 0, -1);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: 0 });
  assert.ok(returned.dot(takeoff) < -0.999999);
  assert.equal(rampReturnHalfTurns(0), 0);
  assert.equal(rampReturnFakie(false, 0), false);
});

test('natural ramp turnaround starts near apex and finishes before touchdown', () => {
  const launchVertical = 8;
  const early = naturalRampReturnProgress({ verticalSpeed: 5, launchVertical });
  const apex = naturalRampReturnProgress({ verticalSpeed: 0, launchVertical });
  const descent = naturalRampReturnProgress({ verticalSpeed: -6, launchVertical });
  assert.ok(early < 0.02, `early progress should be near zero: ${early}`);
  assert.ok(apex > 0.15 && apex < 0.65, `apex should already be turning: ${apex}`);
  assert.ok(descent > 0.95, `descent should be nearly fully aligned: ${descent}`);
});

test('natural turnaround is smooth rather than a one-frame contact snap', () => {
  const start = 0;
  const target = Math.PI;
  const quarter = lerpHeading(start, target, 0.25);
  const half = lerpHeading(start, target, 0.5);
  assert.ok(Math.abs(quarter) > 0.5 && Math.abs(quarter) < 1.1);
  assert.ok(Math.abs(Math.abs(half) - Math.PI / 2) < 1e-6);
});

test('passive ramp return preserves existing fakie state instead of toggling it', () => {
  assert.equal(rampReturnFakie(false, 0), false);
  assert.equal(rampReturnFakie(true, 0), true);
});

test('real explicit 180 is added on top of natural turnaround and toggles fakie', () => {
  const takeoff = new THREE.Vector3(0, 0, -1);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: Math.PI });
  assert.ok(returned.dot(takeoff) > 0.999999);
  assert.equal(rampReturnFakie(false, Math.PI), true);
  assert.equal(rampReturnHalfTurns(Math.PI), 1);
});

test('explicit 360 returns regular after the natural turnaround', () => {
  const takeoff = new THREE.Vector3(1, 0, 0);
  const returned = rampReturnFacing({ takeoffFacing: takeoff, airSpin: Math.PI * 2 });
  assert.ok(returned.dot(takeoff) < -0.999999);
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
