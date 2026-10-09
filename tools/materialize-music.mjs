import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';

// Discover every MP3 actually present at build time; never hardcode missing names.
const root = join(process.cwd(), 'public', 'audio', 'music');
mkdirSync(root, { recursive: true });
const names = readdirSync(root).filter(name => /\.mp3$/i.test(name)).sort();
const tracks = names.map(name => ({
  title: parse(name).name,
  src: '/audio/music/' + encodeURIComponent(name),
}));
writeFileSync(join(root,'playlist.json'), JSON.stringify({ tracks }, null, 2) + '\n');
console.log('Soundtrack manifest:', tracks.length, 'MP3 tracks');
