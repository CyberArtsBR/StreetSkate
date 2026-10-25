import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { inspectTestMap, assembleTestMap, readTestMapManifest, createTestMapWorld } from '../src/game/TestMapLoader.js';
import { prepareParkRuntime, disposeParkWorld, PARK_REGISTRY } from '../src/game/ParkRegistry.js';
import { GameShell } from '../src/game/GameShell.js';
import { DEFAULT_CHARACTERS, BOARD_CHOICES, LOCATIONS } from '../src/game/LoadoutCatalog.js';

function bytes(changes={}) {
  const json={asset:{version:'2.0'},nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{count:3}],...changes};
  const text=JSON.stringify(json), length=Math.ceil(text.length/4)*4;
  const b=new Uint8Array(20+length),v=new DataView(b.buffer);
  v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,b.length,true);v.setUint32(12,length,true);v.setUint32(16,0x4e4f534a,true);
  b.fill(32,20);b.set(new TextEncoder().encode(text),20);return b.buffer;
}
const manifest=()=>({version:1,name:'Test park',spawn:[0,.04,0],rails:[{name:'Test rail',points:[[-2,1,-2],[2,1,-2]],radius:.055}],playableRegions:[{minX:-10,maxX:10,minZ:-10,maxZ:10}]});
function park(authored=true) {
  const root=new THREE.Group();if(authored)root.userData.streetSkateMap=JSON.stringify(manifest());
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial());root.add(floor);
  if(authored){const proxy=floor.clone();proxy.userData.streetSkateRole='collision';proxy.userData.transitionSkin=true;root.add(proxy);}
  return root;
}
test('GLB map validation bounds resources before parsing',()=>{
  assert.equal(inspectTestMap(bytes()).triangles,1);
  assert.throws(()=>inspectTestMap(bytes({buffers:[{uri:'https://example.com/map.bin'}]})),/forbidden/);
  assert.throws(()=>inspectTestMap(bytes({images:[{uri:'data:image/png;base64,abc'}]})),/forbidden/);
  assert.throws(()=>inspectTestMap(bytes({accessors:[{count:2000000}]})),/geometry/);
  assert.throws(()=>inspectTestMap(bytes({nodes:[{children:[1]},{children:[0]}]})),/hierarchy/);
  assert.throws(()=>inspectTestMap(bytes({nodes:[{children:[2]},{children:[2]},{}]})),/parents/);
  assert.throws(()=>inspectTestMap(bytes({animations:[{}]})),/static/);
});
test('bad file types and size are rejected before reading',async()=>{
  await assert.rejects(createTestMapWorld({name:'bad.txt',size:40,arrayBuffer(){throw Error('read');}}),/GLB/);
  await assert.rejects(createTestMapWorld({name:'huge.glb',size:90*1024*1024,arrayBuffer(){throw Error('read');}}),/80 MB/);
});
test('authored map uses only explicit collision and hides proxy visuals',()=>{
  const root=park(),world=assembleTestMap(root),runtime=prepareParkRuntime(world);
  assert.equal(world.collision.children.length,1);assert.equal(root.children[1].visible,false);
  assert.equal(runtime.railNetwork.rails.length,1);assert.equal(runtime.spawn.x,0);
  assert.equal(world.manifest.locationId,'test-map');disposeParkWorld(world);
});
test('embedded sky never expands bounds or becomes collision',()=>{
  const root=park(),sky=new THREE.Mesh(new THREE.SphereGeometry(430),new THREE.MeshBasicMaterial());
  sky.userData.streetSkateRole='sky';root.add(sky);const world=assembleTestMap(root);
  assert.equal(world.collision.children.length,1);assert.match(world.manifest.dimensions,/20 × 20/);
  assert.equal(sky.material.fog,false);assert.equal(sky.userData.castShadow,false);disposeParkWorld(world);
});
test('generic static GLBs get probed flat spawn and mesh collision',()=>{
  const world=assembleTestMap(park(false),'My park.glb');prepareParkRuntime(world);
  assert.equal(world.manifest.name,'My park');assert.deepEqual(world.manifest.rails,[]);disposeParkWorld(world);
});
test('malformed metadata and missing authored collision fail instead of silently losing rails',()=>{
  const root=park(),data=manifest();data.rails[0].points[0][0]=Infinity;root.userData.streetSkateMap=data;
  assert.throws(()=>readTestMapManifest(root),/grind/);
  root.userData.streetSkateMap=manifest();root.remove(root.children[1]);assert.throws(()=>assembleTestMap(root),/collision/);
});
function shellHarness(action) {
  const shell=Object.create(GameShell.prototype),starts=[];
  Object.assign(shell,{phase:'options',ready:true,mapUploadGeneration:0,mapUploadBusy:false,heroes:[...DEFAULT_CHARACTERS],
    actions:{testMap:action},render(){},start(practice){starts.push(practice);this.phase='playing';}});
  return {shell,starts};
}
test('upload starts practice with built-in random rider and board without changing catalog',async()=>{
  let request;const {shell,starts}=shellHarness(async r=>{request=r;return {locationId:'test-map'};});
  await shell.uploadTestMap({name:'park.glb'});
  assert.ok(DEFAULT_CHARACTERS.includes(request.hero));assert.ok(BOARD_CHOICES.includes(request.board));
  assert.deepEqual(starts,[true]);assert.equal(shell.mapUploadBusy,false);
  assert.equal(PARK_REGISTRY['test-map'],undefined);assert.ok(LOCATIONS.every(l=>l.id!=='test-map'));
});
test('load failure stays in Options with readable error and no practice start',async()=>{
  const {shell,starts}=shellHarness(async()=>{throw Error('Invalid map geometry');});
  await shell.uploadTestMap({name:'bad.glb'});assert.equal(shell.phase,'options');assert.equal(shell.mapUploadBusy,false);
  assert.match(shell.mapUploadStatus,/Invalid map geometry/);assert.deepEqual(starts,[]);
});
test('canceled upload cannot start practice or replace selection after completion',async()=>{
  let resolve;const {shell,starts}=shellHarness(()=>new Promise(r=>{resolve=r;}));
  const pending=shell.uploadTestMap({name:'park.glb'});shell.mapUploadGeneration++;shell.phase='title';resolve({locationId:'test-map'});
  await pending;assert.deepEqual(starts,[]);
});
