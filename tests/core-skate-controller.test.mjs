import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { CoreSkateController } from '../src/game/core/CoreSkateController.js';
import { ParkCollision } from '../src/game/ParkCollision.js';

function floorWorld() {
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

test('core composition root owns canonical state, transitions and collision', () => {
  const root = floorWorld();
  const surface = new ParkCollision(root);
  const core = new CoreSkateController({ surface, rails: [] });
  assert.ok(core.state);
  assert.ok(core.transitions);
  assert.ok(core.collision);
  assert.equal(core.collision.surface, surface);
});

test('final physics runtime shares the exact services owned by CoreSkateController', () => {
  const p = new StatefulSkillStreetPhysics({
    collision: floorWorld(),
    spawn: [0, 0.5, 0],
    rails: [],
  });

  assert.ok(p.coreController instanceof CoreSkateController);
  assert.equal(p.playerState, p.coreController.state);
  assert.equal(p.transitions, p.coreController.transitions);
  assert.equal(p.transitionController, p.coreController.transitions);
  assert.equal(p.ensureCollisionResolver(), p.coreController.collision);

  p.syncCanonicalState();
  assert.equal(p.playerState, p.coreController.state);
});

test('core collision result contract has no yaw or heading authority', () => {
  const core = new CoreSkateController({ surface: new ParkCollision(floorWorld()), rails: [] });
  const result = core.collision.resolveBody({
    from: new THREE.Vector3(0, 0.5, 0),
    desired: new THREE.Vector3(0, 0.5, -1),
    velocity: new THREE.Vector3(0, 0, -5),
    grounded: false,
  });

  assert.equal(Object.hasOwn(result, 'heading'), false);
  assert.equal(Object.hasOwn(result, 'yaw'), false);
});


test('core composition root owns semantic ollie command interpretation', () => {
  const core = new CoreSkateController({ surface: new ParkCollision(floorWorld()), rails: [] });
  assert.equal(core.interpretOllieRelease({
    ollieReleased: true,
    grinding: true,
    grounded: false,
  }), 'GRIND_OLLIE_OUT');
  assert.equal(core.interpretOllieRelease({
    ollieReleased: true,
    grounded: true,
    nearCoping: true,
    pumpEligible: true,
    pumpHoldTime: 1,
  }), 'VERT_OLLIE');
  assert.equal(core.interpretOllieRelease({
    ollieReleased: true,
    grounded: true,
    pumpEligible: true,
    pumpHoldTime: 0.2,
    pumpCooldown: 0,
  }), 'PUMP');
});
