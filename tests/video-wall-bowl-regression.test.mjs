import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import {
  RAMP_WALL_SAFETY,
  controlledTransferOutwardSpeed,
  controlledTransferProfile,
  isControlledDeckExitTouchdown,
  wallRecoveryContextAllows,
} from '../src/game/RampWallSafetySkillStreetPhysics.js';
import { MOVEMENT_STATE, PHYSICS } from '../src/game/StreetPhysics.js';

function flatWallWorld() {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.1, 12),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  floor.position.y = -0.05;
  root.add(floor);

  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(5, 2.4, 0.10),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  wall.position.set(0, 1.2, -0.34);
  wall.userData.surface = 'solid';
  root.add(wall);
  root.updateMatrixWorld(true);
  return root;
}

function physics() {
  return new StatefulSkillStreetPhysics({
    collision: flatWallWorld(),
    spawn: [0, 0.5, 1.5],
    rails: [],
  });
}

test('steep ramp context cannot fire 90-degree wall recovery', () => {
  assert.equal(wallRecoveryContextAllows({
    groundNormalY: 0.72,
    verticalSpeed: 5.4,
    hitNormalY: 0.01,
  }), false);
  assert.equal(wallRecoveryContextAllows({
    groundNormalY: 0.98,
    verticalSpeed: 2.1,
    hitNormalY: 0.01,
  }), false);
});

test('real flat-ground wall remains eligible for 90-degree recovery', () => {
  assert.equal(wallRecoveryContextAllows({
    groundNormalY: 1,
    verticalSpeed: 0,
    hitNormalY: 0,
  }), true);

  const p = physics();
  p.position.set(0, 0.015, 0);
  p.normal.set(0, 1, 0);
  p.heading = 0;
  p.groundDirection();
  p.setMovementState(MOVEMENT_STATE.GROUND);
  p.velocity.set(0, 0, -8);
  p.rollingSign = 1;
  p.wallImpactCooldown = 0;

  const hit = p.detectGroundWallImpact(1 / 120);
  assert.ok(hit, 'real wall should be detected');
  assert.ok(Math.abs(hit.normal.y) <= RAMP_WALL_SAFETY.wallFaceMaxY + 1e-6);
  p.applyWallRecovery(hit);
  assert.ok(Math.abs(p.velocity.z) < 0.15,
    `wall recovery should redirect along wall tangent, z=${p.velocity.z}`);
  assert.ok(Math.abs(p.velocity.x) > 2.5,
    `wall recovery should keep useful tangent speed, x=${p.velocity.x}`);
});

test('high-speed bowl exit is range bounded instead of 12.8 m/s cannon', () => {
  const profile = controlledTransferProfile(20, 12.5);
  assert.ok(profile.horizontalSpeed <= 6.4, `horizontal exit too fast: ${profile.horizontalSpeed}`);
  assert.ok(profile.verticalSpeed <= 7.2, `vertical exit too strong: ${profile.verticalSpeed}`);
  assert.ok(profile.targetDistance <= 2.55, `deck target too far: ${profile.targetDistance}`);
  assert.ok(profile.targetDistance >= 1.15);
});

test('controlled transfer decelerates after apex instead of accelerating toward void', () => {
  const profile = controlledTransferProfile(20, 12.5);
  const beforeApex = controlledTransferOutwardSpeed({
    apexPassed: false,
    outwardDistance: 1,
    targetDistance: profile.targetDistance,
    initialSpeed: profile.horizontalSpeed,
    age: 0.2,
  });
  const afterTarget = controlledTransferOutwardSpeed({
    apexPassed: true,
    outwardDistance: profile.targetDistance + 0.8,
    targetDistance: profile.targetDistance,
    initialSpeed: profile.horizontalSpeed,
    age: 0.6,
  });
  assert.ok(beforeApex > afterTarget,
    `transfer should slow after apex: ${beforeApex} -> ${afterTarget}`);
  assert.ok(afterTarget <= RAMP_WALL_SAFETY.exitLandingMaxSpeed);
});

test('simulated bowl exit stays inside a short deck landing corridor', () => {
  const p = physics();
  p.position.set(0, 0.1, 0);
  const profile = controlledTransferProfile(20, 12.5);
  p.velocity.set(0, profile.verticalSpeed, -profile.horizontalSpeed);
  p.transitionAir = {
    mode: 'transfer',
    transferring: true,
    apexPassed: false,
    age: 0,
    lateralVelocity: 0,
    launchVertical: profile.verticalSpeed,
    exitControl: profile,
    frame: {
      lipPoint: new THREE.Vector3(0, 0, 0),
      deckOutward: new THREE.Vector3(0, 0, -1),
      copingTangent: new THREE.Vector3(1, 0, 0),
    },
  };

  const dt = 1 / 120;
  for (let i = 0; i < 120; i++) {
    p.velocity.y -= PHYSICS.gravity * dt;
    p.advanceControlledTransfer(p.transitionAir, dt);
    p.position.addScaledVector(p.velocity, dt);
  }
  const outward = -p.position.z;
  assert.ok(outward > 1.0, `exit did not clear coping: ${outward}`);
  assert.ok(outward < 4.3, `exit still overshot deck corridor: ${outward}`);
});

test('one-wheel flat deck touchdown is only bridged during controlled coping exit', () => {
  const support = {
    count: 1,
    frontSupported: 1,
    rearSupported: 0,
    normal: new THREE.Vector3(0, 1, 0),
  };
  assert.equal(isControlledDeckExitTouchdown(support, {
    transferring: true,
  }), true);
  assert.equal(isControlledDeckExitTouchdown(support, null), false,
    'ordinary flat-air landing must keep the stricter rule');
  assert.equal(isControlledDeckExitTouchdown({ ...support, count: 0 }, {
    transferring: true,
  }), false);
});
