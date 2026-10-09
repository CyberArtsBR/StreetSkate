import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARK_DEFINITIONS, ParkRegistry, createDefaultParkRegistry,
  validateParkManifest, validateParkWorld,
} from '../src/park/ParkRegistry.js';

const validManifest = () => ({
  name: 'Test park', spawn: [0, 0.15, 41], transitionScale: 1,
  rails: [{ name: 'Test coping', radius: 0.055, points: [[0, 1, 0], [10, 1, 0]] }],
  playableRegions: [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }],
  spots: [{ id: 'street', position: [0, 0.15, 0], heading: 0 }],
  views: { overview: { position: [20, 12, 20], target: [0, 0, 0] } },
  visualTriangles: 1234,
});
const root = () => ({ traverse() {} });

test('registry IDs are stable and FOUNDRY never aliases rooftop', () => {
  const registry = createDefaultParkRegistry({
    rooftopLoader: () => ({ id: 'roof' }),
    legacyLoader: () => ({ id: 'old' }),
    foundryLoader: () => ({ id: 'warehouse' }),
  });
  assert.deepEqual(registry.list({ selectableOnly: true }).map(p => p.id),
    ['rooftop', 'foundry', 'coming-soon-2']);
  assert.deepEqual(PARK_DEFINITIONS.map(p => p.id),
    ['rooftop', 'foundry', 'coming-soon-2', 'legacy']);
  assert.equal(registry.get('legacy').available, true);
  assert.equal(registry.get('legacy').selectable, false);
  assert.equal(registry.requirePlayable('foundry').load().id, 'warehouse');
  assert.notEqual(registry.get('foundry').load, registry.get('rooftop').load);
  assert.throws(() => registry.requirePlayable('coming-soon-2'), /not playable/);
  assert.throws(() => registry.requirePlayable('not-real'), /Unknown park ID/);
  assert.equal(registry.requirePlayable('rooftop').id, 'rooftop');
  assert.equal(registry.requirePlayable('legacy').id, 'legacy');
});

test('registry rejects duplicate IDs and invalid placeholder factories', () => {
  const registry = new ParkRegistry();
  registry.register({ id: 'unit', name: 'Unit', load() {} });
  assert.throws(() => registry.register({ id: 'unit', name: 'Again', load() {} }), /Duplicate/);
  assert.throws(() => registry.register({ id: 'Bad ID', name: 'Oops', load() {} }), /lowercase slug/);
  assert.throws(() => registry.register({ id: 'ready', name: 'Ready' }), /requires a loader/);
  assert.throws(() => registry.register({ id: 'later', name: 'Later', available: false, load() {} }), /cannot expose/);
});

test('manifest validator preserves gameplay fields without borrowing mutable arrays', () => {
  const manifest = validManifest();
  const sanitized = validateParkManifest(manifest);
  assert.deepEqual(sanitized.spawn, manifest.spawn);
  assert.equal(sanitized.rails[0].points[1][0], 10);
  assert.notEqual(sanitized.spawn, manifest.spawn);
  assert.notEqual(sanitized.rails, manifest.rails);
  assert.ok(Object.isFrozen(sanitized));
  assert.ok(Object.isFrozen(sanitized.rails[0].points[0]));
  manifest.spawn[0] = 999;
  manifest.rails[0].points[0][0] = 999;
  assert.equal(sanitized.spawn[0], 0);
  assert.equal(sanitized.rails[0].points[0][0], 0);
});

test('malformed manifests fail before world activation', () => {
  const cases = [
    [m => { m.spawn = [NaN, 2, 3]; }, /spawn/],
    [m => { m.transitionScale = 0; }, /transitionScale/],
    [m => { m.rails = null; }, /rails/],
    [m => { m.rails[0].points = [[0, 0, 0]]; }, /rails/],
    [m => { m.rails[0].points[0] = [Infinity, 0, 0]; }, /rails/],
    [m => { m.rails[0].radius = -1; }, /radius/],
    [m => { m.playableRegions[0].maxX = -99; }, /bounds/],
    [m => { m.spots[0].heading = NaN; }, /spots/],
    [m => { m.spots.push({ id: 'street', position: [1, 2, 3] }); }, /spots/],
    [m => { m.views.overview.target = [1, 2]; }, /views/],
    [m => { m.visualTriangles = -2; }, /visualTriangles/],
  ];
  for (const [mutate, expected] of cases) {
    const value = validManifest();
    mutate(value);
    assert.throws(() => validateParkManifest(value), expected);
  }
});

test('world validator requires both visual and collision roots', () => {
  const manifest = validManifest();
  assert.throws(() => validateParkWorld({ manifest, collision: root() }), /visual root/);
  assert.throws(() => validateParkWorld({ manifest, park: root() }), /collision root/);
  const world = validateParkWorld({ park: root(), collision: root(), manifest });
  assert.deepEqual(world.manifest.spawn, [0, 0.15, 41]);
});

test('Rooftop and legacy manifests fit the same validation contract', () => {
  // These reflect the authored metadata, including Rooftop spots/views and
  // legacy playableRegions added by assembleExpandedPark().
  const rooftop = validManifest();
  rooftop.dimensions = '108 × 148 m · 4 SKATE ZONES';
  rooftop.spots.push({ id: 'bowl', position: [-28, -3.65, -24] });
  const legacy = {
    ...validManifest(),
    spawn: [-13, 0.15, 12], transitionScale: 1.3,
    spots: [], views: undefined,
    playableRegions: [
      { minX: -33.65, maxX: 34.4, minZ: -22.65, maxZ: 22.65 },
      { minX: 33.5, maxX: 101.65, minZ: -22.65, maxZ: 68.65 },
    ],
  };
  assert.doesNotThrow(() => validateParkManifest(rooftop));
  assert.doesNotThrow(() => validateParkManifest(legacy));
});
