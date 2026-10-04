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
    const gltf = await new GLTFLoader().loadAsync(this.url);
    this.model = gltf.scene;
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

  update({ distance = 0, airborne = false, flip = 0, grab = false }) {
    this.travel = distance;
    this.root.position.y = airborne ? 0.02 : 0;
    this.root.rotation.z = flip * Math.PI * 2;
    this.root.rotation.x = grab ? -0.16 : 0;
  }
}
