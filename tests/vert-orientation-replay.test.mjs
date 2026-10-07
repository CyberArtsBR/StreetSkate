import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { MOVEMENT_STATE } from '../src/game/StreetPhysics.js';
import { replaySegment, runDeterministicReplay, firstReplayDivergence } from '../src/game/replay/DeterministicReplay.js';

function floorWorld() {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.1, 40), new THREE.MeshBasicMaterial());
  floor.position.y = -0.05;
  root.add(floor);
  root.updateMatrixWorld(true);
  return root;
}

function airborne() {
  const p = new StatefulSkillStreetPhysics({ collision: floorWorld(), spawn: [0, 0.5, 0], rails: [] });
  p.position.set(0, 2.2, 0);
  p.heading = 0;
  p.airHeading = 0;
  p.airTakeoffHeading = 0;
  p.airSpin = 0;
  p.velocity.set(0, 3.2, -6);
  p.grounded = false;
  p.setMovementState(MOVEMENT_STATE.AIR);
  p.airTime = 0.2;
  p.airDirection();
  return p;
}

test('deterministic replay: residual steering cannot rotate airborne yaw', () => {
  const tape = [replaySegment(45, { steer: 1, spin: 0 })];
  const a = runDeterministicReplay({ controller: airborne(), segments: tape });
  const b = runDeterministicReplay({ controller: airborne(), segments: tape });
  assert.equal(firstReplayDivergence(a, b), null);
  for (const frame of a.snapshots) {
    assert.ok(Math.abs(frame.state.airSpin) < 1e-9, `steer leaked into airSpin at ${frame.frame}`);
    assert.ok(Math.abs(frame.state.heading) < 1e-9, `steer changed heading at ${frame.frame}`);
    assert.equal(frame.state.landingYawInvariantViolations, 0);
  }
});

test('deterministic replay: explicit spin is the only airborne yaw command', () => {
  const tape = [
    replaySegment(18, { steer: 1, spin: 0 }),
    replaySegment(24, { steer: 0, spin: 1 }),
    replaySegment(12, { steer: -1, spin: 0 }),
  ];
  const replay = runDeterministicReplay({ controller: airborne(), segments: tape });
  const beforeSpin = replay.snapshots[17].state.heading;
  const afterSpin = replay.snapshots[41].state.heading;
  const afterResidualSteer = replay.snapshots[53].state.heading;
  assert.ok(Math.abs(afterSpin - beforeSpin) > 0.15, 'explicit spin did not rotate the rider');
  assert.ok(Math.abs(afterResidualSteer - afterSpin) < 1e-9,
    'steering continued rotating yaw after explicit spin ended');
});

test('deterministic replay: air orientation remains finite and contact-yaw clean', () => {
  const replay = runDeterministicReplay({
    controller: airborne(),
    segments: [replaySegment(120, { steer: 0.8, spin: 0 })],
  });
  for (const { frame, state } of replay.snapshots) {
    assert.ok(Number.isFinite(state.heading), `non-finite heading at ${frame}`);
    assert.ok(Number.isFinite(state.airSpin), `non-finite airSpin at ${frame}`);
    assert.equal(state.landingYawInvariantViolations, 0);
  }
});
