/**
 * Stable park identifiers and menu metadata. A disabled location never has a
 * fallback factory: especially important while THE FOUNDRY is being authored.
 */
export const PARK_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'rooftop', name: 'SKYLINE ROOFTOP', subtitle: 'Sunset cloud skatepark', available: true, selectable: true }),
  Object.freeze({ id: 'foundry', name: 'THE FOUNDRY', subtitle: 'Indoor warehouse · In development', available: false, selectable: true }),
  Object.freeze({ id: 'coming-soon-2', name: 'COMING SOON', subtitle: 'New location', available: false, selectable: true }),
  Object.freeze({ id: 'legacy', name: 'LEGACY PARK', subtitle: 'Expanded classic skatepark', available: true, selectable: false }),
]);

const isVec3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const fail = detail => { throw new Error(`Invalid park manifest: ${detail}`); };

export function validateParkManifest(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('missing object');
  if (!isVec3(source.spawn)) fail('spawn must contain three finite coordinates');
  if (!Number.isFinite(source.transitionScale) || source.transitionScale <= 0) fail('transitionScale must be positive');
  if (!Array.isArray(source.rails)) fail('rails must be an array');
  if (!Array.isArray(source.playableRegions) || !source.playableRegions.length) fail('playableRegions must not be empty');

  const rails = source.rails.map((rail, index) => {
    if (!rail || typeof rail !== 'object' || !Array.isArray(rail.points) ||
      rail.points.length < 2 || !rail.points.every(isVec3)) fail(`rails[${index}] points`);
    if (rail.radius !== undefined && (!Number.isFinite(rail.radius) || rail.radius <= 0)) fail(`rails[${index}] radius`);
    return Object.freeze({ ...rail, points: Object.freeze(rail.points.map(p => Object.freeze([...p]))) });
  });
  const playableRegions = source.playableRegions.map((region, index) => {
    if (!region || !['minX', 'maxX', 'minZ', 'maxZ'].every(key => Number.isFinite(region[key])) ||
        region.minX >= region.maxX || region.minZ >= region.maxZ) fail(`playableRegions[${index}] bounds`);
    return Object.freeze({ ...region });
  });
  const spotIds = new Set();
  const spots = (source.spots || []).map((spot, index) => {
    if (!spot || typeof spot.id !== 'string' || !spot.id.trim() ||
        spotIds.has(spot.id) || !isVec3(spot.position) ||
        (spot.heading !== undefined && !Number.isFinite(spot.heading))) fail(`spots[${index}]`);
    spotIds.add(spot.id);
    return Object.freeze({ ...spot, position: Object.freeze([...spot.position]) });
  });
  if (source.spots !== undefined && !Array.isArray(source.spots)) fail('spots must be an array');
  const views = {};
  if (source.views !== undefined) {
    if (!source.views || typeof source.views !== 'object' || Array.isArray(source.views)) fail('views must be an object');
    for (const [key, view] of Object.entries(source.views)) {
      if (!view || !isVec3(view.position) || !isVec3(view.target)) fail(`views.${key}`);
      views[key] = Object.freeze({
        ...view, position: Object.freeze([...view.position]), target: Object.freeze([...view.target]),
      });
    }
  }
  if (source.visualTriangles !== undefined && (!Number.isFinite(source.visualTriangles) || source.visualTriangles < 0))
    fail('visualTriangles');
  return Object.freeze({
    ...source,
    spawn: Object.freeze([...source.spawn]),
    rails: Object.freeze(rails),
    playableRegions: Object.freeze(playableRegions),
    spots: Object.freeze(spots),
    ...(source.views === undefined ? {} : { views: Object.freeze(views) }),
  });
}

export function validateParkWorld(world) {
  if (!world || typeof world !== 'object') throw new Error('Park loader returned no world.');
  if (!world.park || typeof world.park.traverse !== 'function') throw new Error('Park visual root is missing.');
  if (!world.collision || typeof world.collision.traverse !== 'function') throw new Error('Park collision root is missing.');
  return { ...world, manifest: validateParkManifest(world.manifest) };
}

