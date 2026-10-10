import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadGeometry } from '../tools/load-geometry.mjs';
import { buildImportedWarehouseCollision, warehouseObjectName } from '../src/park/ImportedWarehouseCollision.js';
import { createWarehousePark } from '../src/park/WarehousePark.js';
import { prepareParkRuntime } from '../src/game/ParkRegistry.js';
import { compileTransitionMetadata } from '../src/game/transitions/TransitionMetadata.js';
import { grindProfile } from '../src/game/SkateSystems.js';
import { resolveMagneticGrindCapture } from '../src/game/core/GrindCaptureController.js';

const scene = await loadGeometry('public/assets/warehouse/urban-warehouse.glb');
const world = createWarehousePark({ textures: false });
const imported = buildImportedWarehouseCollision(scene, world.manifest.rails);
world.collision = imported.collision;
world.manifest.rails = imported.rails;
const runtime = prepareParkRuntime(world);

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
    if (/Side_Edge_Band/.test(name)) return; // decoration, not wheel collision
    const joined = mesh.parent?.userData?.name?.includes(' / ')
      && /Side_Wood_Core|Back_Panel/.test(name);
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
  assert.ok(meshes > 40, `only ${meshes} ramps/platforms checked`);
  assert.ok(additions > 15, `only ${additions} transformed additions checked`);
  assert.ok(samples > 2000);
});

test('all 34 visible rail tubes have world-space grind paths and all coping has transition metadata', () => {
  assert.equal(imported.rails.length, 34);
  assert.equal(imported.rails.filter(r => r.name.startsWith('Foundry continuous horseshoe')).length, 3);
  assert.equal(imported.rails.filter(r => r.name.startsWith('Flow low spine')).length, 4);
  assert.equal(runtime.railNetwork.rails.length, 34);
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

test('map4: each visible rail family supports a realistic airborne approach', () => {
  const unreachable = [];
  const profile = grindProfile('50-50');
  let approaches = 0;
  for (const rail of runtime.railNetwork.rails) {
    // Tiny lip edges cannot accommodate both 50-50 trucks.
    if (rail.length < .85) continue;
    const samples = [.25, .5, .75];
    let accepted = 0;
    for (const frac of samples) {
      const sample = runtime.railNetwork.sample(rail, rail.length * frac);
      const along = sample.tangent.clone().setY(0);
      if (along.lengthSq() < .1) continue;
      along.normalize();
      const side = new THREE.Vector3(along.z, 0, -along.x);
      // Approach 18cm beside the tube, 13cm above the trucks' resting height.
      const pos = sample.point.clone().addScaledVector(side, .18);
      pos.y = sample.point.y + rail.radius + profile.clearance + .13;
      const velocity = along.clone().multiplyScalar(6).addScaledVector(side, -.9);
      velocity.y = -.6;
      approaches++;
      const hit = resolveMagneticGrindCapture({
        position: pos, forward: along, velocity,
        railNetwork: runtime.railNetwork, trick: { name: '50-50' },
      });
      if (hit) accepted++;
    }
    if (!accepted) unreachable.push(rail.name);
  }
  assert.ok(approaches > 60, 'too few imported rail approaches tested');
  assert.deepEqual(unreachable, [], 'visible rails should not be magnetic dead zones');
});
