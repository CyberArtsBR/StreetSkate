import {mkdir,writeFile} from 'node:fs/promises';
import {launchAuditBrowser} from './quality-browser-runtime.mjs';
import {FLIP_LESSONS} from '../src/game/FlipLessons.js';
const out='public/media/flip-school';await mkdir(out,{recursive:true});
const browser=await launchAuditBrowser();
try{
  const page=await browser.newPage({viewport:{width:960,height:540}});
  page.on('pageerror',error=>console.error(error));
  await page.goto((process.env.STREETSKATE_URL||'http://127.0.0.1:5180/')+'tools/flip-demo.html');
  await page.waitForFunction(()=>window.demoReady,null,{timeout:90000});
  for(const lesson of FLIP_LESSONS){
    const result=await page.evaluate(id=>window.recordLesson(id),lesson.id);
    await writeFile(`${out}/${lesson.id}.webm`,Buffer.from(result.video.split(',')[1],'base64'));
    await writeFile(`${out}/${lesson.id}.jpg`,Buffer.from(result.poster.split(',')[1],'base64'));
    console.log(`${lesson.trick.name}: ${Math.round(result.bytes/1024)} KB`);
  }
}finally{await browser.close();}
