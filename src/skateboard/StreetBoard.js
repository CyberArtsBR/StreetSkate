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

  update({ airborne = false, flipState = null, grab = false, manual = null, manualBalance = 0, grind = null, wallRide = false }) {
    this.root.position.y = this.deckHeight + (airborne ? 0.025 : 0) + (grind?.profile?.presentation?.visualLift || 0);
    let x = grab ? -0.12 : 0;
    let y = 0;
    let z = 0;
    if (flipState) {
      const p = THREE.MathUtils.clamp(flipState.progress, 0, 1);
      x += p * Math.PI * 2 * (flipState.pitch || 0);
      y += p * Math.PI * 2 * (flipState.yaw || 0);
      z += p * Math.PI * 2 * (flipState.roll || 0);
    }
    if (manual === 'manual') x -= 0.16 + THREE.MathUtils.clamp(manualBalance, -1, 1) * 0.035;
    if (manual === 'noseManual') x += 0.16 - THREE.MathUtils.clamp(manualBalance, -1, 1) * 0.035;
    if (grind?.profile?.presentation) {
      const presentation = grind.profile.presentation;
      x += presentation.pitch || 0;
      y += presentation.yaw || 0;
      z += presentation.roll || 0;
    }
    if (wallRide) z += 0.22;
    this.root.rotation.set(x, y, z);
  }
}
