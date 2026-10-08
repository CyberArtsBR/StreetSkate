import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Metres, Y up. Every riding surface is also its collision surface; paint,
// lighting and scenery are deliberately excluded from the collision model.
export function createSolarDockPark() {
  const park = new THREE.Group();
  const collision = new THREE.Group();
  park.name = 'Solar Dock / desert skate terminal';
  collision.name = 'Solar Dock / authored collision';
  const rails = [];
  const batches = new Map();
  const materials = {
    concrete: new THREE.MeshStandardMaterial({ color: '#cfbda0', roughness: 0.87 }),
    bowl: new THREE.MeshStandardMaterial({ color: '#e4d9be', roughness: 0.7 }),
    graphite: new THREE.MeshStandardMaterial({ color: '#323c40', roughness: 0.72 }),
    amber: new THREE.MeshStandardMaterial({ color: '#edab38', roughness: 0.56 }),
    turquoise: new THREE.MeshStandardMaterial({ color: '#247c80', metalness: 0.48, roughness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: '#87999b', metalness: 0.75, roughness: 0.3 }),
    sand: new THREE.MeshStandardMaterial({ color: '#ae8060', roughness: 1, flatShading: true }),
    paint: new THREE.MeshStandardMaterial({ color: '#eee7d2', roughness: 0.9 }),
  };
  const proxyMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

  function add(geometry, material, surface = null, railId = null) {
    // All batches use the same attributes, regardless of the primitive source.
    if (geometry.index) { const original = geometry; geometry = geometry.toNonIndexed(); original.dispose(); }
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
    if (surface) {
      const proxy = new THREE.Mesh(geometry.clone(), proxyMaterial);
      proxy.userData.surface = surface;
      if (railId) proxy.userData.railId = railId;
      collision.add(proxy);
    }
  }

  function box(x, y, z, w, h, d, material, surface = null) {
    add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), material, surface);
  }

  function triangles(points, indices, material, surface = 'rideable') {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    add(geometry, material, surface);
  }

  function tube(a, b, radius, material, surface = null, railId = null) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 8);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
    add(geometry, material, surface, railId);
  }

  function rail(name, points, { coping = false, transition = null, posts = true } = {}) {
    const radius = coping ? 0.045 : 0.065;
    rails.push({ name, points, radius, ...(transition ? { transition } : {}) });
    for (let i = 1; i < points.length; i++) {
      tube(points[i - 1], points[i], radius, coping ? 'steel' : 'turquoise', coping ? null : 'solid', name);
    }
    if (!coping && posts) {
      for (const t of [0.08, 0.5, 0.92]) {
        const p = new THREE.Vector3(...points[0]).lerp(new THREE.Vector3(...points.at(-1)), t);
        tube([p.x, 0.04, p.z], p.toArray(), 0.055, 'graphite', 'solid', name);
      }
    }
  }

  const transition = (id, type, axisMode = 'LINEAR') => ({
    id, type, axisMode, supportsVert: true, supportsTransfer: true,
    supportsPump: true, supportsLipTricks: true, cameraHint: type,
  });

  // Extruded continuous profile. Upper faces always point up; side/back faces
  // are separate so smooth shading never rounds a hard collision edge.
  function profile(x, width, samples, material = 'graphite', yaw = 0, originZ = 0) {
    const transform = ([px, py, pz]) => [
      x + px * Math.cos(yaw) + pz * Math.sin(yaw), py,
      originZ - px * Math.sin(yaw) + pz * Math.cos(yaw),
    ];
    const points = samples.flatMap(([z, y]) => [transform([-width / 2, y, z]), transform([width / 2, y, z])]);
    const indices = [];
    const descendingZ = samples.at(-1)[0] < samples[0][0];
    for (let i = 0; i < samples.length - 1; i++) {
      const a = i * 2, b = a + 2;
      indices.push(...(descendingZ ? [a, a + 1, b, a + 1, b + 1, b] : [a, b, a + 1, a + 1, b, b + 1]));
    }
    triangles(points, indices, material);
    for (const side of [-1, 1]) {
      const vertices = [], faces = [];
      for (let i = 0; i < samples.length - 1; i++) {
        const [z0, y0] = samples[i], [z1, y1] = samples[i + 1];
        const base = vertices.length;
        vertices.push(...[[side * width / 2, 0, z0], [side * width / 2, y0, z0],
          [side * width / 2, y1, z1], [side * width / 2, 0, z1]].map(transform));
        if (y0 > 0) faces.push(base, base + 1, base + 2);
        if (y1 > 0) faces.push(base, base + 2, base + 3);
      }
      if (side * (descendingZ ? 1 : -1) > 0) {
        for (let i = 0; i < faces.length; i += 3) [faces[i + 1], faces[i + 2]] = [faces[i + 2], faces[i + 1]];
      }
      if (faces.length) triangles(vertices, faces, 'concrete', 'solid');
    }
    for (const [end, [z, y]] of [samples[0], samples.at(-1)].entries()) {
      if (y < 0.001) continue;
      triangles([[-width / 2, 0, z], [width / 2, 0, z], [width / 2, y, z], [-width / 2, y, z]].map(transform),
        (end === 0) === descendingZ ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2], 'concrete', 'solid');
    }
    return transform;
  }

  function quarter(name, x, z, width, radius, yaw = 0) {
    const samples = Array.from({ length: 21 }, (_, i) => {
      const angle = i / 20 * Math.PI / 2;
      return [-radius * Math.sin(angle), radius * (1 - Math.cos(angle))];
    });
    // The deck belongs to the same profile: no hidden back wall at the coping.
    samples.push([-radius - 2.5, radius]);
    const transform = profile(x, width, samples, 'graphite', yaw, z);
    rail(`${name} coping`, [-width / 2, width / 2].map(px => transform([px, radius + 0.025, -radius])),
      { coping: true, transition: transition(name, radius >= 4 ? 'VERT' : 'MINI') });
    for (const side of [-1, 1]) {
      for (let i = 1; i < samples.length; i++) {
        tube(transform([side * (width / 2 - 0.18), samples[i - 1][1] + 0.018, samples[i - 1][0]]),
          transform([side * (width / 2 - 0.18), samples[i][1] + 0.018, samples[i][0]]), 0.025, 'amber');
      }
    }
  }

  // One floor with a real opening for the pool, never a plane over its interior.
  const floor = new THREE.Shape();
  floor.moveTo(-54, -66); floor.lineTo(54, -66); floor.lineTo(54, 82); floor.lineTo(-54, 82); floor.closePath();
  const hole = new THREE.Path();
  hole.absarc(-28, 24, 14, 0, Math.PI * 2, true);
  floor.holes.push(hole);
  add(new THREE.ShapeGeometry(floor, 48).rotateX(-Math.PI / 2), 'concrete', 'rideable');

  // Bowl: 3.8 m deep, broad flat bottom, a full round transition and continuous
  // coping. The rim has exactly the same 96 segments as the hole in the plaza.
  const cx = -28, cz = -24, depth = 3.8, outerRadius = 14, bottomRadius = outerRadius - depth;
  const bowlPoints = [], bowlIndices = [];
  for (let row = 0; row <= 20; row++) {
    const angle = row / 20 * Math.PI / 2;
    const radius = bottomRadius + depth * Math.sin(angle), y = -depth * Math.cos(angle);
    for (let col = 0; col <= 96; col++) {
      const theta = col / 96 * Math.PI * 2;
      bowlPoints.push([cx + radius * Math.cos(theta), y, cz + radius * Math.sin(theta)]);
    }
  }
  for (let row = 0; row < 20; row++) for (let col = 0; col < 96; col++) {
    const a = row * 97 + col, b = a + 97;
    bowlIndices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  triangles(bowlPoints, bowlIndices, 'bowl');
  add(new THREE.CircleGeometry(bottomRadius, 96).rotateX(-Math.PI / 2).translate(cx, -depth, cz), 'bowl', 'rideable');
  const rim = Array.from({ length: 97 }, (_, i) => [cx + outerRadius * Math.cos(i / 96 * Math.PI * 2),
    0.025, cz + outerRadius * Math.sin(i / 96 * Math.PI * 2)]);
  rail('Orbit pool coping', rim, { coping: true, transition: transition('orbit-pool', 'BOWL', 'RADIAL') });
  // Wide coloured rim stays outside the skating surface opening.
  add(new THREE.RingGeometry(14.12, 14.65, 96).rotateX(-Math.PI / 2).translate(cx, 0.008, cz), 'turquoise');
  add(new THREE.RingGeometry(14.85, 14.9, 96).rotateX(-Math.PI / 2).translate(cx, 0.009, cz), 'paint');

  quarter('Dock halfpipe north', -28, 23, 19, 3.8);
  quarter('Dock halfpipe south', -28, 33, 19, 3.8, Math.PI);
  quarter('North terminal vert', -2, -57, 27, 5);
  quarter('East return quarter', 32, -60, 20, 4.5);

  // Street: generous run-ups, bank-to-bank tabletop, pyramid/hip and ledges.
  profile(0, 12, [[22, 0], [17, 1.6], [12, 1.6], [7, 0]]);
  rail('Tabletop rail', [[-3, 2.35, 18], [-3, 2.35, 11]], { posts: false });
  tube([-3, 1.6, 16.5], [-3, 2.35, 16.5], 0.055, 'graphite', 'solid', 'Tabletop rail');
  tube([-3, 1.6, 12.5], [-3, 2.35, 12.5], 0.055, 'graphite', 'solid', 'Tabletop rail');
  // Four bank faces meet a square tabletop. Each face is a real riding plane.
  const inner = [[-2, 1.35, -6], [2, 1.35, -6], [2, 1.35, -10], [-2, 1.35, -10]];
  const outer = [[-7, 0, -1], [7, 0, -1], [7, 0, -15], [-7, 0, -15]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    triangles([outer[i], outer[j], inner[j], inner[i]], [0, 1, 2, 0, 2, 3], 'graphite');
  }
  triangles(inner, [0, 1, 2, 0, 2, 3], 'graphite');
  box(-4, 0.3, 35, 3, 0.6, 9, 'bowl', 'rideable');
  rail('Manual pad edge', [[-5.48, 0.63, 30.5], [-5.48, 0.63, 39.5]], { coping: true });
  box(10, 0.45, -29, 3, 0.9, 11, 'bowl', 'rideable');
  rail('Long ledge', [[8.53, 0.93, -34.5], [8.53, 0.93, -23.5]], { coping: true });
  rail('Street flat rail', [[-10, 0.65, 35], [-10, 0.65, 43]]);
  rail('North flat rail', [[0, 0.8, -32], [0, 0.8, -42]]);
  // Stair set with a parallel bank and down rail, outside the main run-up lanes.
  profile(-28, 10, [[-55, 0], [-60, 1.8], [-64.5, 1.8]]);
  for (let i = 0; i < 6; i++) box(-36, (i + 1) * 0.15, -55 - i * 0.75, 6, (i + 1) * 0.3, 0.75, 'bowl', 'rideable');
  box(-36, 0.9, -61.875, 6, 1.8, 5.25, 'bowl', 'rideable');
  rail('Six stair down rail', [[-36, 1, -54.7], [-36, 2.65, -59.6]], { posts: false });
  tube([-36, 0.3, -55.3], [-36, 1.2, -55.3], 0.055, 'graphite', 'solid', 'Six stair down rail');
  tube([-36, 1.8, -59], [-36, 2.45, -59], 0.055, 'graphite', 'solid', 'Six stair down rail');

  // Mega line: 11 m roll-in, 7 m gap, broad landing and a separate return wall.
  // The launch is a kicker (not a vert lip), so it retains forward momentum.
  const rollIn = [[58, 11], [52, 11]];
  for (let i = 1; i <= 42; i++) {
    const t = i / 42;
    rollIn.push([52 - t * 42, 11 * (1 - t * t * (3 - 2 * t))]);
  }
  rollIn.push([3, 0]);
  for (let i = 1; i <= 16; i++) { const t = i / 16; rollIn.push([3 - 8 * t, 3.3 * t * t]); }
  profile(32, 18, rollIn);
  const landing = Array.from({ length: 29 }, (_, i) => {
    const t = i / 28;
    return [-12 - 19 * t, 2.4 * (1 - t) * (1 - t)];
  });
  profile(32, 21, landing);
  // Sloped side access reaches the start deck without requiring a teleport.
  profile(47, 8, [[7, 0], [58, 11], [62, 11]]);
  box(37.5, 5.5, 60, 27, 11, 4, 'graphite', 'rideable');
  for (const x of [23.25, 40.75]) {
    for (let i = 1; i < rollIn.length; i++) tube([x, rollIn[i - 1][1] + 0.02, rollIn[i - 1][0]],
      [x, rollIn[i][1] + 0.02, rollIn[i][0]], 0.035, 'amber');
  }
  box(32, 0.012, -8.5, 18, 0.012, 7, 'amber');
  for (let i = 0; i < 8; i++) box(24 + i * 2.25, 0.022, -8.5, 0.85, 0.01, 7, 'graphite');

  // Perimeter: flush painted apron and a visible low wall at the playable limit.
  for (const x of [-53.8, 53.8]) box(x, 0.4, -8, 0.4, 0.8, 148, 'graphite', 'solid');
  for (const z of [-81.8, 65.8]) box(0, 0.4, z, 108, 0.8, 0.4, 'graphite', 'solid');
  for (const x of [-52.5, 52.5]) box(x, 0.009, -8, 0.14, 0.012, 144, 'amber');
  for (const z of [-80.5, 64.5]) box(0, 0.009, z, 105, 0.012, 0.14, 'amber');

  // Graphic floor markings and large terminal signs, all visual-only.
  function sign(text, subtext, position, width, ground = false) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#25383b'; ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#edab38'; ctx.fillRect(0, 0, 18, 256);
    ctx.font = 'bold 100px sans-serif'; ctx.fillStyle = '#eee7d2'; ctx.fillText(text, 48, 126);
    ctx.font = '28px sans-serif'; ctx.fillStyle = '#a3ceca'; ctx.fillText(subtext, 52, 204);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, side: THREE.DoubleSide }));
    mesh.position.set(...position); if (ground) mesh.rotation.x = -Math.PI / 2;
    if (!ground) box(position[0], position[1], position[2] - 0.1, width, width / 4, 0.18, 'graphite', 'solid');
    park.add(mesh);
  }
  sign('SOLAR DOCK', 'DESERT SKATE TERMINAL / EST. 2026', [0, 5, -76], 26);
  for (const x of [-11.5, 11.5]) box(x, 2.5, -76.2, 0.25, 5, 0.25, 'turquoise', 'solid');
  sign('01 / STREET', 'BANKS / LEDGES / RAILS', [0, 0.025, 48], 12, true);
  sign('02 / ORBIT', 'DEEP POOL / CONTINUOUS COPING', [-28, 0.025, -5], 12, true);
  sign('03 / FLOW', 'TWIN TRANSITIONS / 3.8 M', [-28, 0.025, 45], 12, true);
  sign('04 / MEGA', '11 M ROLL-IN / 7 M GAP', [32, 11.025, 55], 14, true);
  for (let z = -47; z <= 47; z += 8) box(17.2, 0.012, z, 0.12, 0.015, 3, 'paint');

  // Distant low-poly desert and solar arrays stay outside the skating boundary.
  for (let i = 0; i < 26; i++) {
    const angle = i / 26 * Math.PI * 2, radius = 115 + (i % 4) * 15;
    const geometry = new THREE.ConeGeometry(20 + i % 5 * 5, 14 + i % 7 * 3, 5);
    geometry.rotateY(i * 1.8).translate(Math.cos(angle) * radius, -3, Math.sin(angle) * radius - 8);
    add(geometry, 'sand');
  }
  for (const x of [-60, 60]) for (const z of [-65, -28, 10, 47]) {
    box(x, 4.5, z, 0.35, 9, 0.35, 'turquoise');
    const panel = new THREE.BoxGeometry(6, 0.16, 3).rotateZ(x < 0 ? -0.18 : 0.18).translate(x, 9, z);
    add(panel, 'graphite');
    box(x, 8.8, z + 1.55, 5.5, 0.15, 0.14, 'amber');
  }

  let visualTriangles = 0;
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries, false);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[material]);
    mesh.name = `Solar Dock / ${material}`;
    mesh.userData.castShadow = material !== 'paint' && material !== 'sand';
    park.add(mesh);
    visualTriangles += geometry.attributes.position.count / 3;
    for (const source of geometries) source.dispose();
  }
  // Merge rideable collision proxies too. Keep solid rail IDs separate so a
  // grind can ignore only its own rail, never unrelated obstacles.
  const riding = collision.children.filter(mesh => mesh.userData.surface === 'rideable');
  const rideGeometry = mergeGeometries(riding.map(mesh => mesh.geometry), false);
  for (const mesh of riding) { collision.remove(mesh); mesh.geometry.dispose(); }
  const rideMesh = new THREE.Mesh(rideGeometry, proxyMaterial);
  rideMesh.userData.surface = 'rideable'; collision.add(rideMesh);
  park.updateMatrixWorld(true); collision.updateMatrixWorld(true);

  return { park, collision, manifest: {
    name: 'SOLAR DOCK', theme: 'Desert skate terminal', visualTriangles,
    dimensions: '108 × 148 m · 4 SKATE ZONES', transitionScale: 1,
    spawn: [0, 0.15, 41], rails,
    playableRegions: [{ minX: -53.3, maxX: 53.3, minZ: -81.3, maxZ: 65.3 }],
    spots: [
      { id: 'street', label: 'Street', position: [0, 0.15, 41] },
      { id: 'bowl', label: 'Pool', position: [-28, -3.65, -24] },
      { id: 'flow', label: 'Half-pipe', position: [-28, 0.15, 28] },
      { id: 'mega', label: 'Mega', position: [32, 11.15, 55] },
    ],
    views: {
      overview: { position: [122, 110, 145], target: [0, 0, -8], caption: 'Solar Dock · Desert skate terminal', index: '01' },
      bowl: { position: [3, 28, 12], target: [-28, -1.5, -24], caption: 'Orbit pool · Continuous transitions', index: '02' },
      street: { position: [22, 23, 47], target: [0, 0, 8], caption: 'Street terminal · Build your line', index: '03' },
      top: { position: [0, 173, -7.99], target: [0, 0, -8], caption: 'Four zones. One connected park.', index: '—' },
    },
  } };
}
