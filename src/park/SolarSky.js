import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';


/**
 * Atmospheric sky art is separate from HDRI material lighting.
 * Generated once (not per frame), with deterministic soft cloud clusters.
 * If Canvas 2D is unavailable, the original HDR panorama remains the fallback.
 */
function createCloudBackdrop(fallback) {
  if (typeof document === 'undefined') return fallback;
  const canvas=document.createElement('canvas');
  canvas.width=2048; canvas.height=1024;
  const ctx=canvas.getContext('2d');
  if (!ctx) return fallback;
  const g=ctx.createLinearGradient(0,0,0,1024);
  for (const [s,color] of [[0,'#183c79'],[0.28,'#4883c5'],[0.47,'#9db9e5'],
    [0.55,'#efbcab'],[0.68,'#eb9d92'],[0.94,'#5e7aaf'],[1,'#23395f']]) g.addColorStop(s,color);
  ctx.fillStyle=g;ctx.fillRect(0,0,2048,1024);
  let seed=110319;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Individual cloud banks contain multiple soft lobes rather than featureless gray fog.
  for(let bank=0;bank<100;bank++){
    const x=random()*2048,y=125+random()*500;
    const width=28+random()*150,height=9+random()*38;
    const lobes=3+Math.floor(random()*6);
    for(let l=0;l<lobes;l++){
      const dx=(random()-.5)*width*1.5,dy=(random()-.5)*height*.7;
      ctx.save();ctx.translate(x+dx,y+dy);ctx.scale(width*(.5+random()*.5),height*(.6+random()));
      const haze=ctx.createRadialGradient(0,0,0,0,0,1);
      const alpha=y>435?.19:.12;
      haze.addColorStop(0,'rgba(255,247,245,'+alpha+')');
      haze.addColorStop(.55,'rgba(246,239,250,'+(alpha*.7)+')');
      haze.addColorStop(1,'rgba(224,231,251,0)');
      ctx.fillStyle=haze;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.mapping=THREE.EquirectangularReflectionMapping;
  return texture;
}

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
    return { background: createCloudBackdrop(background), environment };
  } catch (error) {
    background.dispose();
    throw error;
  } finally {
    generator.dispose();
  }
}
