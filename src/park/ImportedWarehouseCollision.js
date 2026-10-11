import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { repairImportedWarehouse } from './ImportedWarehouseRepairs.js';

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
  const vertices = [...unique.values()], ids = new Map([...unique.keys()].map((key, i) => [key, i]));
  const vertexIds = Array.from({ length: position.count }, (_, i) => ids.get(
    [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 100000)).join(',')));
  const parents = vertices.map((_, i) => i);
  const find = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const index = geometry.index;
  for (let i = 0; i < (index?.count || position.count); i += 3) {
    const a = vertexIds[index ? index.getX(i) : i];
    for (let j = 1; j < 3; j++) parents[find(vertexIds[index ? index.getX(i + j) : i + j])] = find(a);
  }
  // Joined materials may contain two independent coping bars. Never create a
  // phantom diagonal rail by connecting the end of one to the start of another.
  const components = new Map();
  vertices.forEach((vertex, i) => { const key = find(i); if (!components.has(key)) components.set(key, []); components.get(key).push(vertex); });
  const paths = [];
  for (const component of components.values()) {
    if (component.length < 20 || component.length % 10) return [];
    const points = []; let radius = 0;
    for (let i = 0; i < component.length; i += 10) {
      const ring = component.slice(i, i + 10);
      const centre = ring.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(.1);
      const radii = ring.map(v => v.distanceTo(centre));
      const average = radii.reduce((a, b) => a + b, 0) / 10;
      if (average < .01 || average > .4 || Math.max(...radii) / Math.min(...radii) > 4) return [];
      radius += average; points.push(centre.toArray());
    }
    paths.push({ points, radius: radius / points.length });
  }
  return paths;
}
export function buildImportedWarehouseCollision(root, authoredRails = [], { grandMode = false } = {}) {
  const repairs = repairImportedWarehouse(root, {
    preserveArtistLayout: grandMode,
    preserveFloorFinish: grandMode,
  });
  root.updateMatrixWorld(true);
  const collision = new THREE.Group(); collision.name = 'Urban warehouse / imported collision';
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const buckets = new Map(), rails = [], surfaces = [], railPaths = new Set();
  const add = (geometry, surface, name, railId = null) => {
    if (geometry.index) { const old = geometry; geometry = geometry.toNonIndexed(); old.dispose(); }
    for (const attribute of Object.keys(geometry.attributes)) if (attribute !== 'position') geometry.deleteAttribute(attribute);
    const cameraTransparent = Boolean(railId) || /vertical_post|Down_Rail_Support/.test(name);
    const id = `${surface}:${railId || ''}:${cameraTransparent}`;
    if (!buckets.has(id)) buckets.set(id, { geometries: [], surface, railId, cameraTransparent });
    buckets.get(id).geometries.push(geometry);
    if (surface === 'rideable') surfaces.push(name);
  };
  root.traverse(object => {
    if (!object.isMesh) return;
    const name = warehouseObjectName(object);
    const materialName = object.material?.name || '';
    const joinedRamp = object.parent?.userData?.name?.includes(' / ')
      && /Side_Edge_Band|Side_Wood_Core|Back_Panel/.test(name);
    const grandMetal = grandMode && /Foundry_(?:Stainless_Coping|Grind_Rail)/.test(materialName);
    // Blender can join metal rails into mixed-material ramp, ledge and side
    // meshes. GLTFLoader splits those materials into child primitives. Rebuild
    // grind paths only from the metal pipe primitive, not its wooden support.
    const grandEmbeddedCoping = grandMetal && !/___tube/.test(name)
      && /Skateable_Surface|Side_Wood_Core|Back_Panel|Hubba_Solid|Curved_Quarter_Rear_Panel/.test(name);
    const joinedCoping = (joinedRamp && /Stainless_Coping/.test(materialName))
      || grandEmbeddedCoping;
    const grandMixedTubePart = grandMode && /___tube/.test(name) && !grandMetal;
    const grandMixedRampPart = grandMode && /Skateable_Surface/.test(name)
      && !/Foundry_Plywood(?:\.\d+)?$/.test(materialName) && !grandMetal;
    // Imported multilayer quarter meshes contain dark timber sides under the
    // same Skateable_Surface object name. They are solids, not wheel support.
    if (grandMixedRampPart && /Plywood_Edges/.test(materialName)) return;
    const joinedRiding = joinedRamp && /Foundry_Plywood(?:\.\d+)?$/.test(materialName);
    // Blender joins preserve material primitives, not the original object
    // labels. Edge trim must never become a second wall or wheel surface.
    if (joinedRamp && /Plywood_Edges/.test(materialName)) return;
    if (/^06_ROOF|Floor_Markings|mounting_plate|Step_Edge|Yellow_Rim_Inlay/.test(name)
      || (/Side_Edge_Band/.test(name) && !joinedRamp)) return;
    const stairLanding = /(?:Stair|Stairs)_(?:Landing|Top_Platform|Upper_Platform|Tread|Deck|Skateable_Surface)/i.test(name);
    const rideable = joinedRamp ? joinedRiding
      : (grandMixedTubePart || grandMixedRampPart)
        ? /Foundry_Plywood(?:\.\d+)?$/.test(materialName)
        : stairLanding || /Ground_Floor|Skateable_Surface|Surface_Plywood|Step_\d|Upper_Stair_Platform|Platform_Link|Bowl.*(?:Transition|Floor)|Rideable_Arc|Continuous_Rideable_Surface|Hubba_Solid/.test(name);
    const tube = joinedCoping || (/___tube/.test(name) && (!grandMode || grandMetal));
    const solid = joinedRamp || grandMixedTubePart || grandMixedRampPart || /Side_Wood_Core|Back_Panel|Concrete_or_wood_support|Hubba_Solid|vertical_post|Down_Rail_Support|End_Enclosure|Rear_Panel|Structural_Pillar|Column_Footing|Warehouse_Walls|Loading_Bay_Door|(?:Stair|Stairs)_(?:Riser|Sidewall|Side_Panel|Stringer|Support|Body|Core)/i.test(name);
    if (!rideable && !solid && !tube) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    if (tube) {
      const base = name.split(' / ')[1] + (joinedCoping ? ' coping' : '');
      const template = authoredRails.find(rail => rail.name === base)
        || (joinedCoping ? authoredRails.find(rail => rail.name.startsWith(base.replace(/ coping$/, '') + ' ') && rail.transition) : null);
      const paths = warehouseTubePaths(geometry);
      if (!paths.length) {
        if (!grandMode) throw new Error(`Cannot extract grind path from ${name}`);
        // Some joined steel details are supports, not valid 10-sided pipes.
        // Preserve them as physical blockers, never create a phantom grind.
        add(geometry, 'solid', name);
        return;
      }
      const railId = `${base} / imported ${rails.length + 1}`;
      for (const [i, path] of paths.entries()) {
        const forward = path.points.map(p => p.map(v => Math.round(v * 10000)).join(',')).join(';');
        const reverse = path.points.slice().reverse().map(p => p.map(v => Math.round(v * 10000)).join(',')).join(';');
        const signature = forward < reverse ? forward : reverse;
        const coincident = rails.some(rail => rail.points.length === path.points.length
          && Math.abs(rail.radius - path.radius) < .0001
          && [path.points, path.points.slice().reverse()].some(points => points.every((p, j) =>
            p.every((v, axis) => Math.abs(v - rail.points[j][axis]) < .0001))));
        if (railPaths.has(signature) || coincident) continue;
        railPaths.add(signature);
        rails.push({
          ...path, name: i ? `${railId}.${i}` : railId,
          ...(template?.transition ? { transition: { ...template.transition, id: `${template.transition.id}-${rails.length}` } } : {}),
        });
      }
      // Coping stays available to grind/transition logic without blocking wheels
      // rolling through the lip. Regular handrails remain physical obstacles.
      if (template?.transition || /coping/i.test(base)) geometry.dispose();
      else add(geometry, 'solid', name, railId);
    } else add(geometry, rideable ? 'rideable' : 'solid', joinedRiding
      ? name.replace(/Side_Edge_Band|Side_Wood_Core|Back_Panel/, 'Skateable_Surface') : name);
  });
  let triangles = 0;
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries, false);
    for (const source of bucket.geometries) source.dispose();
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Imported collision / ${bucket.surface} / ${bucket.railId || 'world'}`;
    mesh.userData.surface = bucket.surface;
    mesh.userData.cameraTransparent = bucket.cameraTransparent;
    if (bucket.railId) mesh.userData.railId = bucket.railId;
    collision.add(mesh); triangles += geometry.attributes.position.count / 3;
  }
  collision.updateMatrixWorld(true);
  if (!surfaces.length || !rails.length) throw new Error('Imported warehouse is missing riding surfaces or rails');
  return { collision, rails, triangles, surfaces, repairs };
}

