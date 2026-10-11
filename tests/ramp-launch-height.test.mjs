import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadGeometry } from '../tools/load-geometry.mjs';
import { createWarehousePark } from '../src/park/WarehousePark.js';
import { buildImportedWarehouseCollision } from '../src/park/ImportedWarehouseCollision.js';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { VERT_LAUNCH_ENVELOPE } from '../src/game/transitions/TransitionController.js';

const scene = await loadGeometry('public/assets/warehouse/urban-warehouse.glb');
const world = createWarehousePark({ textures: false });
const imported = buildImportedWarehouseCollision(scene, world.manifest.rails);
const routes = [
  { name: 'Competition halfpipe', start: [8.33, .3, -36.43], heading: 0, minimumRise: 4, vert: true },
  { name: 'Return quarter', start: [46.33, .3, -41.28], heading: 0, minimumRise: 4, vert: true },
  { name: 'Foundry mini', start: [-15.83, .3, -35.80], heading: -Math.PI / 2, minimumRise: 4, vert: true },
  { name: 'Flow launch', start: [27.25, .3, 27.54], heading: Math.PI, minimumRise: 4, vert: false },
  { name: 'Low kicker', start: [-57.63, .3, 10.83], heading: Math.PI, minimumRise: 1.5, vert: false },
];

for (const route of routes) test(route.name + ': actual warehouse preserves ramp launch height and lands', () => {
  const p = new StatefulSkillStreetPhysics({ collision: imported.collision, rails: imported.rails,
    playableRegions: world.manifest.playableRegions, spawn: route.start });
  p.reset(new THREE.Vector3(...route.start), route.heading);
  p.groundDirection(); p.velocity.copy(p.forward).multiplyScalar(14); p.rollingSign = 1;
  let departure = null, peak = -Infinity, landed = false;
  const takeoff = p.takeoff.bind(p);
  p.takeoff = (impulse, edge) => {
    const grounded = p.grounded;
    const result = takeoff(impulse, edge);
    if (grounded && !p.grounded && !departure) departure = {
      y: p.position.y, vy: p.velocity.y, facing: p.heading, transition: Boolean(p.transitionAir),
    };
    return result;
  };
  for (let i = 0; i < 480; i++) {
    p.advance(1 / 120, { steer: 0, drive: 0, spin: 0, directionTaps: [] });
    assert.equal(p.bailTime, 0, 'normal ramp return must remain rideable');
    if (departure) {
      peak = Math.max(peak, p.position.y);
      if (p.grounded) { landed = true; break; }
    }
  }
  assert.ok(departure, 'must leave the lip');
  if (route.vert) assert.equal(departure.transition, true, 'authored coping must retain return guidance');
  assert.ok(peak - departure.y >= route.minimumRise, `only rose ${peak - departure.y} m`);
  assert.ok(departure.vy <= VERT_LAUNCH_ENVELOPE.maximumPassiveVerticalSpeed + 1e-6);
  assert.ok(landed, 'must return to supported ground after the larger air');
  assert.ok(Math.abs(p.heading - departure.facing) < .01, 'return must not rotate the player automatically');
});
