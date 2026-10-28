import {mkdir,writeFile} from 'node:fs/promises';
import {launchAuditBrowser} from './quality-browser-runtime.mjs';
const out='artifacts/local-update/performance';await mkdir(out,{recursive:true});
const browser=await launchAuditBrowser();
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const report=[];
try {
  await page.goto('http://127.0.0.1:5182/');
  await page.waitForFunction(()=>window.streetSkate?.ready,null,{timeout:90000});
  await page.locator('[data-action="practice"]').click();
  await page.locator('[data-action="hero"][data-index="0"]').click();
  await page.locator('[data-action="board"][data-index="6"]').click();
  await page.locator('[data-action="confirmLoadout"]').click();
  await page.locator('body[data-screen="playing"]').waitFor({timeout:90000});
  for(const map of ['grand-warehouse','orbit','skate-paradise']){
    await page.evaluate(async id=>{await window.streetSkate.selectLocation(id);window.streetSkate.setPaused(false);},map);
    await page.waitForTimeout(3000);
    const sample=page.evaluate(async()=>{
      const game=window.streetSkate,r=game.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
      const initial=game.skater.position.toArray(),intervals=[];let last,start;
      await new Promise(resolve=>{function frame(now){if(last!==undefined)intervals.push(now-last);else start=now;last=now;if(now-start>=60000)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame)});
      const mean=intervals.reduce((a,b)=>a+b,0)/intervals.length;intervals.sort((a,b)=>a-b);
      return {map:game.currentLocation,initial,final:game.skater.position.toArray(),fps:1000/mean,
        p95:intervals[Math.floor(intervals.length*.95)],p99:intervals[Math.floor(intervals.length*.99)],
        samples:intervals.length,over16ms:intervals.filter(ms=>ms>16.7).length,
        gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
        canvas:[r.domElement.width,r.domElement.height],status:game.graphicsStatus()};
    });
    for(let i=0;i<20;i++){
      const key=i%2?'KeyA':'KeyD';await page.keyboard.down(key);await page.waitForTimeout(1200);await page.keyboard.up(key);await page.waitForTimeout(1800);
    }
    const result=await sample;report.push(result);await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
    await page.screenshot({path:`${out}/${map}.png`});console.log(`${map}: ${result.fps.toFixed(1)} callbacks/s, p95 ${result.p95.toFixed(1)} ms, p99 ${result.p99.toFixed(1)} ms`);
  }
}finally{await browser.close();}
