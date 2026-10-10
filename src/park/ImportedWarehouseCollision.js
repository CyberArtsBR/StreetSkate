import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function warehouseObjectName(object) {
  for (let node = object; node; node = node.parent) {
    const name = node.userData?.name || node.name || '';
    if (name.includes(' / ')) return name;
  }
  return object.name || '';
}

// The Blender export stores swept tubes as ordered ten-vertex rings, with
// repeated vertices for split normals/UVs. Collapse only duplicate positions,
// average each ring and validate its radius before accepting a grind path.
export function warehouseTubePaths(geometry) {
  const position = geometry.attributes.position;
  const unique = new Map();
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    const id = p.toArray().map(v => Math.round(v * 100000)).join(',');
    if (!unique.has(id)) unique.set(id, p);
  }
  const vertices = [...unique.values()];
  if (vertices.length < 20 || vertices.length % 10) return [];
  const points = []; let radius = 0;
  for (let i = 0; i < vertices.length; i += 10) {
    const ring = vertices.slice(i, i + 10);
    const centre = ring.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(.1);
    const radii = ring.map(v => v.distanceTo(centre));
    const average = radii.reduce((a, b) => a + b, 0) / 10;
    if (average < .01 || average > .4 || Math.max(...radii) / Math.min(...radii) > 4) return [];
    radius += average;
    points.push(centre.toArray());
  }
  return [{ points, radius: radius / points.length }];
}
export function buildImportedWarehouseCollision(root, authoredRails = []) {
  root.updateMatrixWorld(true);
  const collision = new THREE.Group(); collision.name = 'Urban warehouse / imported collision';
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const buckets = new Map(), rails = [], surfaces = [];
  const add = (geometry, surface, name, railId = null) => {
    if (geometry.index) { const old = geometry; geometry = geometry.toNonIndexed(); old.dispose(); }
    for (const attribute of Object.keys(geometry.attributes)) if (attribute !== 'position') geometry.deleteAttribute(attribute);
    const id = `${surface}:${railId || ''}`;
    if (!buckets.has(id)) buckets.set(id, { geometries: [], surface, railId });
    buckets.get(id).geometries.push(geometry);
    if (surface === 'rideable') surfaces.push(name);
  };
  root.traverse(object => {
    if (!object.isMesh) return;
    const name = warehouseObjectName(object);
    const joinedRamp = object.parent?.userData?.name?.includes(' / ')
      && /Side_Wood_Core|Back_Panel/.test(name);
    // Edge bands are decorative millimetre-thin strips, not riding ramps.
    // Joined/exported bands used to become rideable and snag four-wheel
    // support at quarter walls and stair-side banks.
    if (/^06_ROOF|Floor_Markings|mounting_plate|Step_Edge|Yellow_Rim_Inlay|Side_Edge_Band/.test(name)) return;
    // The revised Blender map names bank/stair parts independently: their
    // landings and treads require support, while risers are vertical solids.
    const stairDeck = /(?:Stair|Stairs)_(?:Landing|Top_Platform|Upper_Platform|Tread|Deck|Skateable_Surface)/i.test(name);
    const rideable = joinedRamp || stairDeck || /Ground_Floor|Skateable_Surface|Surface_Plywood|Step_\d|Upper_Stair_Platform|Platform_Link|Bowl.*(?:Transition|Floor)|Rideable_Arc|Continuous_Rideable_Surface|Side_Wood_Core|Concrete_or_wood_support|Hubba_Solid/.test(name);
    const tube = /___tube/.test(name);
    const solid = /Side_Wood_Core|Back_Panel|Concrete_or_wood_support|Hubba_Solid|vertical_post|Down_Rail_Support|End_Enclosure|Rear_Panel|Structural_Pillar|Column_Footing|Warehouse_Walls|Loading_Bay_Door|(?:Stair|Stairs)_(?:Riser|Sidewall|Side_Panel|Stringer|Support|Body|Core)/i.test(name);
    if (!rideable && !solid && !tube) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    if (tube) {
      const base = name.split(' / ')[1];
      const template = authoredRails.find(rail => rail.name === base);
      const paths = warehouseTubePaths(geometry);
      if (!paths.length) throw new Error(`Cannot extract grind path from ${name}`);
      const railId = `${base} / imported ${rails.length + 1}`;
      for (const [i, path] of paths.entries()) rails.push({
        ...path, name: i ? `${railId}.${i}` : railId,
        ...(template?.transition ? { transition: { ...template.transition, id: `${template.transition.id}-${rails.length}` } } : {}),
      });
      // Coping stays available to grind/transition logic without blocking wheels
      // rolling through the lip. Regular handrails remain physical obstacles.
      if (template?.transition || /coping/i.test(base)) geometry.dispose();
      else add(geometry, 'solid', name, railId);
    } else add(geometry, rideable ? 'rideable' : 'solid', name);
  });
  let triangles = 0;
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries, false);
    for (const source of bucket.geometries) source.dispose();
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Imported collision / ${bucket.surface} / ${bucket.railId || 'world'}`;
    mesh.userData.surface = bucket.surface;
    if (bucket.railId) mesh.userData.railId = bucket.railId;
    collision.add(mesh); triangles += geometry.attributes.position.count / 3;
  }
  collision.updateMatrixWorld(true);
  if (!surfaces.length || !rails.length) throw new Error('Imported warehouse is missing riding surfaces or rails');
  return { collision, rails, triangles, surfaces };
}

