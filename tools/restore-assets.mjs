import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const assets = [
  ['deploy-assets/park/insanity-inspired-park.glb.gz', 'public/assets/park/insanity-inspired-park.glb'],
  ['deploy-assets/park/park-collision.glb.gz', 'public/assets/park/park-collision.glb'],
  ['deploy-assets/rider/TheanchoURi.glb.gz', 'public/assets/rider/TheanchoURi.glb'],
  ['deploy-assets/rider/skateboard.glb.gz', 'public/assets/rider/skateboard.glb'],
];

for (const [source, target] of assets) {
  await mkdir(path.dirname(target), { recursive: true });
  const compressed = await readFile(source);
  const restored = gunzipSync(compressed);
  await writeFile(target, restored);
  const info = await stat(target);
  console.log(`restored ${target} (${info.size} bytes)`);
}
