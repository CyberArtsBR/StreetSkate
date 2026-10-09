import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PortraitPromiseCache } from './PortraitPromiseCache.js';

const cache = new PortraitPromiseCache(8);
let renderer = null;

/** Drop cached previews before revoking an uploaded character's blob URL. */
export function forgetCharacterPortrait(url) {
  if (url) cache.delete(url);
}

/**
 * Offscreen GLB rendering owns its imported textures, skeletons and materials.
 * Without this cleanup, every custom preview can leak GPU resources on the
 * shared portrait renderer even after the canvas has produced its PNG.
 */
function disposePortraitModel(model) {
  const skeletons = new Set();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  model.traverse(item => {
    if (item.skeleton) skeletons.add(item.skeleton);
    if (item.geometry) geometries.add(item.geometry);
    const list = Array.isArray(item.material) ? item.material : [item.material];
    for (const material of list) if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    if (material.uniforms) {
      for (const uniform of Object.values(material.uniforms)) {
        const value = uniform?.value;
        if (value?.isTexture) textures.add(value);
        if (Array.isArray(value)) for (const entry of value) if (entry?.isTexture) textures.add(entry);
      }
    }
  }
  for (const skeleton of skeletons) skeleton.dispose?.();
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
  for (const texture of textures) texture.dispose?.();
  model.removeFromParent();
}

/** Render an imported GLB as a small static image, never keeping its mesh alive. */
async function renderPortrait(url) {
  const model = (await new GLTFLoader().loadAsync(url)).scene;
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({
        antialias: true, alpha: true, powerPreference: 'low-power',
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(1);
      renderer.setSize(320, 340);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight('#eff5ff', '#4d3146', 2.15);
    scene.add(hemi);
    const key = new THREE.DirectionalLight('#ffe8ce', 3);
    key.position.set(-3, 7, 5);
    scene.add(key);
    const bounds = new THREE.Box3().setFromObject(model);
    const dims = bounds.getSize(new THREE.Vector3());
    if (!(dims.y > 0.001) || !Number.isFinite(dims.y)) throw new Error('Invalid GLB bounds');
    const normalized = new THREE.Group();
    normalized.add(model);
    scene.add(normalized);
    model.scale.setScalar(2.0 / dims.y);
    const scaledBounds = new THREE.Box3().setFromObject(model);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.rotation.y = Math.PI / 5;
    // Frame face, ears, headwear and shoulders at thumbnail scale.
    const camera = new THREE.PerspectiveCamera(39, 320 / 340, 0.05, 40);
    // Oversized Chimpions heads and muzzle shapes extend well below the cranium.
    // Fit the full original normalized model in the vertical preview so the
    // mouth, ears and hats never disappear beneath the portrait's bottom edge.
    camera.position.set(0, 0.2, 3.4);
    camera.lookAt(0, 0.18, 0);
    renderer.setClearColor(0, 0);
    renderer.clear();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    // Three's render list otherwise retains references to the last avatar
    // despite its GLB and preview scene no longer being in the DOM.
    renderer?.renderLists?.dispose();
    disposePortraitModel(model);
  }
}

export function characterPortrait(url) {
  return cache.getOrLoad(url, () => renderPortrait(url));
}
