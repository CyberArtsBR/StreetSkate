import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWarehousePark } from './WarehousePark.js';
import { buildImportedWarehouseCollision, warehouseObjectName } from './ImportedWarehouseCollision.js';
import { createUrbanRubberFloorMaterial, isUrbanRubberFloorName, tileUrbanRubberFloorUVs } from './UrbanRubberFloor.js';

// The exported GLBs preserve The Foundry's 150 x 110 metre topology.
// Reusing the Foundry's authored collision/rails (rather than raycasting visual
// decoration) gives both imported versions the tested bowl, quarter, halfpipe,
// floor-hole and grind behavior without changing universal skateboard physics.
const VARIANTS = Object.freeze({
  'tron-warehouse': {
    name: 'TRON WAREHOUSE',
    url: '/assets/warehouse/tron-warehouse.glb',
    exposure: .94,
    light: '#a4eaff',
    ambient: '#b2d8ff',
    ground: '#0b1e36',
    background: '#111d30',
    floor: '#1b3444',
    theme: 'Electric cyan / futuristic indoor warehouse',
  },
  'urban-warehouse': {
    name: 'URBAN WAREHOUSE',
    url: '/assets/warehouse/urban-warehouse.glb?v=f8c834b2',
    exposure: 1.1,
    light: '#ffe4cb',
    ambient: '#d8e1e9',
    ground: '#544434',
    background: '#3f4549',
    floor: '#24272a',
    theme: 'Revised Foundry / charcoal rubber plaza / expanded ramp lines',
  },
});

function releaseVisualRoot(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

// The Blender exports contain ~2,000 tiny draw calls. Batch by material,
// attribute signature and roof visibility without changing vertex positions.
// Keep roof meshes separate so the game's roof cutaway remains functional.
export function batchWarehouseVisuals(root, name, { rubberMaterial = null } = {}) {
  root.updateMatrixWorld(true);
  const batches = new Map(), oldGeometry = new Set();
  let sourceMeshes = 0, visualTriangles = 0, rubberFloorMeshes = 0;
  root.traverse(object => {
    if (!object.isMesh) return;
    sourceMeshes++;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.length !== 1 || !object.geometry?.attributes?.position) return;
    const groundName = warehouseObjectName(object);
    const rubberFloor = Boolean(rubberMaterial && (
      isUrbanRubberFloorName(object.name) || isUrbanRubberFloorName(groundName)
    ));
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (rubberFloor) {
      tileUrbanRubberFloorUVs(geometry);
      rubberFloorMeshes++;
    }
    const groupName = groundName.split(' / ')[0];
    const roof = groupName.startsWith('06_ROOF_CUTAWAY');
    const attrs = Object.keys(geometry.attributes).sort().join(',');
    const finalMaterial = rubberFloor ? rubberMaterial : materials[0];
    const key = [finalMaterial.uuid, roof ? 'roof' : 'park', attrs, geometry.index ? 'idx' : 'nonidx'].join(':');
    if (!batches.has(key)) batches.set(key, { material: finalMaterial, roof, geometries: [] });
    batches.get(key).geometries.push(geometry);
    oldGeometry.add(object.geometry);
    visualTriangles += (geometry.index?.count || geometry.attributes.position.count) / 3;
  });
  if (sourceMeshes === 0 || batches.size === 0)
    throw new Error('Warehouse GLB does not contain renderable geometry.');
  const park = new THREE.Group();
  park.name = name;
  let draws = 0;
  for (const bucket of batches.values()) {
    const geo = bucket.geometries.length === 1 ? bucket.geometries[0] : mergeGeometries(bucket.geometries, false);
    if (!geo) throw new Error('Could not batch warehouse geometry.');
    if (bucket.geometries.length !== 1) for (const source of bucket.geometries) source.dispose();
    const mesh = new THREE.Mesh(geo, bucket.material);
    mesh.name = `${name} / ${bucket.roof ? 'roof' : 'park'} / batch ${++draws}`;
    mesh.userData.cameraRoof = bucket.roof;
    mesh.userData.warehouseRoof = bucket.roof;
    mesh.userData.castShadow = false; // 2000 source objects do not get 2000 shadows.
    mesh.receiveShadow = true;
    park.add(mesh);
  }
  // The batched meshes retain the imported GLB materials/textures.
  for (const geometry of oldGeometry) geometry.dispose();
  return { park, visualTriangles, sourceMeshes, drawCalls: draws, rubberFloorMeshes };
}

