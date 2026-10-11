import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadGeometry } from '../tools/load-geometry.mjs';
import { splitOrbitScene } from '../src/park/OrbitPark.js';
const path='public/assets/spacepark/orbit.glb';
test('diagnostic: ORBIT bowl, sign and ramp classifications',async()=>{
 const bytes=readFileSync(path),size=bytes.readUInt32LE(12);
 const json=JSON.parse(bytes.subarray(20,20+size).toString('utf8'));
 const names=json.nodes.filter(n=>/bowl|ring|lip|apron|circle|ORBIT|SIGN|brand|logo|letter|arch|ramp|quarter|ride|back|core|shell/i.test(n.name||'')).map(n=>n.name||'');
 console.log('ORBIT_DIAG_NAMES '+JSON.stringify(names.slice(0,150)));
 console.log('ORBIT_DIAG_MATERIALS '+JSON.stringify(json.materials.map(m=>({name:m.name,alphaMode:m.alphaMode,transmission:m.extensions?.KHR_materials_transmission?.transmissionFactor,alpha:m.pbrMetallicRoughness?.baseColorFactor?.[3],doubleSided:m.doubleSided})).filter(m=>/ramp|side|shell|bowl|silver|concrete|neon|graffiti|LED|sign|logo|roof|purple|orbital/i.test(m.name||'')).slice(0,70)));
 const root=await loadGeometry(new URL('../public/assets/spacepark/orbit.glb',import.meta.url));
 root.updateMatrixWorld(true);
 const objects=[];
 root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const name=mesh.userData.name||mesh.name||'';
  if(!/bowl|lip|ring|apron|arch|sign|orbit|logo|shell|ramp|quarter|core|panel/i.test(name))return;
  const bounds=new THREE.Box3().setFromObject(mesh);
  const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>({name:m?.name,transparent:m?.transparent,opacity:m?.opacity,depthWrite:m?.depthWrite,side:m?.side}));
  objects.push({name,box:[...bounds.min.toArray().map(n=>+n.toFixed(2)),...bounds.max.toArray().map(n=>+n.toFixed(2))],materials});
 });
 console.log('ORBIT_DIAG_OBJECTS '+JSON.stringify(objects.slice(0,110)));
 const split=splitOrbitScene(root,[]);
 const coll=split.collision.children.filter(m=>/bowl|ring|lip|apron|circle|sign|logo|arch/i.test(m.name));
 console.log('ORBIT_DIAG_COLLISION '+JSON.stringify(coll.slice(0,95).map(m=>({name:m.name,surface:m.userData.surface,triangles:m.geometry.attributes.position.count/3,box:new THREE.Box3().setFromObject(m).min.toArray().concat(new THREE.Box3().setFromObject(m).max.toArray()).map(n=>+n.toFixed(2))}))));
});
