import * as THREE from 'three';

// Lightweight 1990s skate-magazine bubble lettering, attached ONLY to
// Grand Warehouse visuals, not its collision root. All materials are owned
// by the park and disposed during location switching.
const PALETTES = [
  ['#ffdc43','#ff477e','#5513ae'],
  ['#69fff0','#2879fe','#ff39c6'],
  ['#ff8c45','#e942ff','#4223ae'],
  ['#b5ff4a','#16ccbd','#8b20c0'],
];
const TAGS = ['GRAND','SKATE','REWIND','AIR','RADICAL','VERT','FRESH','STREET','FLIP','90S','SESSION','FLOW'];
function graffitiTexture(word, colors, seed) {
  const canvas = document.createElement('canvas');
  canvas.width=1024; canvas.height=320;
  const ctx=canvas.getContext('2d');
  const rng=(()=>{let x=seed;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};})();
  ctx.translate(512,169);
  ctx.rotate((rng()-.5)*.12);
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.lineJoin='round';ctx.font='italic 900 150px Impact, Arial Black, sans-serif';
  ctx.strokeStyle='#130d31';ctx.lineWidth=36;ctx.strokeText(word,0,0,890);
  ctx.strokeStyle=colors[2];ctx.lineWidth=25;ctx.strokeText(word,-4,-8,890);
  ctx.strokeStyle='#fff9d7';ctx.lineWidth=10;ctx.strokeText(word,-7,-11,890);
  const fill=ctx.createLinearGradient(0,-85,0,70);
  fill.addColorStop(0,colors[0]);fill.addColorStop(.5,colors[1]);fill.addColorStop(1,colors[2]);
  ctx.fillStyle=fill;ctx.fillText(word,-7,-11,890);
  ctx.save();ctx.globalAlpha=.9;
  for(let i=0;i<85;i++){
    let x=(rng()-.5)*970,y=(rng()-.5)*265,r=1+rng()*7;
    ctx.fillStyle=i%3?colors[1]:colors[0];
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=4;
  return texture;
}
export function createGrandWarehouseGraffiti() {
  const root=new THREE.Group();
  root.name='Grand Warehouse / 90s graffiti / visual-only';
  if(typeof document==='undefined')return root;
  const positions=[
    [-74.66,4.65,-38,Math.PI/2],[-74.66,4.65,0,Math.PI/2],[-74.66,4.65,38,Math.PI/2],
    [74.66,4.65,-38,-Math.PI/2],[74.66,4.65,0,-Math.PI/2],[74.66,4.65,38,-Math.PI/2],
    [-46,4.65,-54.66,0],[0,4.65,-54.66,0],[46,4.65,-54.66,0],
    [-46,4.65,54.66,Math.PI],[0,4.65,54.66,Math.PI],[46,4.65,54.66,Math.PI],
  ];
  const geo=new THREE.PlaneGeometry(17,3.4);
  positions.forEach(([x,y,z,angle],i)=>{
    const map=graffitiTexture(TAGS[i],PALETTES[i%4],i*3107+49);
    const material=new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
    const mesh=new THREE.Mesh(geo,material);
    mesh.name=`Grand Warehouse / VISUAL_ONLY graffiti ${i+1}`;
    mesh.position.set(x,y,z);
    mesh.rotation.y=angle;
    mesh.userData.castShadow=false;
    mesh.renderOrder=3;
    root.add(mesh);
  });
  return root;
}
