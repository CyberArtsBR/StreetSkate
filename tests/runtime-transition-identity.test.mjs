import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { captureGameplayState } from '../src/game/core/GameplayStateSnapshot.js';
import { PlayerState } from '../src/game/core/PlayerState.js';
import { TRANSITION_TYPE } from '../src/game/transitions/TransitionMetadata.js';

function flatWorld() {
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

function transitionEdge(name) {
  return {
    name,
    lipPoint: new THREE.Vector3(0, 2, 0),
    copingTangent: new THREE.Vector3(1, 0, 0),
    rampInward: new THREE.Vector3(0, 0, 1),
    deckOutward: new THREE.Vector3(0, 0, -1),
    surfaceNormal: new THREE.Vector3(0, 0.08, 1).normalize(),
    gap: 0.1,
  };
}

function airborneFrom(edge) {
  const physics = new StatefulSkillStreetPhysics({
    collision: flatWorld(),
    spawn: [0, 0.5, 0],
    rails: [],
  });
  physics.position.set(0, 1.9, 0.18);
  physics.normal.set(0, 0.08, 1).normalize();
  physics.velocity.set(0, 7.2, -3.1);
  physics.grounded = true;
  physics.takeoff(0, edge);
  return physics;
}

test('authored quarter transitionAir carries canonical transition identity', () => {
  const physics = airborneFrom(transitionEdge('04 / eastern quarter coping'));
  assert.ok(physics.transitionAir);
  assert.equal(physics.transitionAir.transitionId, 'eastern-quarter');
  assert.equal(physics.transitionAir.transitionType, TRANSITION_TYPE.QUARTER);
  assert.equal(physics.transitionAir.supportsTransfer, true);
  assert.equal(physics.transitionAir.supportsPump, true);

  const snapshot = captureGameplayState(physics);
  assert.equal(snapshot.transitionId, 'eastern-quarter');
  assert.equal(snapshot.transitionType, TRANSITION_TYPE.QUARTER);
  assert.equal(snapshot.transitionActive, true);

  const canonical = new PlayerState().syncFromLegacy(physics);
  assert.equal(canonical.transitionId, 'eastern-quarter');
  assert.equal(canonical.transitionType, TRANSITION_TYPE.QUARTER);
});

test('unmapped legacy candidate cannot invent canonical transition identity', () => {
  const physics = airborneFrom(transitionEdge('random coping name'));
  assert.ok(physics.transitionAir);
  assert.equal(physics.transitionAir.transitionId, undefined);
  assert.equal(physics.transitionAir.transitionType, undefined);

  const snapshot = captureGameplayState(physics);
  assert.equal(snapshot.transitionActive, true);
  assert.equal(snapshot.transitionId, null);
  assert.equal(snapshot.transitionType, null);

  const canonical = new PlayerState().syncFromLegacy(physics);
  assert.equal(canonical.transitionId, null);
  assert.equal(canonical.transitionType, null);
});
