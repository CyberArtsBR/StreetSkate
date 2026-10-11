import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadGeometry } from '../tools/load-geometry.mjs';
import { buildImportedWarehouseCollision, warehouseObjectName } from '../src/park/ImportedWarehouseCollision.js';
import { createWarehousePark } from '../src/park/WarehousePark.js';
import { prepareParkRuntime } from '../src/game/ParkRegistry.js';
import { compileTransitionMetadata } from '../src/game/transitions/TransitionMetadata.js';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { FollowCamera } from '../src/game/FollowCamera.js';

const scene = await loadGeometry('public/assets/warehouse/urban-warehouse.glb');
const world = createWarehousePark({ textures: false });
const imported = buildImportedWarehouseCollision(scene, world.manifest.rails);
world.collision = imported.collision;
world.manifest.rails = imported.rails;
const runtime = prepareParkRuntime(world);

test('stair handrails and support posts cannot pull the camera inside the rider', () => {
  let samples = 0;
  scene.traverse(mesh => {
    if (!mesh.isMesh || !/Step_\d|Upper_Stair_Platform/.test(warehouseObjectName(mesh))) return;
    const bounds = new THREE.Box3().setFromObject(mesh);
    for (const offset of [-1.5, 0, 1.5]) for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
      const position = bounds.getCenter(new THREE.Vector3());
      position.y = bounds.max.y + .015; position.x += offset;
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const player = { position, forward, velocity: forward.clone().multiplyScalar(17), grounded: true, surface: runtime.surface };
      const camera = new FollowCamera(new THREE.PerspectiveCamera());
      camera.snap(player);
      const anchor = position.clone().add(new THREE.Vector3(0, 1.15, 0));
      assert.ok(camera.camera.position.distanceTo(anchor) >= 2.35, `${warehouseObjectName(mesh)} offset ${offset}, yaw ${yaw}`);
      assert.ok(runtime.surface.camera(anchor, camera.camera.position).distanceTo(camera.camera.position) < .001,
        'camera must still clear stairs, hubbas and ramp shells');
      samples++;
    }
  });
  assert.equal(samples, 408);
});

test('the repaired floor and its cutout patches share the charcoal finish', () => {
  const floors = [];
  scene.traverse(mesh => { if (mesh.isMesh && /Ground_Floor/.test(warehouseObjectName(mesh))) floors.push(mesh); });
  assert.equal(floors.length, 2);
  assert.equal(floors[0].material, floors[1].material);
  assert.equal(floors[0].material.color.getHexString(), '24272a');
});

test('replacement warehouse has a safe entrance and all six supported respawn spots', () => {
  for (const spot of world.manifest.spots) for (const reverse of [0, Math.PI]) {
    const p = new THREE.Vector3(...spot.position);
    const contact = runtime.boardContact.snapToGround(p, spot.heading + reverse, .5, 1);
    assert.equal(contact.count, 4, spot.id);
    assert.ok(contact.normal.y > .98, spot.id);
    assert.equal(runtime.surface.move(contact.position, contact.position, new THREE.Vector3()).contacts.length, 0, spot.id);
  }
});

test('visible ramp faces, including joined and transformed additions, have matching wheel collision', () => {
  let meshes = 0, samples = 0, additions = 0;
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const name = warehouseObjectName(mesh);
    const joined = mesh.parent?.userData?.name?.includes(' / ')
      && /Side_Edge_Band|Side_Wood_Core|Back_Panel/.test(name);
    if (joined && !/Foundry_Plywood(?:\.\d+)?$/.test(mesh.material?.name || '')) return;
    if (!joined && !/Skateable_Surface|Surface_Plywood|Rideable_Arc|Continuous_Rideable_Surface|Bowl.*(?:Transition|Floor)/.test(name)) return;
    const geometry = mesh.geometry, p = geometry.attributes.position, index = geometry.index;
    let count = 0;
    for (let i = 0; i < (index?.count || p.count); i += 3) {
      const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
      const cross = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));
      if (cross.length() < .025) continue;
      const normal = cross.normalize();
      if (normal.y < .08) continue;
      // Sample triangle interiors, with a short normal ray so a stale floor
      // underneath the ramp cannot satisfy this check.
      const centre = v[0].clone().add(v[1]).add(v[2]).multiplyScalar(1 / 3);
      const hit = runtime.surface.rayRideable(centre.clone().addScaledVector(normal, .04), normal.clone().negate(), .08,
        new THREE.Vector3(), new THREE.Vector3());
      assert.ok(hit && hit.point.distanceTo(centre) < .035, `${name} facet ${i / 3} missing collision`);
      count++; samples++;
    }
    if (count) { meshes++; if (/\d\.\d/.test(name)) additions++; }
  });
  // The revised map has 48 explicitly named rideable meshes; the former
  // 40+ total was inflated by 57 non-skateable side/back panels.
  assert.ok(meshes >= 30, `only ${meshes} rideable ramps/platforms checked`);
  assert.ok(additions >= 10, `only ${additions} transformed additions checked`);
  assert.ok(samples > 1200, `only ${samples} ramp triangles sampled`);
});

