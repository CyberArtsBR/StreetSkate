import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.env.AGENT10_DIST||'dist');
async function nonempty(file){const st=await stat(join(root,file));assert.ok(st.isFile()&&st.size>0,file+' missing/empty');}
const html=await readFile(join(root,'index.html'),'utf8');
assert.match(html,/id="app"/);assert.match(html,/id="viewport"/);
assert.ok(!html.includes('src="/src/game-main.js"'),'Development entrypoint shipped');
assert.match(html,/assets\/[^"' ]+\.js/,'No bundled production entrypoint');
const scripts=(await readdir(join(root,'assets'))).filter(x=>x.endsWith('.js'));
assert.ok(scripts.length>0,'No production JS');
for(const x of scripts)await nonempty('assets/'+x);
for(const x of ['The_Heretic.glb','The_AdolescentUR.glb','The_Anchor.glb','TuxR.glb'])await nonempty('assets/rider/'+x);
for(const x of ['title-screen.png','trick-guide-16x9.png'])await nonempty('media/'+x);
console.log('AGENT10 PRODUCTION VERIFY PASS: '+scripts.length+' JS bundles, four riders, two UI assets');
