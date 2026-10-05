import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { MOVEMENT_STATE } from '../src/game/StreetPhysics.js';
import {
  WALL_CONTACT_AUTHORITY,
  wallClearanceCorrection,
  wallFaceContextAllows,
  wallFaceContinuityAllows,
} from '../src/game/WallContactAuthoritySkillStreetPhysics.js';

function worldWithObstacle({ width = 5, height = 2.4 } = {}) {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 12), material);
  floor.position.y = -0.05;
  root.add(floor);

  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.10), material.clone());
  obstacle.position.set(0, height * 0.5, -0.34);
  obstacle.userData.surface = 'solid';
  root.add(obstacle);
  root.updateMatrixWorld(true);
  return root;
}

function physics(root) {
  const p = new StatefulSkillStreetPhysics({
    collision: root,
    spawn: [0, 0.5, 1.5],
    rails: [],
  });
  p.position.set(0, 0.015, 0);
  p.normal.set(0, 1, 0);
  p.heading = 0;
  p.groundDirection();
  p.setMovementState(MOVEMENT_STATE.GROUND);
  p.velocity.set(0, 0, -8);
  p.rollingSign = 1;
  p.fakie = false;
  p.wallImpactCooldown = 0;
  p.rampReentrySteerLock = 0;
  return p;
}

test('triangulated or bevelled real wall normals are still eligible', () => {
  assert.equal(wallFaceContextAllows({
    groundNormalY: 1,
    verticalSpeed: 0.2,
    hitNormalY: 0.12,
  }), true);
  assert.equal(wallFaceContextAllows({
    groundNormalY: 0.72,
    verticalSpeed: 4,
    hitNormalY: 0.02,
  }), false, 'a steep ramp must never become a wall');
});

test('wall authority requires vertical and lateral continuity', () => {
  assert.equal(wallFaceContinuityAllows({
    low: true, high: true, lateralLeft: true, lateralRight: false,
  }), true);
  assert.equal(wallFaceContinuityAllows({
    low: true, high: true, lateralLeft: false, lateralRight: false,
  }), false, 'a narrow post/rail cannot trigger the 90 degree recovery');
  assert.equal(wallFaceContinuityAllows({
    low: false, high: true, lateralLeft: true, lateralRight: true,
  }), false, 'a floating handrail is not a full wall face');
});

test('broad wall triggers the intended 90 degree automatic recovery', () => {
  const p = physics(worldWithObstacle({ width: 5, height: 2.4 }));
  const hit = p.detectGroundWallImpact(1 / 120);
  assert.ok(hit?.broadWall, 'broad wall should be classified as authoritative');
  assert.equal(p.applyWallRecovery(hit), true);
  assert.ok(Math.abs(p.velocity.z) < 0.2,
    `head-on wall impact should turn onto wall tangent, z=${p.velocity.z}`);
  assert.ok(Math.abs(p.velocity.x) > 2.5,
    `wall recovery should preserve useful tangent speed, x=${p.velocity.x}`);
});

test('thin stair rail/post can collide but cannot trigger wall-turn recovery', () => {
  const p = physics(worldWithObstacle({ width: 0.12, height: 2.4 }));
  const hit = p.detectGroundWallImpact(1 / 120);
  assert.equal(hit, null,
    'single narrow collision column must not be interpreted as a broad wall');
});

test('verified wall recovery restores body clearance before redirecting', () => {
  assert.ok(wallClearanceCorrection(0.10) > 0.15);
  assert.equal(wallClearanceCorrection(WALL_CONTACT_AUTHORITY.bodyClearance + 0.05), 0);

  const p = physics(worldWithObstacle());
  p.position.set(0, 0.015, 0.10);
  p.travelDirection.set(0, 0, -1);
  const hit = {
    point: new THREE.Vector3(0, 0.30, 0),
    normal: new THREE.Vector3(0, 0, 1),
    speed: 8,
    approach: 1,
    broadWall: true,
  };
  p.applyWallRecovery(hit);
  const separation = p.position.clone().sub(hit.point).dot(hit.normal);
  assert.ok(separation >= WALL_CONTACT_AUTHORITY.bodyClearance - 1e-6,
    `wall recovery must push capsule out before turn, separation=${separation}`);
});
