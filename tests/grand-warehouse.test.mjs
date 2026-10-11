import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadGeometry } from '../tools/load-geometry.mjs';
import { PARK_DEFINITIONS } from '../src/park/ParkRegistry.js';
import { PARK_REGISTRY, prepareParkRuntime } from '../src/game/ParkRegistry.js';
import { createWarehousePark } from '../src/park/WarehousePark.js';
import { buildImportedWarehouseCollision, warehouseObjectName } from '../src/park/ImportedWarehouseCollision.js';
import { StatefulSkillStreetPhysics } from '../src/game/StatefulSkillStreetPhysics.js';
import { ensureGrandWarehouseSpawns } from '../src/park/GrandWarehouseSpawns.js';

const file = 'public/assets/warehouse/granwarehouse.glb';
const expectedHash = 'a28205a7aea6cab744f6e374e6239cac1f604f8040ab5bb41a19f78b3da50a24';

test('Map 3 is distinct and preserves the exact Map 2 asset address and selection number', () => {
  const ids = PARK_DEFINITIONS.filter(p => p.selectable).map(p => p.id);
  assert.deepEqual(ids, ['rooftop','urban-warehouse','grand-warehouse']);
  assert.equal(PARK_DEFINITIONS.find(p => p.id === 'urban-warehouse').number, 2);
  assert.equal(PARK_DEFINITIONS.find(p => p.id === 'grand-warehouse').number, 3);
  assert.equal(typeof PARK_REGISTRY['grand-warehouse'].create, 'function');
});

test('original map geometry is embedded in an immutable, separately versioned Map 3 GLB', () => {
  const bytes = readFileSync(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash,
    'Upload the exact Grand Warehouse GLB from ChatGPT; do not overwrite Map 2');
  assert.equal(bytes.toString('ascii',0,4),'glTF');
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  const length=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.subarray(20,20+length).toString('utf8'));
  assert.equal(json.meshes.length,1412,'unexpected changed or missing revised Grand Warehouse meshes');
  assert.equal(json.nodes.filter(n=>/^(?:Cube__0(?:\.001)?|Plane_SkateLite_base_color\.002_0)$/.test(n.name||'')).length,0,
    'the artist removed the two low obstacles and SkateLite ramp in this revision');
  assert.equal(json.nodes.filter(n=>(n.name||'').includes('___tube')).length,17,
    'all 17 original authored metal rail tubes must remain');
  const movedBands = [
    ['04_FLOW_LAB / Flow launch ramp / Side_Edge_Band 001', 33.72187042236328],
    ['04_FLOW_LAB / Flow launch ramp / Side_Edge_Band 001.001', 33.64250183105469],
  ];
  for (const [name,z] of movedBands) {
    const node=json.nodes.find(n=>n.name===name);
    assert.ok(node,'edited decorative edge band missing: '+name);
    assert.ok(Math.abs(node.translation[2]-z)<0.00002,
      'the updated artist edge-band placement was not preserved: '+name);
  }
  assert.ok(json.nodes.some(n=>/Ground_Floor/.test(n.name||'')));
  assert.ok(json.nodes.some(n=>/Brick_North_South_Wall/.test(n.name||'')));
  assert.ok(json.nodes.some(n=>/^02_TIMBER_BOWL/.test(n.name||'')));
  assert.ok(json.nodes.some(n=>/^03_VERT_HALL/.test(n.name||'')));
  assert.ok(json.nodes.some(n=>/___tube/.test(n.name||'')));
  for (const image of json.images||[]) assert.ok(image.bufferView!==undefined,'GLB uses external texture file');
});

const root = await loadGeometry(file);
const baseline = createWarehousePark({ textures: false });
const before = new Map();
root.updateMatrixWorld(true);
root.traverse(node => {
  if (!node.isMesh || !/Skateable_Surface/.test(warehouseObjectName(node))) return;
  before.set(node.uuid, node.matrixWorld.elements.slice());
});
const imported = buildImportedWarehouseCollision(root, baseline.manifest.rails, { grandMode: true });
baseline.collision = imported.collision;
baseline.manifest.rails = imported.rails;
ensureGrandWarehouseSpawns(baseline);
const runtime = prepareParkRuntime(baseline);
const objectNames = imported.surfaces.join(';');

