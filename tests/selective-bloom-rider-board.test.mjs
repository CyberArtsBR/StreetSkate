import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GraphicsPipeline } from '../src/graphics/GraphicsPipeline.js';

function fixture(shouldThrow = false) {
  const concrete = { name:'Concrete' }, glass = { name:'Warehouse glass' };
  const riderMaterial = { name:'Uploaded GLB rider' }, deckMaterial = { name:'Skateboard finish' };
  const warehouse = { isMesh:true, material:concrete };
  const windowMesh = { isMesh:true, material:glass };
  const rider = { isMesh:true, material:riderMaterial };
  const board = { isMesh:true, material:deckMaterial };
  const background = { id:'HDRI-background' }, fog={ id:'per-map-fog' }, override={ id:'before' };
  const scene = {
    background, fog, overrideMaterial:override,
    traverse(visitor) {
      for (const m of [warehouse,windowMesh,rider,board]) visitor(m);
    },
  };
  const darkMaterial={name:'Bloom depth-only black'};
  let called=0;
  const pipeline=Object.create(GraphicsPipeline.prototype);
  pipeline.scene=scene;
  pipeline.blackoutMaterial=darkMaterial;
  pipeline.glowRoot={
    parent:{}, 
    traverse(visitor) { visitor(rider);visitor(board); }
  };
  pipeline.bloomComposer={
    readBuffer:{texture:{id:'actor-bloom-only'}},
    render() {
      called++;
      assert.equal(scene.background,null,'HDRI must not contribute to bloom');
      assert.equal(scene.fog,null,'map fog must not contribute to bloom');
      assert.equal(warehouse.material,darkMaterial,'floor cannot glow');
      assert.equal(windowMesh.material,darkMaterial,'glass cannot glow');
      assert.equal(rider.material,riderMaterial,'rider must contribute to bloom');
      assert.equal(board.material,deckMaterial,'deck must contribute to bloom');
      if(shouldThrow) throw new Error('simulated WebGL failure');
    },
  };
  pipeline.bloomComposite={uniforms:{bloomTexture:{value:null}}};
  return {pipeline, scene, meshes:[warehouse,windowMesh,rider,board], materials:[concrete,glass,riderMaterial,deckMaterial], background,fog,override,called:()=>called};
}

test('bloom masks environment, preserves rider and skateboard, restores scene',()=>{
  const {pipeline,scene,meshes,materials,background,fog,override,called}=fixture();
  assert.equal(pipeline.renderSelectiveBloom(),true);
  assert.equal(called(),1);
  assert.equal(scene.background,background);
  assert.equal(scene.fog,fog);
  assert.equal(scene.overrideMaterial,override);
  meshes.forEach((m,i)=>assert.equal(m.material,materials[i]));
  assert.deepEqual(pipeline.bloomComposite.uniforms.bloomTexture.value,{id:'actor-bloom-only'});
});

test('renderer errors never leave warehouse materials black or clear the sky',()=>{
  const {pipeline,scene,meshes,materials,background,fog,override}=fixture(true);
  assert.throws(()=>pipeline.renderSelectiveBloom(),/simulated WebGL failure/);
  assert.equal(scene.background,background);
  assert.equal(scene.fog,fog);
  assert.equal(scene.overrideMaterial,override);
  meshes.forEach((m,i)=>assert.equal(m.material,materials[i]));
});

test('no bloom work is attempted until rider and board are in the scene',()=>{
  const {pipeline,called}=fixture();
  pipeline.glowRoot=null;
  assert.equal(pipeline.renderSelectiveBloom(),false);
  assert.equal(called(),0);
});

test('normal environment shader chain does not include an all-scene bloom pass',()=>{
  const fx=readFileSync(new URL('../src/graphics/GraphicsPipeline.js',import.meta.url),'utf8');
  const main=readFileSync(new URL('../src/game-main.js',import.meta.url),'utf8');
  assert.match(fx,/this\.bloomComposer\.addPass\(this\.bloom\)/);
  assert.doesNotMatch(fx,/this\.composer\.addPass\(this\.bloom\)/);
  assert.match(fx,/this\.scene\.background = null/);
  assert.match(fx,/replaced\.push\(\[object, object\.material\]\)/);
  assert.match(main,/graphicsPipeline\.setGlowTarget\(skater\.visual\)/);
  assert.match(fx,/this\.composite|this\.bloomComposite/);
  assert.match(fx,/this\.settings\.bloomScale/);
});
