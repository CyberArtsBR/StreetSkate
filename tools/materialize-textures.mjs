import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = new URL('../assets-source/solar/', import.meta.url);
const output = new URL('../public/assets/park/hd/', import.meta.url);
await mkdir(output, { recursive: true });
for (const asset of JSON.parse(await readFile(new URL('manifest.json', source), 'utf8'))) {
  const encoded = await Promise.all(asset.parts.map(part => readFile(new URL(part, source), 'utf8')));
  const data = Buffer.from(encoded.join('').replace(/\s/g, ''), 'base64');
  if (createHash('sha256').update(data).digest('hex') !== asset.sha256) throw new Error(`Incomplete texture: ${asset.file}`);
  await writeFile(new URL(asset.file, output), data);
}
