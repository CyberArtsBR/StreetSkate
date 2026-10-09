import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const cache = new Map();
let renderer = null;
// Render actual GLB characters on a shared offscreen canvas, avoiding external portrait dependencies.
export async function characterPortrait(url) {
  if (cache.has(url)) return cache.get(url);
  const promise = (async () => {
    const model = (await new GLTFLoader().loadAsync(url)).scene;
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power',preserveDrawingBuffer:true});
      renderer.setPixelRatio(1);renderer.setSize(220,270);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight('#eff5ff','#4d3146',2.15);scene.add(hemi);
    const key = new THREE.DirectionalLight('#ffe8ce',3);key.position.set(-3,7,5);scene.add(key);
    const bounds = new THREE.Box3().setFromObject(model);
    const dims = bounds.getSize(new THREE.Vector3());
    if (!(dims.y>0.001) || !Number.isFinite(dims.y)) throw new Error('Invalid GLB bounds');
    const normalized = new THREE.Group();normalized.add(model);scene.add(normalized);
    model.scale.setScalar(2.0/dims.y);
    const scaledBounds = new THREE.Box3().setFromObject(model);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    model.position.sub(center);model.rotation.y=Math.PI/5;
    const camera=new THREE.PerspectiveCamera(37,220/270,0.05,40);
    camera.position.set(0.0,0.15,4.0);camera.lookAt(0,0.05,0);
    renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);
    const image=renderer.domElement.toDataURL('image/png');
    // The preview scene is disposable. Main-world avatars load their own GLBs.
    model.traverse(item=>{if(item.isMesh){item.geometry?.dispose();for(const mat of Array.isArray(item.material)?item.material:[item.material]){mat?.dispose();}}});
    return image;
  })();
  cache.set(url,promise);
  try {return await promise;}catch(error){cache.delete(url);throw error;}
}
