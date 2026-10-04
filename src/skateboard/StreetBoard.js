import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class StreetBoard {
  constructor(url) {
    this.url = url;
    this.root = new THREE.Group();
    this.root.name = 'street-board';
    this.model = null;
    this.travel = 0;
  }

  async load() {
    try {
      const gltf = await new GLTFLoader().loadAsync(this.url);
      this.model = gltf.scene;
    } catch (error) {
      console.warn('Skateboard GLB unavailable; using procedural test board.', error);
      this.model = this._buildFallback();
    }
    this.model.scale.setScalar(0.186);
    this.model.rotation.y = Math.PI * 0.5;
    this.model.traverse((object) => {
      if (!object.isMesh) return;
      if (!object.geometry.attributes.normal) object.geometry.computeVertexNormals();
      object.castShadow = true;
      object.receiveShadow = true;
    });
    this.root.add(this.model);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    this.model.position.y -= box.min.y;
    this.root.userData.source = 'CyberArtsBR/Skate skateboard.glb';
    return this;
  }

  _buildFallback() {
    const root = new THREE.Group();
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x21252b, roughness: 0.62 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xa7adb0, roughness: 0.35, metalness: 0.8 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x72dbff, roughness: 0.58 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.25,.16,1.15), deckMat); deck.position.y=.43; root.add(deck);
    for (const x of [-1.25,1.25]) {
      const truck = new THREE.Mesh(new THREE.BoxGeometry(.18,.18,.95), metal); truck.position.set(x,.27,0); root.add(truck);
      for (const z of [-.58,.58]) { const w=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.13,12),wheelMat); w.rotation.x=Math.PI/2; w.position.set(x,.12,z); root.add(w); }
    }
    root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    return root;
  }

  update({ distance = 0, airborne = false, flip = 0, grab = false }) {
    this.travel = distance;
    this.root.position.y = airborne ? 0.02 : 0;
    this.root.rotation.z = flip * Math.PI * 2;
    this.root.rotation.x = grab ? -0.16 : 0;
  }
}
