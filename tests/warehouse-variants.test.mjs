import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PARK_DEFINITIONS } from '../src/park/ParkRegistry.js';
import { PARK_REGISTRY } from '../src/game/ParkRegistry.js';

const assets = [
  { id: 'tron-warehouse', file: 'tron-warehouse.glb', sha256: '0306579ac6473b57c550920c9c8a39749bcc07fe59697ba149a23d380115abe3' },
  { id: 'urban-warehouse', file: 'urban-warehouse.glb', sha256: '4d77ce1d7641aceb' },
];
const readGlb = file => {
  const path = resolve('public/assets/warehouse', file);
  let bytes;
  try { bytes = readFileSync(path); }
  catch {
    throw new Error(`Missing ${path}. Upload the provided GLB to the warehouse-maps-3-4 branch before merging.`);
  }
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', 'GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'glTF v2');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB byte length');
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.toString('ascii', 16, 20), 'JSON', 'JSON chunk');
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  return { bytes, json };
};

test('maps 3 and 4 are registered, selectable and have dedicated world loaders', () => {
  const ids = PARK_DEFINITIONS.filter(p => p.selectable).map(p => p.id);
  assert.deepEqual(ids, ['rooftop', 'foundry', 'tron-warehouse', 'urban-warehouse']);
  for (const { id } of assets) {
    assert.equal(PARK_DEFINITIONS.find(p => p.id === id).available, true);
    assert.equal(typeof PARK_REGISTRY[id].create, 'function');
  }
});

test('both GLB assets are present, distinct and keep the playable warehouse topology', () => {
  const parsed = assets.map(({ file, sha256 }) => {
    const { bytes, json } = readGlb(file);
    const actual = createHash('sha256').update(bytes).digest('hex');
    assert.ok(actual.startsWith(sha256), `${file} differs from the verified prepared GLB`);
    assert.ok(json.meshes.length >= 1946, 'warehouse scenery missing');
    assert.ok(json.nodes.some(n => n.name?.includes('Ground_Floor')), 'ground missing');
    assert.ok(json.nodes.some(n => n.name?.startsWith('02_TIMBER_BOWL')), 'bowl missing');
    assert.ok(json.nodes.some(n => n.name?.startsWith('03_VERT_HALL')), 'halfpipe missing');
    assert.ok(json.nodes.some(n => n.name?.startsWith('04_FLOW_LAB')), 'flow transitions missing');
    return { actual, json };
  });
  assert.notEqual(parsed[0].actual, parsed[1].actual, 'The two maps cannot be identical');
  assert.ok(parsed[1].json.nodes.some(n => /URBAN \/ GRAFFITI/.test(n.name || '')),
    'Urban warehouse must include embedded graffiti geometry');
});
