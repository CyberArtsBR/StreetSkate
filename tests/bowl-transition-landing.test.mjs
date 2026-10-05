import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import {
  transitionLandingSupportMode,
  transitionFlipLandingMode,
  transitionAlignmentThreshold,
} from '../src/game/BowlLandingSkillStreetPhysics.js';
import { MOVEMENT_STATE } from '../src/game/StreetPhysics.js';

function floorWorld() {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.1, 20), new THREE.MeshBasicMaterial());
  floor.position.y = -0.05;
  root.add(floor);
  root.updateMatrixWorld(true);
  return root;
}

function physics() {
  return new StatefulSkillStreetPhysics({ collision: floorWorld(), spawn: [0, 0.5, 0], rails: [] });
}

function bowlSupport({ progress = 0.60 } = {}) {
  const normal = new THREE.Vector3(0, 0.72, 0.694).normalize();
  return {
    supported: true,
    count: 2,
    frontSupported: 2,
    rearSupported: 0,
    position: new THREE.Vector3(0, 0.18, -0.1),
    supportPoint: new THREE.Vector3(0, 0.16, -0.1),
    normal,
    maxWheelGap: 0.06,
    progress,
  };
}

function armAirLanding(p, support, progress) {
  p.position.copy(support.position).addScaledVector(support.normal, 0.04);
  p.heading = 0;
  p.airHeading = 0;
  p.airTime = 0.34;
  p.setMovementState(MOVEMENT_STATE.AIR);
  p.forward.set(0, 0, -1);
  const tangent = new THREE.Vector3(0, 0, -1).projectOnPlane(support.normal).normalize();
  p.velocity.copy(tangent).multiplyScalar(5).addScaledVector(support.normal, -1.1);
  p.flipState = { name: 'Kickflip', progress, duration: 0.42, roll: 1, pitch: 0, yaw: 0 };
}

test('curved bowl allows one-truck first touchdown', () => {
  const support = bowlSupport();
  assert.equal(transitionLandingSupportMode(support), 'truckFirst');
});

test('flat partial-truck contact remains rejected', () => {
  const support = bowlSupport();
  support.normal.set(0, 1, 0);
  assert.equal(transitionLandingSupportMode(support), 'reject');
});

test('bowl flip gets earlier THPS-style auto-catch than flat ground', () => {
  assert.equal(transitionFlipLandingMode(0.52, 0.72, true), 'autoCatch');
  assert.equal(transitionFlipLandingMode(0.52, 1, false), 'bail');
  assert.ok(transitionAlignmentThreshold(0.72, true) < transitionAlignmentThreshold(1, false));
});

test('advanced kickflip lands on bowl from first truck contact', () => {
  const p = physics();
  const support = bowlSupport();
  armAirLanding(p, support, 0.58);
  const landed = p.land(support);
  assert.equal(landed, true, 'truck-first bowl touchdown should be accepted');
  assert.equal(p.grounded, true, 'rider should reconnect to bowl');
  assert.equal(p.bailTime > 0, false, 'completed-enough flip must not bail on bowl');
  assert.equal(p.flipState, null, 'flip should be caught at touchdown');
});

test('very early flip can still bail on bowl', () => {
  const p = physics();
  const support = bowlSupport();
  armAirLanding(p, support, 0.20);
  const landed = p.land(support);
  assert.equal(landed, false);
  assert.equal(p.bailTime > 0, true, 'very early rotation should still be unsafe');
});
