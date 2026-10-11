import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { batchWarehouseVisuals } from './WarehouseVariants.js';

// The supplied export contains the authored COL_ proxies alongside its visuals.
export function splitOrbitScene(scene) {
  scene.updateMatrixWorld(true);
  const collision = new THREE.Group();
  collision.name = 'ORBIT / authored collision';
  const proxies = [];
  scene.traverse(object => {
    if (object.isMesh && /^COL_/.test(object.name)) proxies.push(object);
  });
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const object of proxies) {
    const name = object.userData.name || object.name;
    const mesh = new THREE.Mesh(object.geometry.clone().applyMatrix4(object.matrixWorld), material);
    mesh.name = name;
    mesh.userData.surface = /orbital.bowl|continuous.ride|broad.bank.circuit.ride|COL_Deck|manual.pad|ledge/i.test(name)
      ? 'rideable' : 'solid';
    if (/collision.bar/.test(name)) {
      mesh.userData.railId = name.replace(/^COL_/, '').split(' / ')[0];
    }
    collision.add(mesh);
    object.removeFromParent();
    object.geometry.dispose();
  }
  if (!proxies.length) throw new Error('ORBIT is missing authored collision proxies.');
  const { park, visualTriangles } = batchWarehouseVisuals(scene, 'ORBIT');
  return { park, collision, visualTriangles };
}

export async function createOrbitPark() {
  const [gltf, manifest, sky] = await Promise.all([
    new GLTFLoader().loadAsync('/assets/spacepark/orbit.glb'),
    fetch('/assets/spacepark/orbit-manifest.json').then(response => {
      if (!response.ok) throw new Error('ORBIT manifest unavailable.');
      return response.json();
    }),
    new THREE.TextureLoader().loadAsync('/assets/spacepark/textures/galaxy-4k.png'),
  ]);
  const world = splitOrbitScene(gltf.scene);
  sky.colorSpace = THREE.SRGBColorSpace;
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24),
    new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, depthWrite: false, fog: false }));
  backdrop.userData.castShadow = false;
  world.park.add(backdrop);
  manifest.visualTriangles = world.visualTriangles;
  return { ...world, manifest };
}
