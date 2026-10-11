import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadGeometry } from '../tools/load-geometry.mjs';
import { UnrealRider } from '../src/character/UnrealRider.js';
import { StreetBoard } from '../src/skateboard/StreetBoard.js';
import { plantedFootWorldPoint } from '../src/character/FootOrientation.js';
import { halfPipePose } from '../src/character/HalfPipePose.js';
import { flipMotion } from '../src/character/TrickMotion.js';

const v = () => new THREE.Vector3();
const avatars = ['The_Heretic', 'The_Anchor', 'The_AdolescentUR', 'TheanchoURi', 'TuxR'];
function boardFixture() {
  const board = new StreetBoard('/unused');
  board.deckHeight = .12;
  board.contactRig = { deckTopY: .14, deckWidth: .42, deckLength: 1.1 };
  board.update({ dt: 0 });
  return board;
}
function settle(rider, board, parameters) {
  rider.resetPresentation();
  for (let i = 0; i < 40; i++) rider.update({ board, dt: 1 / 60, ...parameters });
  return rider.bones.pelvis.getWorldPosition(v()).y;
}
function flex(rider, side) {
  const hip = rider.bones['thigh_' + side].getWorldPosition(v());
  const knee = rider.bones['calf_' + side].getWorldPosition(v());
  const ankle = rider.bones['foot_' + side].getWorldPosition(v());
  return Math.PI - hip.sub(knee).angleTo(ankle.sub(knee));
}
function anchor(rider, board, side, yaw = board._yawHold) {
  const p = rider.feet[side].point;
  return plantedFootWorldPoint(board, THREE.MathUtils.clamp(p.x, -.1806, .1806),
    .02 + rider.soleOffsets[side], THREE.MathUtils.clamp(p.z, -.429, .429), v(), yaw);
}

for (const name of avatars) {
  test(name + ': actual GLB has a deep crouch, forward knees and planted shoes', async () => {
    const rider = new UnrealRider(name).configureModel(await loadGeometry(`public/assets/rider/${name}.glb`));
    const board = boardFixture();
    const idle = settle(rider, board, { presentation: { state: 'IDLE' } });
    for (const side of ['l','r']) {
      const shoulder=rider.bones['upperarm_'+side].getWorldPosition(v());
      const elbow=rider.bones['lowerarm_'+side].getWorldPosition(v());
      const wrist=rider.bones['hand_'+side].getWorldPosition(v());
      const armFlex=Math.PI-shoulder.clone().sub(elbow).angleTo(wrist.clone().sub(elbow));
      const direction=wrist.clone().sub(shoulder).normalize();
      assert.ok(armFlex<THREE.MathUtils.degToRad(22),`${name}/${side}: resting elbow folds outward`);
      assert.ok(direction.dot(rider.armOutward[side])>.58,`${name}/${side}: A-pose must clear the torso`);
      assert.ok(direction.y<-.7,`${name}/${side}: resting arms should angle downward`);
    }
    const idleFlex = ['l', 'r'].map(s => flex(rider, s));
    const crouch = settle(rider, board, { presentation: { state: 'CROUCH' }, crouch: 1 });
    assert.ok(idle - crouch > .13, `${name}: hip drop ${idle - crouch}`);
    assert.ok(rider.kneeForward.x > .75, `${name}: anatomical forward must not follow T-pose knee noise`);
    for (const [i, side] of ['l', 'r'].entries()) {
      assert.ok(flex(rider, side) > 1.8 && flex(rider, side) < 2.5, `${name}: flex ${flex(rider, side)}`);
      assert.ok(flex(rider, side) > idleFlex[i] + .7);
      assert.ok(rider.bones['foot_' + side].getWorldPosition(v()).distanceTo(anchor(rider, board, side)) < .012);
      const hip = rider.bones['thigh_' + side].getWorldPosition(v());
      const knee = rider.bones['calf_' + side].getWorldPosition(v());
      assert.ok(knee.sub(hip).dot(rider.kneeForward) > .03, 'both knees bend toward the toes');
    }
    for (const bone of rider.rest.keys()) assert.ok(bone.quaternion.toArray().every(Number.isFinite));
    rider.dispose();
  });

  test(name + ': flip catch returns to the same anchors through shove yaw and switch stance', async () => {
    const rider = new UnrealRider(name).configureModel(await loadGeometry(`public/assets/rider/${name}.glb`));
    for (const stance of [1, -1]) for (const yaw of [0, .5, -.5, 1]) {
      const board = boardFixture();
      const flipState = { name: yaw ? 'Pop Shove-it' : 'Kickflip', yaw, roll: yaw ? 0 : 1, pitch: 0, progress: 0 };
      rider.resetPresentation();
      for (let frame = 0; frame <= 60; frame++) {
        flipState.progress = frame / 60;
        board.update({ flipState, airborne: true, dt: 1 / 60 });
        rider.update({ board, flipState, stance, presentation: { state: 'AIR' }, dt: 1 / 60 });
        for (const bone of rider.rest.keys()) assert.ok(bone.quaternion.toArray().every(Number.isFinite));
      }
      for (const side of ['l', 'r']) {
        const caught = rider.bones['foot_' + side].getWorldPosition(v());
        assert.ok(caught.distanceTo(anchor(rider, board, side, yaw * Math.PI * 2)) < .015,
          `${name}/${stance}/${yaw}: missed catch by ${caught.distanceTo(anchor(rider, board, side, yaw * Math.PI * 2))}`);
      }
      board.update({ airborne: true, dt: 1 / 60 });
      rider.update({ board, stance, presentation: { state: 'AIR' }, dt: 1 / 60 });
      for (const side of ['l', 'r']) assert.ok(rider.bones['foot_' + side].getWorldPosition(v())
        .distanceTo(anchor(rider, board, side)) < .015, 'finishing a shove must not cross the legs');
    }
    rider.dispose();
  });
}

test('takeoff extends from the charged crouch before gathering knees in flight', () => {
  const charge = halfPipePose({ charge: 1 });
  const pop = halfPipePose({ air: 1, popProgress: 0 });
  const tuck = halfPipePose({ air: 1, popProgress: 1 });
  assert.ok(charge.compression > tuck.compression && tuck.compression > pop.compression + .4);
});

test('flip has asymmetric flick/tuck and zero foot offsets at catch', () => {
  const pop = flipMotion(.15), flick = flipMotion(.34), spin = flipMotion(.6), catchPose = flipMotion(.94);
  assert.ok(pop.rearLift > pop.frontLift);
  assert.ok(flick.flick > .9 && flick.frontLift > flick.rearLift);
  assert.ok(spin.frontLift > .25 && spin.rearLift > .22);
  assert.equal(catchPose.frontLift, 0);
  assert.equal(catchPose.rearLift, 0);
  assert.equal(catchPose.flick, 0);
  assert.equal(catchPose.rotation, 1);
});
