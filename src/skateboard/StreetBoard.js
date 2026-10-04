import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class StreetBoard {
  constructor(url) {
    this.url = url;
    this.root = new THREE.Group();
    this.root.name = 'street-board';
  }

  async load() {
    this.model = (await new GLTFLoader().loadAsync(this.url)).scene;
    const original = new THREE.Box3().setFromObject(this.model);
    this.model.scale.setScalar(1.05 / original.getSize(new THREE.Vector3()).x);
    this.model.rotation.y = Math.PI / 2;
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(new THREE.Vector3());
    this.deckHeight = -original.min.y * this.model.scale.x;
    this.model.position.set(-center.x, -box.min.y - this.deckHeight, -center.z);
    this.root.add(this.model);
    this.model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.root.userData.source = 'CyberArtsBR/Skate skateboard.glb';
    return this;
  }

  update({ airborne = false, flip = 0, grab = false }) {
    // Rotate around the deck, so a kickflip does not orbit the wheels.
    this.root.position.y = this.deckHeight + (airborne ? 0.025 : 0);
    this.root.rotation.set(grab ? -0.12 : 0, 0, flip * Math.PI * 2);
  }
}
