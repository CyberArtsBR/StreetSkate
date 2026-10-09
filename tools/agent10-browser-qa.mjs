// Agent 10: black-box tests of the built production app, with failure evidence.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const url=process.env.STREETSKATE_URL||'http://127.0.0.1:4173';
const out=process.env.AGENT10_ARTIFACT_DIR||'artifacts/agent10';
await mkdir(out,{recursive:true});
const report={url,started:new Date().toISOString(),checks:[],pageErrors:[],requestFailures:[],consoleErrors:[],samples:[]};
// Headless Chromium can deprioritize RAF in software WebGL even while the
// tab is under test. Disable background throttling without lowering the
// required number of animation frames.
const browser=await chromium.launch({headless:true,args:[
 '--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
 '--disable-background-timer-throttling','--disable-renderer-backgrounding',
 '--disable-backgrounding-occluded-windows',
]});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.addInitScript(()=>{
  window.__agent10Unhandled=[];
  window.addEventListener('unhandledrejection',event=>{
    window.__agent10Unhandled.push(String(event.reason?.message||event.reason));
  });
});
const page=await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror',e=>report.pageErrors.push(String(e.stack||e)));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
page.on('requestfailed',r=>{report.requestFailures.push({url:r.url(),reason:r.failure()?.errorText||''});});
function checked(label,fn){return (async()=>{await fn();report.checks.push({label,ok:true});console.log('QA PASS: '+label);})();}
async function gotoTitle(){
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.streetSkate?.ready===true,null,{timeout:90000});
 await page.locator('body[data-screen="title"]').waitFor();
 assert.equal(await page.locator('#viewport canvas').count(),1,'Expected exactly one canvas');
}
async function chooseLoadout(){
 await page.locator('.loadout-character').first().click();
 await page.locator('.loadout-deck').nth(2).click();
 assert.equal(await page.locator('[data-action="confirmLoadout"]').isDisabled(),false);
 await page.locator('[data-action="confirmLoadout"]').click();
 await page.locator('body[data-screen="playing"]').waitFor({timeout:60000});
 assert.equal(await page.locator('body[data-screen="tutorial"]').count(),0,
   'valid loadout must start gameplay directly without a mandatory tutorial');
}
async function finishTutorial(){
 await page.locator('body[data-screen="playing"]').waitFor({timeout:30000});
 assert.equal(await page.locator('body[data-screen="tutorial"]').count(),0);
}
async function stats(stage){
 const sample=await page.evaluate(async()=>{
  const g=window.streetSkate;
  const renderer=g?.renderer;
  const startFrame=renderer?.info?.render?.frame;
  const started=performance.now();
  const deltas=[];let previous=started,observing=true;
  // Collect RAF timing as telemetry, but the liveness gate uses Three.js's
  // real renderer.info.render.frame counter. A fixed observation window does
  // not prematurely abort when SwiftShader exceeds a 600ms frame time.
  const measure=()=>{
   const now=performance.now();
   deltas.push(now-previous);previous=now;
   if(observing)requestAnimationFrame(measure);
  };
  requestAnimationFrame(measure);
  await new Promise(resolve=>setTimeout(resolve,8000));
  observing=false;
  const elapsedMs=performance.now()-started;
  const finishFrame=renderer?.info?.render?.frame;
  const frameCount=Number.isFinite(startFrame)&&Number.isFinite(finishFrame)
   ?Math.max(0,finishFrame-startFrame):0;
  const sorted=deltas.filter(Number.isFinite).sort((a,b)=>a-b);
  const percentile=p=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(p*(sorted.length-1)))]:null;
  const render=renderer?.info?.render,memory=renderer?.info?.memory;
  return {frameCount,rafSamples:deltas.length,
   fps:frameCount/(elapsedMs/1000),elapsedMs,
   frameMsP50:percentile(.5),frameMsP95:percentile(.95),
   frameMsP99:percentile(.99),frameMsMax:sorted.at(-1)??null,
   drawCalls:render?.calls??null,triangles:render?.triangles??null,
   geometries:memory?.geometries??null,textures:memory?.textures??null,
   jsHeap:performance.memory?.usedJSHeapSize??null,
   player:g?.skater?.position?.toArray?.()??null,
   camera:g?.camera?.position?.toArray?.()??null,
   invariantViolations:g?.skater?.stateInvariantViolations?.map?.(x=>x.code)??[],
   focused:document.hasFocus(),hidden:document.hidden};
 });
 report.samples.push({stage,...sample});
 console.log('AGENT10 RENDER SAMPLE '+JSON.stringify({stage,...sample}));
 assert.ok(Array.isArray(sample.player)&&sample.player.every(Number.isFinite),'Non-finite player');
 assert.ok(Array.isArray(sample.camera)&&sample.camera.every(Number.isFinite),'Non-finite camera');
 assert.deepEqual(sample.invariantViolations,[],'Runtime invariant failures');
 assert.ok(sample.frameCount>3,'Game loop did not render sufficient frames');
}
try{
 await checked('startup and playable renderer',gotoTitle);
 await checked('packaged rider and title media are accessible',async()=>{
  for(const asset of ['/assets/rider/The_Heretic.glb','/assets/rider/The_AdolescentUR.glb',
   '/assets/rider/The_Anchor.glb','/assets/rider/TuxR.glb',
   '/media/title-screen.png','/media/trick-guide-16x9.png']){
   const r=await page.request.head(url+asset);
   assert.ok(r.ok(),asset+' returned '+r.status());
  }
 });
 await checked('options camera and persisted music volume',async()=>{
  await page.locator('[data-action="options"]').click();
  await page.locator('[data-action="camera"]').click();
  await page.locator('[data-action="volumeDown"]').click();
  const stored=await page.evaluate(()=>localStorage.getItem('streetskate.masterVolume'));
  assert.ok(Number.isFinite(Number(stored))&&Number(stored)>=0&&Number(stored)<=1);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.streetSkate?.ready===true,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>localStorage.getItem('streetskate.masterVolume')),stored);
  await page.locator('body[data-screen="title"]').waitFor();
 });
 await checked('timed run selection, grid keyboard, and disabled locations',async()=>{
  await page.locator('[data-action="start"]').click();
  await page.locator('body[data-screen="select"]').waitFor();
  assert.equal(await page.locator('.loadout-character').count(),4);
  assert.equal(await page.locator('.loadout-deck').count(),8);
  assert.equal(await page.locator('.loadout-location').count(),3);
  assert.equal(await page.locator('.loadout-location[disabled]').count(),2);
  assert.equal(await page.locator('[data-action="confirmLoadout"]').isDisabled(),true);
  await page.locator('.loadout-character').first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator(':focus').getAttribute('data-index'),'1');
  await page.keyboard.press('ArrowDown');
  assert.notEqual(await page.locator(':focus').getAttribute('data-action'),'hero');
 });
 await checked('invalid custom avatar is rejected without DOM injection',async()=>{
  const input=page.locator('input[type="file"][accept*=".glb"]');
  await input.setInputFiles({name:'not-a-model.glb',mimeType:'model/gltf-binary',buffer:Buffer.alloc(128)});
  await page.waitForFunction(() => /Invalid GLB header/i.test(document.querySelector('.loadout-status')?.textContent || ''), null, { timeout: 30000 });
  assert.match(await page.locator('.loadout-status').textContent(),/Invalid GLB header/i);
  assert.equal(await page.locator('.loadout-character').count(),4);
  // A magic-only fake is not a valid GLB. It must never become selectable.
  const invalid=Buffer.alloc(128);invalid.write('glTF');
  await input.setInputFiles({name:'<img src=x onerror=alert(1)>.glb',mimeType:'model/gltf-binary',buffer:invalid});
  await page.waitForFunction(() => /Invalid GLB header/i.test(document.querySelector('.loadout-status')?.textContent||''), null, { timeout: 30000 });
  assert.equal(await page.locator('.loadout-character').count(),4);
  assert.equal(await page.locator('img[src="x"]').count(),0);

  // Conversely, accept a real, small, self-contained GLB v2 and escape its
  // potentially dangerous filename. This tests validation and DOM safety.
  const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}]}),'utf8');
  const aligned=Math.ceil(json.length/4)*4;
  const valid=Buffer.alloc(20+aligned,0x20);
  valid.write('glTF',0,'ascii');
  valid.writeUInt32LE(2,4);
  valid.writeUInt32LE(valid.length,8);
  valid.writeUInt32LE(aligned,12);
  valid.writeUInt32LE(0x4e4f534a,16);
  json.copy(valid,20);
  await input.setInputFiles({name:'<img src=x onerror=alert(1)>.glb',mimeType:'model/gltf-binary',buffer:valid});
  await page.waitForFunction(() => document.querySelectorAll('.loadout-character').length === 5, null, { timeout: 30000 });
  assert.equal(await page.locator('img[src="x"]').count(),0);
  assert.equal(await page.locator('.loadout-character').count(),5);
 });
 await checked('direct Start Session flow without mandatory tutorial',async()=>{
  await chooseLoadout();
  await finishTutorial();
  // The tutorial stays available on demand and can be skipped back to pause.
  await page.keyboard.press('Escape');
  await page.locator('body[data-screen="pause"]').waitFor();
  await page.locator('[data-action="tutorial"]').click();
  await page.locator('body[data-screen="tutorial"]').waitFor();
  assert.equal(await page.locator('[data-action="skipTutorial"]').count(),1);
  await page.locator('[data-action="skipTutorial"]').click();
  await page.locator('body[data-screen="pause"]').waitFor();
  await page.locator('[data-action="resume"]').click();
  await page.locator('body[data-screen="playing"]').waitFor();
  // The virtual GitHub runner has no hardware GPU: exercise live gameplay at
  // a practical software-raster viewport; menu layout was checked at 1440x900.
  // Keep the >3-frame liveness assertion unchanged. Do not use these FPS
  // samples as end-user hardware performance results.
  await page.setViewportSize({width:800,height:450});
  await stats('timed-1');
  await page.screenshot({path:join(out,'timed-session.png'),fullPage:true});
 });
 await checked('camera modes, manual pause, focus loss and resume',async()=>{
  for(const mode of ['classic','fixed','follow']){
   await page.evaluate(m=>window.streetSkate.setCameraMode(m),mode);
   assert.equal((await page.locator('#camera-label').textContent()).trim(),mode.toUpperCase());
  }
  await page.keyboard.press('Escape');
  await page.locator('body[data-screen="pause"]').waitFor();
  await page.locator('[data-action="resume"]').click();
  await page.locator('body[data-screen="playing"]').waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(()=>document.querySelector('#app')?.dataset.paused==='true');
  // GameShell owns the pause menu. Its legacy #pause-overlay is intentionally
  // hidden by game-shell.css, so require the *actual* visible pause controls.
  await page.locator('body[data-screen="pause"]').waitFor();
  assert.equal(await page.locator('#game-shell').isVisible(),true);
  assert.equal(await page.locator('[data-action="resume"]').isVisible(),true);
  await page.evaluate(()=>window.streetSkate.setPaused(false));
  await page.waitForFunction(()=>document.querySelector('#app')?.dataset.paused==='false');
 });
 await checked('repeat run, practice mode and restart',async()=>{
  await page.keyboard.press('Escape');
  await page.locator('body[data-screen="pause"]').waitFor();
  await page.locator('[data-action="title"]').click();
  await page.locator('body[data-screen="title"]').waitFor();
  await page.locator('[data-action="options"]').click();
  await page.locator('[data-action="practice"]').click();
  await page.locator('body[data-screen="select"]').waitFor();
  await chooseLoadout();
  await finishTutorial();
  await stats('practice-2');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="restart"]').click();
  await page.locator('body[data-screen="playing"]').waitFor();
  await stats('practice-restart-3');
  await page.screenshot({path:join(out,'practice-restart.png'),fullPage:true});
 });
 await checked('all four stock GLB riders load and bind without stale resources',async()=>{
  const avatars=[
   ['heretic','/assets/rider/The_Heretic.glb'],
   ['adolescent','/assets/rider/The_AdolescentUR.glb'],
   ['anchor','/assets/rider/The_Anchor.glb'],
   ['tuxr','/assets/rider/TuxR.glb'],
  ];
  const metrics=[];
  for(const [name,url] of avatars){
   const detail=await page.evaluate(async asset=>{
    const skater=window.streetSkate.skater;
    const rider=await skater.setRiderModel(asset);
    let meshCount=0;
    rider.model.traverse(node=>{if(node.isMesh)meshCount++;});
    const required=['pelvis','head','upperarm_l','upperarm_r','thigh_l','thigh_r','foot_l','foot_r'];
    return {meshCount,boneCount:rider.rigAudit?.boneCount??0,
     requiredRig:required.every(b=>!!rider.bones?.[b]),
     attached:rider.root.parent===skater.visual,
     geometries:window.streetSkate.renderer.info.memory.geometries,
     textures:window.streetSkate.renderer.info.memory.textures};
   },url);
   assert.ok(detail.meshCount>0,name+' has no visible model meshes');
   assert.ok(detail.boneCount>0&&detail.requiredRig,name+' has an invalid rig');
   assert.equal(detail.attached,true,name+' avatar not attached to board rig');
   metrics.push({name,...detail});
   await page.screenshot({path:join(out,'rider-'+name+'.png'),fullPage:true});
  }
  console.log('AGENT10 FOUR RIDERS '+JSON.stringify(metrics));
 });
 await checked('90-second results screen, score and return to title',async()=>{
  await page.keyboard.press('Escape');
  await page.locator('body[data-screen="pause"]').waitFor();
  await page.locator('[data-action="title"]').click();
  await page.locator('body[data-screen="title"]').waitFor();
  await page.locator('[data-action="start"]').click();
  await page.locator('body[data-screen="select"]').waitFor();
  await chooseLoadout();
  await finishTutorial();
  // Exercise real in-game countdown; no timer bypass or fake result screen.
  await page.waitForFunction(()=>document.body.dataset.screen==='results',null,{timeout:160000});
  assert.match(await page.locator('.result-score').textContent(),/POINTS BANKED/);
  await page.screenshot({path:join(out,'timed-results.png'),fullPage:true});
  await page.locator('[data-action="title"]').click();
  await page.locator('body[data-screen="title"]').waitFor();
 });
 const rejections=await page.evaluate(()=>window.__agent10Unhandled||[]);
 assert.deepEqual(report.pageErrors,[],'Uncaught runtime page errors');
 assert.deepEqual(rejections,[],'Unhandled Promise rejections');
 report.result='passed';
 console.log('AGENT10 PRODUCTION QA PASS: '+report.checks.length+' scenarios');
}catch(error){
 report.result='failed';report.error=String(error.stack||error);
 console.error('AGENT10 PRODUCTION QA FAILED',report.error);
 try{await page.screenshot({path:join(out,'failure.png'),fullPage:true,timeout:5000});}catch{}
 process.exitCode=1;
}finally{
 report.finished=new Date().toISOString();
 await writeFile(join(out,'telemetry.json'),JSON.stringify(report,null,2));
 await browser.close();
}
