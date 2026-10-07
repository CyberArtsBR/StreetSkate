import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { CoreSkateController } from '../src/game/core/CoreSkateController.js';

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
  const surface = floorWorld();
  const core = new CoreSkateController({ surface, rails: [] });
  assert.ok(core.state);
  assert.ok(core.transitions);
  assert.ok(core.collision);
  assert.equal(core.collision.surface.root, surface);
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
  const core = new CoreSkateController({ surface: floorWorld(), rails: [] });
  const result = core.collision.resolveBody({
    from: new THREE.Vector3(0, 0.5, 0),
    desired: new THREE.Vector3(0, 0.5, -1),
    velocity: new THREE.Vector3(0, 0, -5),
    grounded: false,
  });

  assert.equal(Object.hasOwn(result, 'heading'), false);
  assert.equal(Object.hasOwn(result, 'yaw'), false);
});
