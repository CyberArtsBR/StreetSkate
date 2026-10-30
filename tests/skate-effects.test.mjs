import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SkateEffects} from '../src/graphics/SkateEffects.js';

const rider=()=>({position:new THREE.Vector3(),velocity:new THREE.Vector3(0,0,-12),forward:new THREE.Vector3(0,0,-1),
  normal:new THREE.Vector3(0,1,0),speed:12,grounded:true,justLanded:false,respawnSerial:0,bailTime:0});
const count=pool=>pool.duration.reduce((n,t)=>n+(t>0?1:0),0);

test('landing dust emits once after real airtime, not on startup or respawn',()=>{
  const fx=new SkateEffects(),s=rider();s.justLanded=true;
  fx.update(1/60,s);assert.equal(count(fx.dust),0);
  s.grounded=false;s.justLanded=false;s.velocity.y=-6;
  for(let i=0;i<10;i++)fx.update(1/60,s);
  s.grounded=true;s.justLanded=true;s.velocity.y=0;
  fx.update(1/60,s);
  assert.ok(count(fx.dust)>0);const cursor=fx.dust.cursor;
  fx.update(1/60,s);assert.equal(fx.dust.cursor,cursor,'held landing flag cannot repeat bursts');
  s.respawnSerial++;fx.update(1/60,s);
  assert.equal(count(fx.dust),0);assert.equal(count(fx.glints),0);
  fx.dispose();
});

test('ramp reentry tangent speed does not create a heavy impact cloud',()=>{
  const fx=new SkateEffects(),s=rider();s.grounded=false;s.velocity.set(0,-8,-8);
  s.normal.set(0,Math.SQRT1_2,-Math.SQRT1_2);
  for(let i=0;i<12;i++)fx.update(1/60,s);
  s.grounded=true;s.justLanded=true;fx.update(1/60,s);
  assert.equal(count(fx.dust),0,'surface-normal impact matters, not world vertical speed');
  fx.dispose();
});

test('grind particles stay within the fixed pool; performance removes sparks and traces',()=>{
  const scene=new THREE.Scene(),fx=new SkateEffects(scene),s=rider();s.grind={};
  assert.equal(scene.children.length,1);
  const positionBuffer=fx.glints.arrays.position;
  for(let i=0;i<600;i++)fx.update(1/60,s);
  assert.ok(count(fx.glints)>0);assert.ok(count(fx.glints)<=96);
  assert.equal(fx.glints.arrays.position,positionBuffer);
  assert.ok(fx.glints.arrays.position.every(Number.isFinite));
  fx.setQuality({name:'performance',vfxScale:.65});
  for(let i=0;i<40;i++)fx.update(1/60,s);
  assert.equal(count(fx.glints),0);
  fx.dispose();assert.equal(scene.children.length,0);
});

test('map teleport clears existing trails and re-arms without a landing burst',()=>{
  const fx=new SkateEffects(),s=rider();s.grounded=false;s.flipState={};
  for(let i=0;i<20;i++)fx.update(1/60,s);
  assert.ok(count(fx.glints)>0);
  s.position.x=20;s.grounded=true;s.justLanded=true;fx.update(1/60,s);
  assert.equal(count(fx.dust),0);assert.equal(count(fx.glints),0);
  fx.setSize(900,2);assert.equal(fx.glints.points.material.uniforms.viewportHeight.value,1800);
  fx.dispose();
});

test('bail liquid waits for ragdoll contact, emits once, fades and clears on reset',()=>{
  const fx=new SkateEffects(),s=rider();fx.update(1/60,s);
  s.bailTime=2;s.rider={ragdoll:{groundImpact:null}};
  fx.update(1/60,s);assert.equal(fx.puddles.some(p=>p.mesh.visible),false);
  s.rider.ragdoll.groundImpact={point:new THREE.Vector3(1,0,2),normal:new THREE.Vector3(0,1,0)};
  fx.update(1/60,s);assert.equal(fx.puddles.filter(p=>p.mesh.visible).length,1);
  const cursor=fx.dust.cursor;fx.update(1/60,s);assert.equal(fx.dust.cursor,cursor);
  for(let i=0;i<310;i++)fx.update(1/60,s);
  assert.equal(fx.puddles.some(p=>p.mesh.visible),false);
  fx.reset(s);assert.equal(count(fx.dust),0);fx.dispose();
});
