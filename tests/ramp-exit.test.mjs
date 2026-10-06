import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TransitionGuide, wantsRampExit } from '../src/game/TransitionGuide.js';
import { shouldReleaseRampLip } from '../src/game/StableBoardContactSkillStreetPhysics.js';
import { shouldBufferRampExit } from '../src/game/MomentumRollSkillStreetPhysics.js';

test('Up is a contextual ramp-exit command', () => {
  assert.equal(wantsRampExit({ drive: 1 }), true);
  assert.equal(wantsRampExit({ drive: 0, directionTaps: ['up'] }), true);
  assert.equal(wantsRampExit({ drive: 0 }), false);
});

test('Up only buffers while actually climbing a sloped surface', () => {
  assert.equal(shouldBufferRampExit({ drive: 1, normalY: 0.86, verticalSpeed: 4 }), true);
  assert.equal(shouldBufferRampExit({ drive: 1, normalY: 1, verticalSpeed: 4 }), false);
  assert.equal(shouldBufferRampExit({ drive: 1, normalY: 0.86, verticalSpeed: -1 }), false);
});

test('regular riding releases when front truck clears an uphill lip', () => {
  assert.equal(shouldReleaseRampLip({
    normalY: 0.82,
    verticalSpeed: 3.2,
    speed: 9,
    contactCount: 2,
    frontSupported: 0,
    rearSupported: 2,
    travelSign: 1,
  }), true);
});

test('fakie riding releases when rear truck clears an uphill lip', () => {
  assert.equal(shouldReleaseRampLip({
    normalY: 0.82,
    verticalSpeed: 3.2,
    speed: 9,
    contactCount: 2,
    frontSupported: 2,
    rearSupported: 0,
    travelSign: -1,
  }), true);
});

test('flat seams and downhill partial contacts never masquerade as ramp takeoff', () => {
  assert.equal(shouldReleaseRampLip({
    normalY: 1,
    verticalSpeed: 2,
    speed: 9,
    contactCount: 2,
    frontSupported: 0,
    rearSupported: 2,
    travelSign: 1,
  }), false);
  assert.equal(shouldReleaseRampLip({
    normalY: 0.82,
    verticalSpeed: -2,
    speed: 9,
    contactCount: 2,
    frontSupported: 0,
    rearSupported: 2,
    travelSign: 1,
  }), false);
});

test('authored coping accepts a realistic averaged wheel normal and buffered Up launches outward', () => {
  const guide = new TransitionGuide([{
    name: '04 / eastern quarter coping',
    points: [[-3, 2, 0], [3, 2, 0]],
  }]);
  const position = new THREE.Vector3(0, 1.72, 0.34);
  const normal = new THREE.Vector3(0, 0.82, 0.57).normalize();
  const velocity = new THREE.Vector3(0, 5.1, -7.4);
  const edge = guide.launchAt(position, normal, velocity);
  assert.ok(edge, 'authored transition capture should tolerate averaged wheel normal');
  edge.exitRequested = true;
  const air = guide.begin(position, velocity, edge, { boardForward: new THREE.Vector3(0, 0, -1) });
  assert.equal(air.transferring, true);
  assert.ok(velocity.clone().setY(0).dot(edge.deckOutward) > 4.5, 'launch should begin outward, not inward');
  assert.ok(velocity.y > 3, 'outward transfer must retain usable airtime');
});

test('an arbitrary rail name containing coping is not a transition without authored metadata', () => {
  const guide = new TransitionGuide([{
    name: 'Random coping decoration',
    points: [[-3, 2, 0], [3, 2, 0]],
  }]);
  assert.equal(guide.edges.length, 0);
});
