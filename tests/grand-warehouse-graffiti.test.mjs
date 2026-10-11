import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGrandWarehouseGraffiti } from '../src/park/GrandWarehouseGraffiti.js';
const bytes=readFileSync('public/assets/warehouse/granwarehouse.glb');
test('Map 3 uploaded asset is the artist-authored Blender GLB',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'f0f47613e0aad90fd1ba7903ec218d46fea7bdc9433d437f3a1b26a72d41d886');
});
test('Grand Warehouse graffiti belongs only to render hierarchy, never physics',()=>{
  const visuals=createGrandWarehouseGraffiti();
  assert.match(visuals.name,/visual-only/);
  assert.equal(visuals.children.length,0,'headless tests do not allocate browser canvases');
});
