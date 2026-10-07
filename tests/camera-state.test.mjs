import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CAMERA_MODE,
  captureCameraState,
  resolveCameraMode,
  resolveCameraTravelDirection,
} from '../src/game/core/CameraState.js';

test('camera state clones mutable gameplay vectors', () => {
  const player = {
    position: new THREE.Vector3(2, 3, 4),
    travelDirection: new THREE.Vector3(0, 0, -1),
    velocity: new THREE.Vector3(0, 0, -5),
    forward: new THREE.Vector3(0, 0, -1),
    grounded: true,
    fakie: false,
  };
  const state = captureCameraState(player);
  assert.equal(Object.isFrozen(state), true);
  assert.notEqual(state.position, player.position);
  assert.notEqual(state.travelDirection, player.travelDirection);

  state.position.set(99, 99, 99);
  state.travelDirection.set(1, 0, 0);
  assert.deepEqual(player.position.toArray(), [2, 3, 4]);
  assert.deepEqual(player.travelDirection.toArray(), [0, 0, -1]);
});

test('canonical travel direction outranks instantaneous deck or velocity direction', () => {
  const direction = resolveCameraTravelDirection({
    travelDirection: new THREE.Vector3(0, 0, -1),
    velocity: new THREE.Vector3(0, 0, 1),
    forward: new THREE.Vector3(0, 0, 1),
    fakie: true,
  }, new THREE.Vector3(1, 0, 0), true);
  assert.ok(direction.z < -0.999);
});

test('previous camera side survives a near-zero-speed frame when canonical travel is absent', () => {
  const direction = resolveCameraTravelDirection({
    travelDirection: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0.01, 0, 0.01),
    forward: new THREE.Vector3(1, 0, 0),
    fakie: false,
  }, new THREE.Vector3(0, 0, -1), true);
  assert.ok(direction.z < -0.999);
});

test('fakie fallback follows world travel rather than deck nose', () => {
  const direction = resolveCameraTravelDirection({
    travelDirection: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    forward: new THREE.Vector3(0, 0, 1),
    fakie: true,
  }, null, false);
  assert.ok(direction.z < -0.999);
});

test('camera snapshot exposes state flags without carrying the physics controller', () => {
  const player = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
    grounded: false,
    fakie: true,
    movementState: 'VERT_AIR',
    transitionAir: {},
    grind: null,
    manual: null,
  };
  const state = captureCameraState(player, { initialized: false });
  assert.equal(state.grounded, false);
  assert.equal(state.fakie, true);
  assert.equal(state.movementState, 'VERT_AIR');
  assert.equal(state.transitionActive, true);
  assert.equal(Object.hasOwn(state, 'surface'), false);
  assert.equal(Object.hasOwn(state, 'controller'), false);
});


test('camera mode resolver owns vert ascent/descent and transfer context', () => {
  const base = {
    grounded: false,
    velocity: new THREE.Vector3(0, 3, -5),
    transitionAir: { transferring: false },
  };
  assert.equal(resolveCameraMode(base), CAMERA_MODE.VERT_ASCENT);
  base.velocity.y = -2;
  assert.equal(resolveCameraMode(base), CAMERA_MODE.VERT_DESCENT);
  base.transitionAir.transferring = true;
  assert.equal(resolveCameraMode(base), CAMERA_MODE.TRANSFER);
});

test('camera mode priority is deterministic for grind manual bail and ordinary air', () => {
  assert.equal(resolveCameraMode({ grounded: true }), CAMERA_MODE.GROUND);
  assert.equal(resolveCameraMode({ grounded: false }), CAMERA_MODE.AIR);
  assert.equal(resolveCameraMode({ grounded: true, manual: 'manual' }), CAMERA_MODE.MANUAL);
  assert.equal(resolveCameraMode({ grounded: false, grind: {} }), CAMERA_MODE.GRIND);
  assert.equal(resolveCameraMode({ grounded: true, bailTime: 0.4, grind: {} }), CAMERA_MODE.BAIL);
});
