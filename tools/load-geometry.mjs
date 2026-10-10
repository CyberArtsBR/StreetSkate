import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Geometry-only loading for deterministic Node collision tests, without a GPU.
export async function loadGeometry(path) {
  const data = await readFile(path);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
  const bin = data.subarray(28 + jsonLength);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  delete json.images; delete json.textures; delete json.materials;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  globalThis.ProgressEvent ??= class ProgressEvent {};
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}
