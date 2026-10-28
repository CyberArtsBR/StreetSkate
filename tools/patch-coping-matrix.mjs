import {mkdir,writeFile} from 'node:fs/promises';
import {launchAuditBrowser} from './quality-browser-runtime.mjs';
const browser=await launchAuditBrowser(),page=await browser.newPage({viewport:{width:1280,height:720}});
const output='artifacts/local-update/coping-matrix';await mkdir(output,{recursive:true});
const report=[];
try {
  await page.goto('http://127.0.0.1:5182/');
  await page.waitForFunction(()=>window.streetSkate?.ready,null,{timeout:90000});
  const maps=process.env.COPING_MAP ? [process.env.COPING_MAP] : ['grand-warehouse','orbit','skate-paradise'];
  for(const map of maps){
    await page.evaluate(async id=>{await window.streetSkate.selectLocation(id);window.streetSkate.setPaused(true);},map);
    const result=await page.evaluate(()=>{
      const game=window.streetSkate,s=game.skater,rails=game.manifest.rails.filter(r=>r.transition?.supportsVert);
      const cases=[],skipped=[];
      for(const rail of rails){
        const midpoint=Math.floor((rail.points.length-1)/2);
        const a=s.position.clone().fromArray(rail.points[midpoint]);
        const b=s.position.clone().fromArray(rail.points[midpoint+1]);
        const lip=a.clone().add(b).multiplyScalar(.5);
        const tangent=b.clone().sub(a).setY(0).normalize();
        if(tangent.lengthSq()<.1){skipped.push(rail.name);continue;}
        let found=false;
        for(const side of [-1,1]){
          const inward=tangent.clone().set(-tangent.z,0,tangent.x).multiplyScalar(side);
          let hit=null;
          for(const distance of [.35,1,2,3]){
            const p=lip.clone().addScaledVector(inward,distance);p.y=lip.y+1;
            const candidate=s.surface.ground(p,1,10);
            if(candidate&&candidate.normal.y<.98&&candidate.normal.dot(inward)>.1){hit=candidate;break;}
          }
          if(!hit)continue;
          found=true;
          for(const speed of [8,17])for(const mode of ['neutral','flip','grind','brake','exit']){
            const heading=Math.atan2(inward.x,inward.z);
            s.reset(hit.point.clone().addScaledVector(hit.normal,.12),heading);
            s.normal.copy(hit.normal);s.groundDirection();s.velocity.copy(s.forward).multiplyScalar(speed);
            let airborne=false,landed=false,bailed=false,stuck=0,worst=0,trick=false;
            for(let i=0;i<720;i++){
              const doFlip=mode==='flip'&&!trick&&!s.grounded&&s.velocity.y>0;
              trick ||= doFlip;
              s.update(1/120,{flipPressed:doFlip,grindHeld:mode==='grind',brake:mode==='brake',vertExit:mode==='exit'},i/120);
              airborne ||= !!s.transitionAir;landed ||= airborne&&s.grounded;bailed ||= airborne&&s.bailTime>0;
              stuck=airborne&&!s.grounded&&!s.bailTime&&s.position.y>lip.y-.6&&s.velocity.length()<.5?stuck+1/120:0;
              worst=Math.max(worst,stuck);
            }
            cases.push({rail:rail.name,side,speed,mode,airborne,landed,bailed,maxStall:worst,finite:s.position.toArray().every(Number.isFinite)});
          }
        }
        if(!found)skipped.push(rail.name);
      }
      return {map:game.currentLocation,rails:rails.map(r=>r.name),cases,skipped};
    },null,{timeout:180000});
    report.push(result);await writeFile(`${output}/${process.env.COPING_MAP||'report'}.json`,JSON.stringify(report,null,2));
    console.log(`${map}: ${result.cases.length} cases, ${result.skipped.length} rails without a valid sampled approach`);
  }
}finally{await browser.close();}