export class ParkRegistry {
  #entries = new Map();

  register(entry) {
    const { id, name, subtitle = '', available = true, selectable = true, load } = entry || {};
    if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
      throw new Error('Park ID must be a stable lowercase slug.');
    if (this.#entries.has(id)) throw new Error(`Duplicate park ID: ${id}`);
    if (typeof name !== 'string' || !name.trim()) throw new Error(`Park ${id} requires a display name.`);
    if (available && typeof load !== 'function') throw new Error(`Park ${id} requires a loader.`);
    if (!available && load !== undefined) throw new Error(`Unavailable park ${id} cannot expose a loader.`);
    const registered = Object.freeze({
      id, name, subtitle, available: Boolean(available), selectable: Boolean(selectable),
      ...(available ? { load } : {}),
    });
    this.#entries.set(id, registered);
    return this;
  }

  get(id) { return this.#entries.get(id) || null; }
  list({ selectableOnly = false } = {}) {
    return Object.freeze([...this.#entries.values()]
      .filter(entry => !selectableOnly || entry.selectable)
      .map(({ id, name, subtitle, available, selectable }) =>
        Object.freeze({ id, name, subtitle, available, selectable })));
  }
  requirePlayable(id) {
    const entry = this.get(id);
    if (!entry) throw new Error(`Unknown park ID: ${String(id)}`);
    if (!entry.available) throw new Error(`Park ${id} is not playable yet.`);
    return entry;
  }
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new Error('Park load was cancelled.');
}

async function loadRooftop({ scope, signal }) {
  const [{ createSolarDockPark }, { surfaceTexturesReady }] = await Promise.all([
    import('./SolarDockPark.js'), import('./SurfaceMaterials.js'),
  ]);
  assertNotAborted(signal);
  const world = createSolarDockPark();
  // SurfaceMaterials caches photo textures globally. Dispose local geometry and
  // materials, but deliberately retain shared photo textures for the next load.
  scope.trackWorld(world, { disposeTextures: false });
  await surfaceTexturesReady();
  assertNotAborted(signal);
  return world;
}

async function loadLegacy({ scope, signal }) {
  const [{ GLTFLoader }, { assembleExpandedPark }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'), import('./ExpandedPark.js'),
  ]);
  assertNotAborted(signal);
  const loader = new GLTFLoader();
  const loadModel = async url => {
    const gltf = await loader.loadAsync(url);
    // May resolve *after* cancellation: ResourceScope immediately disposes late
    // tracked roots, so partially successful Promise.all loads do not leak.
    scope.trackRoot(gltf.scene, { disposeTextures: true });
    return gltf.scene;
  };
  const loadManifest = async () => {
    const response = await fetch('/assets/park/park-manifest.json', { signal });
    if (!response.ok) throw new Error(`Legacy manifest unavailable (HTTP ${response.status}).`);
    return response.json();
  };
  const [park, collision, manifest, expanded] = await Promise.all([
    loadModel('/assets/park/insanity-inspired-park.glb'),
    loadModel('/assets/park/park-collision.glb'),
    loadManifest(),
    loadModel('/assets/park/halfnew.glb?v=fixed-black'),
  ]);
  assertNotAborted(signal);
  const assembled = assembleExpandedPark(expanded, park, collision, manifest);
  scope.trackWorld(assembled, { disposeTextures: true });
  return { ...assembled, manifest };
}

export function createDefaultParkRegistry({ rooftopLoader = loadRooftop, legacyLoader = loadLegacy } = {}) {
  const registry = new ParkRegistry();
  for (const definition of PARK_DEFINITIONS) {
    const load = definition.id === 'rooftop' ? rooftopLoader :
      definition.id === 'legacy' ? legacyLoader : undefined;
    registry.register({ ...definition, ...(load ? { load } : {}) });
  }
  return registry;
}
