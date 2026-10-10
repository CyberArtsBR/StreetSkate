import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FollowCamera } from '../src/game/FollowCamera.js';
import { ParkCollision } from '../src/game/ParkCollision.js';

test('default follow stays third person along a wall blocking its chase arm', () => {
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 1), new THREE.MeshBasicMaterial());
  wall.position.set(0, 10, 0.5);
  root.add(wall);
  const player = {
    position: new THREE.Vector3(0, 2, -0.35),
    travelDirection: new THREE.Vector3(1, 0, 0),
    grounded: false,
    wallRide: { normal: new THREE.Vector3(0, 0, -1) },
    surface: new ParkCollision(root),
    visual: new THREE.Group(),
  };
  const camera = new THREE.PerspectiveCamera(58);
  const follow = new FollowCamera(camera);
  follow.occlusionDistance = 0.2;
  // Enter the wallride while the camera is still turning from the approach.
  follow.direction.set(0, 0, -1);
  follow.initialized = true;
  follow.followCenter = player.position.clone();
  for (let frame = 0; frame < 90; frame++) {
    follow.update(player, 1 / 60);
    assert.equal(follow.mode, 'follow');
    assert.equal(camera.fov, 58);
    assert.equal(player.visual.visible, true);
    const anchor = player.position.clone().add(new THREE.Vector3(0, 1.15, 0));
    assert.ok(camera.position.distanceTo(anchor) >= 3.3);
    assert.ok(camera.position.z < 0, 'camera must remain outside the wall');
    assert.ok(player.surface.camera(anchor, camera.position).distanceTo(camera.position) < 1e-6);
    player.position.x += 0.05;
  }
  player.wallRide = null;
  for (let frame = 0; frame < 60; frame++) follow.update(player, 1 / 60);
  assert.equal(player.visual.visible, true);
  assert.equal(follow.mode, 'follow');
});