test('Map 3 preserves every artist-authored ramp location and original floor finish', () => {
  assert.deepEqual(imported.repairs.movedRamps,[],'must never move Blender ramps behind the artist');
  for (const [uuid,oldMatrix] of before) {
    let found = null;
    root.traverse(node=>{if(node.uuid===uuid)found=node;});
    assert.ok(found);
    assert.deepEqual(found.matrixWorld.elements,oldMatrix);
  }
  let floor;
  root.traverse(node=>{if(node.isMesh && /Ground_Floor/.test(warehouseObjectName(node))) floor ||= node;});
  assert.ok(floor);
  assert.doesNotMatch(floor.material.name,/charcoal/i,'Grand Warehouse uses its own edited materials');
});

test('every named skateable ramp skin has physics, and wood/trim/roof art is not wheel collision', () => {
  assert.ok(imported.surfaces.length >= 20,'missing skateable ramps');
  assert.match(objectNames,/Skateable_Surface/);
  assert.doesNotMatch(objectNames,/GRAFFITI|VISUAL_ONLY|Grille_Slat|Hanging_Light/);
  assert.ok(imported.collision.children.some(m=>m.userData.surface==='rideable'));
  assert.ok(imported.collision.children.some(m=>m.userData.surface==='solid'));
  assert.ok(imported.triangles > 500,'collision mesh is incomplete');
  assert.ok(!imported.surfaces.some(s=>/^Cube__0|SkateLite/.test(s)),
    'deleted Blender obstacles must not leave invisible wheel-collision geometry');
  assert.ok(imported.repairs.movedRamps.length===0,'Grand must retain artist positions');
});

test('Grand Warehouse extracts actual joined metal coping tubes, not their wooden support meshes', () => {
  assert.ok(imported.rails.length>=25,`only ${imported.rails.length} grind paths in revised Blender GLB`);
  assert.ok(imported.rails.some(r=>/West transfer quarter/.test(r.name)),
    'West quarter copings embedded in the wood mesh must be grindable');
  assert.ok(imported.rails.some(r=>/Nine stair/.test(r.name)),'stair handrails missing');
  assert.ok(imported.rails.some(r=>/Timber bowl/.test(r.name)),'bowl coping missing');
  const names=new Set();
  for(const rail of imported.rails){
    assert.ok(!names.has(rail.name),`duplicate rail: ${rail.name}`);names.add(rail.name);
    assert.ok(rail.radius>.01&&rail.radius<.4,rail.name);
    assert.ok(rail.points.length>=2,rail.name);
    for(const p of rail.points)assert.ok(p.every(Number.isFinite),rail.name);
  }
});

test('entrance and named respawns have complete four-wheel support', () => {
  for(const spot of baseline.manifest.spots){
    const support=runtime.boardContact.snapToGround(new THREE.Vector3(...spot.position),
      spot.heading || 0,.5,1);
    assert.equal(support.count,4,`unsupported ${spot.id}`);
    assert.ok(support.normal.y>.96,`nonflat ${spot.id}`);
  }
});

test('skater can capture each reconstructed metal grind path without being blocked by artwork', () => {
  const skater=new StatefulSkillStreetPhysics({
    collision:imported.collision,spawn:baseline.manifest.spawn,
    rails:imported.rails,playableRegions:baseline.manifest.playableRegions,
  });
  for(const rail of skater.railNetwork.rails){
    const hit=skater.railNetwork.sample(rail,rail.length*.5);
    const tangent=hit.tangent.clone();
    skater.reset(new THREE.Vector3(...baseline.manifest.spawn),0);
    skater.position.copy(hit.point).add(new THREE.Vector3(0,.12,0));
    skater.heading=Math.atan2(-tangent.x,-tangent.z);
    skater.airHeading=skater.heading;
    skater.airDirection();skater.grounded=false;
    skater.velocity.copy(tangent).multiplyScalar(5);skater.velocity.y=-.5;
    assert.equal(skater.enterGrind({name:'50-50',points:100}),true,rail.name);
  }
});
