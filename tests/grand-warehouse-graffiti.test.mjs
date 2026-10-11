import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGrandWarehouseGraffiti } from '../src/park/GrandWarehouseGraffiti.js';
const bytes=readFileSync('public/assets/warehouse/granwarehouse.glb');
test('Map 3 uploaded asset is the artist-authored Blender GLB',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'a28205a7aea6cab744f6e374e6239cac1f604f8040ab5bb41a19f78b3da50a24');
});
test('Grand Warehouse graffiti belongs only to render hierarchy, never physics',()=>{
  const visuals=createGrandWarehouseGraffiti();
  assert.match(visuals.name,/visual-only/);
  assert.equal(visuals.children.length,0,'headless tests do not allocate browser canvases');
});
