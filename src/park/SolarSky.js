import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Full-resolution photographic sky; a smaller, one-time convolution supplies
// roughness-aware reflections without a 4K lighting bake on every frame.
export async function loadSolarSky(renderer) {
  const background = await new HDRLoader().loadAsync('/assets/park/hd/solar-dusk-4k.hdr');
  background.mapping = THREE.EquirectangularReflectionMapping;
  const skyScene = new THREE.Scene();
  skyScene.background = background;
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    const environment = generator.fromScene(skyScene, 0, 0.1, 100, { size: 256 });
    return { background, environment };
  } catch (error) {
    background.dispose();
    throw error;
  } finally {
    generator.dispose();
  }
}