export async function createWarehouseVariant(id) {
  const variant = VARIANTS[id];
  if (!variant) throw new Error(`Unknown warehouse version: ${id}`);

  // Fetch before allocating a procedural world. A missing asset must fail
  // without entering a fake Foundry location or corrupting the current session.
  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(variant.url);
  } catch (error) {
    throw new Error(`${variant.name} needs ${variant.url}; upload the GLB to public/assets/warehouse/ first. ${error.message || ''}`);
  }
  const world = createWarehousePark({ textures: false });
  let batched, imported;
  const rubberMaterial = id === 'urban-warehouse' ? createUrbanRubberFloorMaterial() : null;
  try {
    if (id === 'urban-warehouse') imported = buildImportedWarehouseCollision(gltf.scene, world.manifest.rails);
    batched = batchWarehouseVisuals(gltf.scene, variant.name, { rubberMaterial });
    if (rubberMaterial && !batched.rubberFloorMeshes) {
      throw new Error('Urban warehouse has no recognized rubber floor objects; check the GLB ground mesh names.');
    }
  } catch (error) {
    if (rubberMaterial) {
      rubberMaterial.map?.dispose();
      rubberMaterial.bumpMap?.dispose();
      rubberMaterial.dispose();
    }
    releaseVisualRoot(gltf.scene);
    releaseVisualRoot(world.park);
    releaseVisualRoot(world.collision);
    if (imported) releaseVisualRoot(imported.collision);
    throw error;
  }
  // All wheel support, solids, bowl transitions, coping metadata and grind
  // paths are inherited from the verified original warehouse.
  releaseVisualRoot(world.park);
  world.park = batched.park;
  if (imported) {
    releaseVisualRoot(world.collision);
    world.collision = imported.collision;
    world.manifest.rails = imported.rails;
    world.manifest.collisionTriangles = imported.triangles;
    world.manifest.statistics.collisionTriangles = imported.triangles;
    world.manifest.statistics.collisionMeshes = imported.collision.children.length;
    world.manifest.statistics.rails = imported.rails.length;
    world.manifest.statistics.importedRidingSurfaces = imported.surfaces.length;
    // Authored Foundry feature locations/lines are stale after Blender edits.
    world.manifest.features = [];
    world.manifest.lines = [];
  }

  // Tiny underlay closes visual seams without capping the recessed bowl.
  // Never replace the depressed bowl with a full-height rectangular floor.
  const filler = imported ? null : new THREE.MeshStandardMaterial({
    name: `${id} / seam underlay`, color: variant.floor,
    roughness: .9, metalness: 0, side: THREE.DoubleSide,
  });
  for (const proxy of imported ? [] : world.collision.children) {
    if (proxy.userData.surface !== 'rideable') continue;
    const patch = new THREE.Mesh(proxy.geometry, filler);
    patch.name = `${id} / rideable seam backup`;
    patch.position.y = -.025;
    patch.userData.castShadow = false;
    patch.receiveShadow = true;
    world.park.add(patch);
  }

  const manifest = world.manifest;
  manifest.id = id;
  manifest.name = variant.name;
  manifest.theme = variant.theme;
  manifest.views = {
    ...manifest.views,
    overview: { ...manifest.views.overview, caption: `${variant.name} · Four connected districts` },
    top: { ...manifest.views.top, caption: `${variant.name} · 150 × 110 metres` },
  };
  manifest.statistics = {
    ...manifest.statistics, sourceMeshes: batched.sourceMeshes, visualMeshes: batched.drawCalls,
    visualTriangles: batched.visualTriangles, batchedDrawCalls: batched.drawCalls,
    rubberFloorMeshes: batched.rubberFloorMeshes,
  };
  manifest.visualTriangles = batched.visualTriangles;
  manifest.environment = {
    ...manifest.environment, background: variant.background, fog: variant.background,
    fogNear: 100, fogFar: 225, exposure: variant.exposure,
    keyColor: variant.light, keyIntensity: id === 'tron-warehouse' ? 2.3 : 2.6,
    ambientSky: variant.ambient, ambientGround: variant.ground,
    ambientIntensity: id === 'tron-warehouse' ? 1.35 : 1.6,
    roofFadeHeight: 18,
  };
  world.ready = Promise.resolve();
  return world;
}
