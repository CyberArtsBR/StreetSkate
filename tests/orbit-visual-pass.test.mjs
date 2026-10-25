import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {loadGeometry} from '../tools/load-geometry.mjs';
import {splitOrbitScene} from '../src/park/OrbitPark.js';
import {disposeParkWorld,prepareParkRuntime} from '../src/game/ParkRegistry.js';
import {createOrbitVisualPass,createOrbitMicroTextures,ORBIT_VISUAL_LIMITS} from '../src/graphics/OrbitVisualPass.js';

test('ORBIT microdetail is deterministic, tileable and stores linear normal/roughness data',()=>{
  const a=createOrbitMicroTextures(),b=createOrbitMicroTextures();
  for(const key of ['normal','roughness']) {
    assert.equal(a[key].image.width,512);assert.equal(a[key].wrapS,THREE.RepeatWrapping);
    assert.equal(a[key].colorSpace,THREE.NoColorSpace);
    assert.deepEqual(a[key].image.data,b[key].image.data);
    a[key].dispose();b[key].dispose();
  }
});

test('ORBIT detail preserves colored coatings and uses independent satin surface response',()=>{
  const park=new THREE.Group(),collision=new THREE.Group(),geometry=new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2);
  const map=new THREE.Texture(),material=new THREE.MeshStandardMaterial({name:'Foundry_Plywood',color:0x8726dc,metalness:.73,roughness:.83,map});
  const color=material.color.clone(),vertices=[...geometry.attributes.position.array];
  park.add(new THREE.Mesh(geometry,material));
  const world={park,collision,manifest:{spots:[{position:[0,.15,0]}],rails:[]}};
  const pass=createOrbitVisualPass(world);
  assert.deepEqual(material.color,color);assert.equal(material.map,map);
  assert.ok(material.metalness<=.16);assert.ok(material.roughness>=.8);
  assert.equal(material.normalMap.image.width,512);
  assert.deepEqual([...geometry.attributes.position.array],vertices);
  assert.equal(collision.children.length,0);assert.ok(pass.stats.patches>0);
  disposeParkWorld(world);
});

test('real ORBIT detail stays within budgets and leaves exact rails, collision and entrance intact',async()=>{
  const manifest=JSON.parse(readFileSync('public/assets/spacepark/orbit-manifest.json'));
  const world=splitOrbitScene(await loadGeometry('public/assets/spacepark/orbit.glb'),manifest.rails);
  world.manifest={...manifest,rails:world.rails};
  const before={rails:JSON.stringify(world.rails),positions:world.collision.children.map(mesh=>[...mesh.geometry.attributes.position.array]),count:world.collision.children.length};
  try {
    const detail=createOrbitVisualPass(world),runtime=prepareParkRuntime(world);
    assert.ok(detail.stats.patches>=20);assert.ok(detail.stats.patches<=ORBIT_VISUAL_LIMITS.patches);
    assert.equal(detail.stats.drawCalls,3);assert.ok(detail.stats.triangles<=ORBIT_VISUAL_LIMITS.triangles);
    assert.equal(detail.stats.lights,6);assert.equal(detail.root.parent,world.park);
    assert.equal(world.collision.children.length,before.count);assert.equal(JSON.stringify(world.rails),before.rails);
    world.collision.children.forEach((mesh,index)=>assert.deepEqual([...mesh.geometry.attributes.position.array],before.positions[index]));
    assert.deepEqual(runtime.spawn.toArray(),manifest.spawn);
    for(const object of detail.root.children)assert.equal(object.castShadow,false);
    const full=detail.root.children.filter(mesh=>mesh.isMesh).reduce((n,mesh)=>n+mesh.geometry.drawRange.count,0);
    detail.setQuality({surfaceDetailScale:.45});
    const lower=detail.root.children.filter(mesh=>mesh.isMesh).reduce((n,mesh)=>n+mesh.geometry.drawRange.count,0);
    assert.ok(lower<full);assert.equal(detail.root.children.filter(o=>o.isLight&&o.visible).length,2);
    detail.setQuality({surfaceDetailScale:0});assert.equal(detail.root.visible,false);
    detail.setQuality({surfaceDetailScale:1});assert.equal(detail.root.visible,true);
    assert.equal(detail.root.children.filter(o=>o.isLight&&o.visible).length,6);
  } finally {disposeParkWorld(world);}
});

test('empty or hidden visual surfaces never produce floating projected markings',()=>{
  const park=new THREE.Group(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshStandardMaterial({name:'Ceramic / silver riding concrete'}));
  mesh.visible=false;park.add(mesh);
  const world={park,collision:new THREE.Group(),manifest:{spots:[{position:[0,0,0]}],rails:[]}},detail=createOrbitVisualPass(world);
  assert.equal(detail.stats.patches,0);assert.equal(detail.stats.drawCalls,0);
  disposeParkWorld(world);
});
