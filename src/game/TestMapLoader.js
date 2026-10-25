import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { inspectGlb, GLB_LIMITS } from '../../tools/agent10-glb-inspector.mjs';
import { ParkCollision } from './ParkCollision.js';
import { validateParkWorld, disposeParkWorld } from './ParkRegistry.js';

export const TEST_MAP_LIMITS = Object.freeze({ ...GLB_LIMITS, bytes:80*1024*1024, nodes:2048, meshes:1024 });
const MAX_TRIANGLES = 350000;
const finiteVector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) < 10000);

// Validate before GLTFLoader creates images, meshes or requests resources.
export function inspectTestMap(buffer) {
  inspectGlb(buffer, TEST_MAP_LIMITS);
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+view.getUint32(12,true))).trimEnd());
  if (json.skins?.length || json.animations?.length) throw new Error('Test maps must be static scenes, without character rigs or animations.');
  let triangles = 0;
  for (const mesh of json.meshes || []) for (const p of mesh.primitives || []) {
    if (p.mode !== undefined && p.mode !== 4) throw new Error('Map geometry must use triangles.');
    const position = json.accessors?.[p.attributes?.POSITION];
    const count = json.accessors?.[p.indices]?.count ?? position?.count;
    if (!position || !Number.isSafeInteger(count) || count < 3 || !Number.isSafeInteger(position.count)
      || position.count > MAX_TRIANGLES*3) throw new Error('Invalid map geometry.');
    triangles += count / 3;
  }
  if (!triangles || triangles > MAX_TRIANGLES) throw new Error('Choose a map with at most 350,000 triangles.');
  const nodes = json.nodes || [], parents = new Set(), visiting = new Set(), visited = new Set();
  const visit = i => {
    if (!Number.isInteger(i) || !nodes[i] || visiting.has(i)) throw new Error('Invalid map scene hierarchy.');
    if (visited.has(i)) return;
    visiting.add(i);
    const n=nodes[i];
    for (const key of ['translation','rotation','scale','matrix']) if (n[key] &&
      (!Array.isArray(n[key]) || n[key].length !== ({translation:3,rotation:4,scale:3,matrix:16}[key]) ||
      !n[key].every(x=>Number.isFinite(x)&&Math.abs(x)<10000))) throw new Error('Invalid map transform.');
    for (const child of n.children || []) {
      if (parents.has(child)) throw new Error('Map nodes cannot have multiple parents.');
      parents.add(child); visit(child);
    }
    visiting.delete(i); visited.add(i);
  };
  nodes.forEach((_,i)=>visit(i));
  return { triangles, json };
}

export function readTestMapManifest(park) {
  const entries=[];
  park.traverse(node=>{ if(node.userData.streetSkateMap !== undefined) entries.push(node.userData.streetSkateMap); });
  if (!entries.length) return null;
  if(entries.length!==1) throw new Error('The GLB must contain one map description.');
  const data=typeof entries[0]==='string'?JSON.parse(entries[0]):entries[0];
  if(data?.version!==1 || !finiteVector(data.spawn) || !Array.isArray(data.rails) || data.rails.length>512
    || !Array.isArray(data.playableRegions) || data.playableRegions.length>64 || !data.playableRegions.length)
    throw new Error('Invalid StreetSkate map description.');
  for(const rail of data.rails) if(typeof rail.name!=='string' || rail.name.length>120 || !Array.isArray(rail.points)
    || rail.points.length<2 || rail.points.length>4096 || !rail.points.every(finiteVector)
    || !Number.isFinite(rail.radius) || rail.radius<.02 || rail.radius>.5)
    throw new Error('Invalid grind path in test map.');
  for(const r of data.playableRegions) if(!['minX','maxX','minZ','maxZ'].every(k=>Number.isFinite(r[k])&&Math.abs(r[k])<10000)
    || r.minX>=r.maxX || r.minZ>=r.maxZ) throw new Error('Invalid test map boundary.');
  if(data.spawnHeading!==undefined&&!Number.isFinite(data.spawnHeading))throw new Error('Invalid spawn heading.');
  return { name:String(data.name||'Uploaded test map').slice(0,80), spawn:data.spawn, spawnHeading:data.spawnHeading||0,
    transitionScale:1, rails:data.rails.map(r=>({name:r.name,points:r.points,radius:r.radius})),
    playableRegions:data.playableRegions.map(r=>({minX:r.minX,maxX:r.maxX,minZ:r.minZ,maxZ:r.maxZ})), spots:[], routes:[] };
}

function nodeFlag(node, key) {
  for(let n=node;n;n=n.parent) if(n.userData[key]!==undefined) return n.userData[key];
}

