import test from 'node:test';
import { loadGeometry } from '../tools/load-geometry.mjs';
import { warehouseObjectName, buildImportedWarehouseCollision } from '../src/park/ImportedWarehouseCollision.js';
import { createWarehousePark } from '../src/park/WarehousePark.js';
import * as THREE from 'three';

test('diagnostic: authored Grand Warehouse ramp transition skin/solid classification',async()=>{
 const root=await loadGeometry(new URL('../public/assets/warehouse/granwarehouse.glb',import.meta.url));
 const manifest=createWarehousePark({textures:false}).manifest;
 const imported=buildImportedWarehouseCollision(root,manifest.rails,{grandMode:true});
 const grouped=new Map();
 root.updateMatrixWorld(true);
 root.traverse(mesh=>{
   if(!mesh.isMesh||mesh.userData.grandWarehouseExcluded)return;
   const name=warehouseObjectName(mesh), mat=mesh.material?.name||'';
   if(!/(ramp|quarter|corner|transition|vert|bowl|flow)/i.test(name))return;
   const group=name.split(' / ').slice(0,2).join(' / ');
   if(!grouped.has(group))grouped.set(group,{total:0,skin:0,core:0,edge:0,materials:new Set(),bounds:new THREE.Box3()});
   const entry=grouped.get(group);entry.total++;entry.bounds.expandByObject(mesh);entry.materials.add(mat);
   if(/Skateable_Surface|Bowl_Transition|Rideable_Arc|continuous ride/i.test(name))entry.skin++;
   if(/Core|Back_Panel/i.test(name))entry.core++;
   if(/Edge|Rim/i.test(name))entry.edge++;
 });
 console.log('AAA_WAREHOUSE_RAMP_GROUPS '+JSON.stringify([...grouped].map(([name,o])=>({name,total:o.total,skin:o.skin,core:o.core,edge:o.edge,mats:[...o.materials].slice(0,8),box:[...o.bounds.min.toArray(),...o.bounds.max.toArray()].map(n=>+n.toFixed(2))})).filter(x=>x.skin).slice(0,90)));
 console.log('AAA_WAREHOUSE_RAMP_SURFACES '+JSON.stringify([...new Set(imported.surfaces.filter(s=>/corner|quarter|ramp|transfer|bowl|flow/i.test(s)))].slice(0,120)));
});
