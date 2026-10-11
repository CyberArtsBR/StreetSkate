import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('Grand Warehouse renders the exact Skatewarehouse GLB, not the former asset', () => {
  const bytes = readFileSync('public/assets/warehouse/granwarehouse.glb');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'fbc46ba3e414bb4380366c749fa0aa526e06328ae3bff702e956b43c37f0902c');
});

test('Grand Warehouse adds no runtime graffiti to the warehouse visual root', () => {
  const code=readFileSync('src/park/WarehouseVariants.js','utf8');
  assert.doesNotMatch(code, /createGrandWarehouseGraffiti|GrandWarehouseGraffiti/);
  const path=readFileSync('src/park/GrandWarehouseSceneFilter.js','utf8');
  assert.match(path, /Six stair kinked down rail/);
});