export function assembleTestMap(park, filename='Uploaded map.glb') {
  const world={id:'test-map',park,collision:new THREE.Group(),cameraRoof:[]};
  try {
    const authored=readTestMapManifest(park), bounds=new THREE.Box3();
    const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
    park.updateMatrixWorld(true);
    let triangles=0, collisionCount=0;
    park.traverse(node=>{
      if(!node.isMesh)return;
      const role=nodeFlag(node,'streetSkateRole');
      if(role==='sky') {
        node.userData.castShadow=false;
        for(const m of Array.isArray(node.material)?node.material:[node.material]) {m.fog=false;m.depthWrite=false;m.toneMapped=false;}
        node.renderOrder=-10;
        return;
      }
      const p=node.geometry?.attributes.position;
      if(!p)throw new Error('Map contains a mesh without positions.');
      for(let i=0;i<p.count;i++) if(![p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite))throw new Error('Map contains invalid vertices.');
      const box=new THREE.Box3().setFromObject(node);
      if(![...box.min.toArray(),...box.max.toArray()].every(n=>Number.isFinite(n)&&Math.abs(n)<10000))throw new Error('Map is too large or has invalid coordinates.');
      if(role!=='collision') {bounds.union(box);triangles+=(node.geometry.index?.count||p.count)/3;}
      if(authored ? role!=='collision' : role==='decoration') return;
      const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld);
      const mesh=new THREE.Mesh(geometry,material);
      mesh.name=node.name;
      mesh.userData.surface=nodeFlag(node,'surface')==='solid'?'solid':'rideable';
      mesh.userData.transitionSkin=nodeFlag(node,'transitionSkin')===true;
      mesh.userData.railId=nodeFlag(node,'railId');
      mesh.userData.cameraTransparent=nodeFlag(node,'cameraTransparent')===true;
      world.collision.add(mesh);collisionCount++;
      if(role==='collision')node.visible=false;
    });
    if(!collisionCount) {material.dispose();throw new Error('Map has no collision surfaces.');}
    if(bounds.isEmpty())throw new Error('Map has no visible skating geometry.');
    const size=bounds.getSize(new THREE.Vector3()), center=bounds.getCenter(new THREE.Vector3());
    if(size.x<3||size.z<3||Math.max(size.x,size.z)>2000)throw new Error('Map must be between 3 and 2,000 metres across.');
    if(!authored) {
      // Generic GLBs get static mesh collision and a probed flat entrance.
      // Explicit authored paths are required to identify real grind rails.
      const surface=new ParkCollision(world.collision), ray=new THREE.Raycaster(), normal=new THREE.Vector3();
      let spawn=null;
      for(let ring=0;ring<=7&&!spawn;ring++)for(let x=-ring;x<=ring&&!spawn;x++)for(let z=-ring;z<=ring&&!spawn;z++) {
        if(ring&&Math.abs(x)!==ring&&Math.abs(z)!==ring)continue;
        ray.set(new THREE.Vector3(center.x+x*size.x/18,bounds.max.y+2,center.z+z*size.z/18),new THREE.Vector3(0,-1,0));
        for(const hit of ray.intersectObjects(surface.ridingMeshes,false)) {
          surface.normal(hit,normal);if(Math.abs(normal.y)<.98)continue;
          const p=hit.point.clone().add(new THREE.Vector3(0,.04,0));
          const body=surface.move(p,p,new THREE.Vector3(),{grounded:false});
          if(!body.contacts.length){spawn=p.toArray();break;}
        }
      }
      if(!spawn)throw new Error('No clear, flat entrance found. Add StreetSkate spawn and collision metadata.');
      world.manifest={name:filename.replace(/\.glb$/i,''),spawn,spawnHeading:0,transitionScale:1,rails:[],spots:[],routes:[],
        playableRegions:[{minX:bounds.min.x,maxX:bounds.max.x,minZ:bounds.min.z,maxZ:bounds.max.z}]};
    } else world.manifest=authored;
    Object.assign(world.manifest,{locationId:'test-map',visualTriangles:triangles,dimensions:`${Math.round(size.x)} × ${Math.round(size.z)} m · LOCAL TEST`});
    world.presentation={center:[center.x,0,center.z],sky:false,background:'#afc8d2',fogColor:'#c3d7dc',fogDensity:.00025,
      exposure:1.03,ambientSky:'#c5e3ff',ambientGround:'#827567',ambientIntensity:1.15,keyColor:'#fff0d3',keyIntensity:2.6,
      keyPosition:[center.x-45,85,center.z+30],shadowExtent:Math.max(size.x,size.z)*.6,environmentIntensity:.4,fillIntensity:.25};
    validateParkWorld(world);
    return world;
  } catch(error) {disposeParkWorld(world);throw error;}
}

export async function createTestMapWorld(file, onProgress=()=>{}) {
  if(!file || !/\.glb$/i.test(file.name) || file.size>TEST_MAP_LIMITS.bytes || file.size<20)
    throw new Error('Choose a self-contained .GLB map smaller than 80 MB.');
  onProgress('READING LOCAL MAP…');
  const buffer=await file.arrayBuffer();
  inspectTestMap(buffer);
  onProgress('PREPARING MAP SURFACES…');
  const manager=new THREE.LoadingManager();
  manager.setURLModifier(url=>{if(!url.startsWith('blob:'))throw new Error('Test maps cannot load external resources.');return url;});
  const gltf=await new GLTFLoader(manager).parseAsync(buffer,'');
  return assembleTestMap(gltf.scene,file.name);
}
