import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGrandWarehouseGraffiti } from '../src/park/GrandWarehouseGraffiti.js';
const bytes=readFileSync('public/assets/warehouse/granwarehouse.glb');
test('Map 3 uploaded asset is the artist-authored Blender GLB',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'fbc46ba3e414bb4380366c749fa0aa526e06328ae3bff702e956b43c37f0902c');
});
test('Grand Warehouse graffiti belongs only to render hierarchy, never physics',()=>{
  const visuals=createGrandWarehouseGraffiti();
  assert.match(visuals.name,/visual-only/);
  assert.equal(visuals.children.length,0,'headless tests do not allocate browser canvases');
});