test('separate and joined coping bars have world-space grind paths and transition metadata', () => {
  assert.equal(imported.rails.length, 50);
  assert.equal(imported.rails.filter(r => r.name.startsWith('Foundry continuous horseshoe')).length, 3);
  assert.equal(imported.rails.filter(r => r.name.startsWith('Flow low spine')).length, 4);
  assert.equal(runtime.railNetwork.rails.length, 50);
  assert.equal(imported.rails.filter(r => r.name.startsWith('Vert spine transfer coping')).length, 12);
  assert.equal(imported.rails.filter(r => r.name.startsWith('Timber bowl')).length, 1,
    'coincident bowl copies cannot compete for transition/capture authority');
  const mini = runtime.railNetwork.rails.filter(r => r.name.startsWith('Foundry mini halfpipe coping'));
  assert.equal(mini.length, 2, 'a joined halfpipe has two independent coping bars');
  assert.ok(mini.every(r => r.points.length === 2 && r.length < 25), 'no phantom rail between the decks');
  for (const rail of runtime.railNetwork.rails) {
    assert.ok(rail.length > .1);
    for (let d = 0; d < rail.length; d += .3) {
      const point = runtime.railNetwork.sample(rail, d).point;
      assert.ok(runtime.railNetwork.nearest(point, rail.radius + .02), `${rail.name} has a grind gap`);
    }
  }
  const copings = imported.rails.filter(r => /coping/.test(r.name));
  assert.ok(copings.every(r => r.transition));
  assert.equal(compileTransitionMetadata(imported.rails).length, copings.length);
});

test('every grind path stays inside the room and has continuous capsule clearance', () => {
  for (const rail of runtime.railNetwork.rails) {
    for (let s = .2; s < rail.length - .2; s += .3) {
      const point = runtime.railNetwork.sample(rail, s, { clearance: .024 }).point;
      assert.ok(point.x > -74 && point.x < 74 && point.z > -54 && point.z < 54, rail.name);
      const moved = runtime.surface.move(point, point, new THREE.Vector3(), { ignoreRail: rail.name });
      assert.ok(moved.position.distanceTo(point) < .03, `${rail.name} blocked at ${s.toFixed(2)}m: ${point.toArray()} -> ${moved.position.toArray()}`);
    }
  }
});

test('shipping controller captures and rides every imported rail without clipping or forced exit', () => {
  const rider = new StatefulSkillStreetPhysics({ collision: imported.collision,
    spawn: world.manifest.spawn, rails: imported.rails, playableRegions: world.manifest.playableRegions });
  for (const rail of rider.railNetwork.rails) {
    rider.reset(new THREE.Vector3(...world.manifest.spawn), 0);
    const sample = rider.railNetwork.sample(rail, rail.length * .5);
    rider.position.copy(sample.point).add(new THREE.Vector3(0, .10, 0));
    rider.heading = Math.atan2(-sample.tangent.x, -sample.tangent.z);
    rider.airHeading = rider.heading;
    rider.airDirection(); rider.grounded = false;
    rider.velocity.copy(sample.tangent).multiplyScalar(5); rider.velocity.y = -.5;
    assert.equal(rider.enterGrind({ name: '50-50', points: 100 }), true,
      JSON.stringify({ rail: rail.name, points: rail.points, position: rider.position, forward: rider.forward, velocity: rider.velocity,
        nearest: rider.railNetwork.nearest(rider.position, 1)?.rail.name }));
    for (let i = 0; i < 24; i++) rider.stepGrind(1 / 120, { steer: 0 });
    assert.ok(rider.grind, `${rail.name}: grind lost during entry blend`);
    const target = rider.railNetwork.sample(rider.grind.rail, rider.grind.s, { clearance: rider.grind.contactClearance });
    assert.ok(rider.position.distanceTo(target.point) < .03, `${rail.name}: grind displaced from bar`);
  }
});

test('moved ramp cutouts have physical ground without capping the recessed bowl', () => {
  assert.equal(imported.repairs.floorPatched, true);
  let samples = 0;
  for (let x = -73.63; x < 73.7; x += 1.1) for (let z = -53.61; z < 53.7; z += 1.1) {
    const hit = runtime.surface.ground(new THREE.Vector3(x, 16, z), 0, 24);
    assert.ok(hit, `hole at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    samples++;
  }
  assert.ok(samples > 12000);
  const bowl = runtime.surface.ground(new THREE.Vector3(-48, 1, -17), 0, 6);
  assert.ok(bowl && bowl.point.y < -3, 'underlay must preserve the bowl opening');
});

test('joined ramps keep solid sides and exclude coping/edge trim from wheel support', () => {
  const from = new THREE.Vector3(25.4, .015, -28.5);
  const desired = new THREE.Vector3(26.6, .015, -28.5);
  const side = runtime.surface.move(from, desired, new THREE.Vector3(12, 0, 0), { grounded: true });
  assert.ok(side.contacts.length && side.position.x < 25.8, 'spine side must remain a physical obstacle');
  let checked = 0;
  scene.traverse(mesh => {
    if (!mesh.isMesh || !mesh.parent?.userData?.name?.includes(' / ')) return;
    const name = warehouseObjectName(mesh);
    if (!/Side_Edge_Band|Side_Wood_Core|Back_Panel/.test(name)) return;
    const material = mesh.material?.name || '';
    if (!/Foundry_Plywood(?:\.\d+)?$/.test(material)) return;
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < (index?.count || p.count); i += 3) {
      const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
      const normal = new THREE.Triangle(...v).getNormal(new THREE.Vector3());
      if (Math.abs(normal.y) < .08) continue;
      if (normal.y < 0) normal.negate();
      const position = v[0].clone().add(v[1]).add(v[2]).multiplyScalar(1 / 3).addScaledVector(normal, .015);
      const moved = runtime.surface.move(position, position, new THREE.Vector3(), { fromUp: normal, toUp: normal, grounded: true });
      assert.ok(moved.position.distanceTo(position) < .03, `${name} has a hidden blocker at ${position.toArray()}`);
      checked++;
    }
  });
  assert.ok(checked > 1000);
});
