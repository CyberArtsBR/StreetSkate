import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PRODUCTION_BOARD_CONTACT_RIG } from '../game/SkateboardContactRig.js';

const clamp = THREE.MathUtils.clamp;

export class StreetBoard {
  constructor(url) {
    this.url = url;
    this.root = new THREE.Group();
    this.root.name = 'street-board';
    this._rotation = new THREE.Vector3();
    this.contactRig = { ...PRODUCTION_BOARD_CONTACT_RIG };
  }

  deriveContactRig() {
    this.model.updateMatrixWorld(true);
    const wheelMeshes = [];
    let deckMesh = null;
    this.model.traverse(object => {
      if (!object.isMesh) return;
      if (/^Board1/i.test(object.name)) deckMesh ||= object;
      if (/pPipe(?:9|13)/i.test(object.name)) wheelMeshes.push(object);
    });
    if (!deckMesh || wheelMeshes.length < 4) return { ...PRODUCTION_BOARD_CONTACT_RIG };

    const deckBox = new THREE.Box3().setFromObject(deckMesh);
    const deckSize = deckBox.getSize(new THREE.Vector3());
    const deckCenter = deckBox.getCenter(new THREE.Vector3());
    const wheels = wheelMeshes.map(mesh => {
      const box = new THREE.Box3().setFromObject(mesh);
      return { box, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
    }).sort((a, b) => b.size.y - a.size.y).slice(0, 4);

    const front = wheels.filter(w => w.center.z < deckCenter.z);
    const rear = wheels.filter(w => w.center.z >= deckCenter.z);
    const left = wheels.filter(w => w.center.x < deckCenter.x);
    const right = wheels.filter(w => w.center.x >= deckCenter.x);
    if (!front.length || !rear.length || !left.length || !right.length) return { ...PRODUCTION_BOARD_CONTACT_RIG };
    const average = (items, read) => items.reduce((sum, item) => sum + read(item), 0) / items.length;
    const wheelRadius = average(wheels, w => (w.size.y + w.size.z) * 0.25);
    const yOffset = this.deckHeight;
    const noseInset = Math.min(0.018, deckSize.z * 0.03);

    return {
      source: this.url,
      deckLength: deckSize.z,
      deckWidth: deckSize.x,
      center: [deckCenter.x, deckCenter.y + yOffset, deckCenter.z],
      frontTruckZ: average(front, w => w.center.z),
      rearTruckZ: average(rear, w => w.center.z),
      leftWheelX: average(left, w => w.center.x),
      rightWheelX: average(right, w => w.center.x),
      wheelRadius,
      wheelContactY: average(wheels, w => w.box.min.y + yOffset),
      deckUndersideY: deckBox.min.y + yOffset,
      deckTopY: deckBox.max.y + yOffset,
      noseZ: deckBox.min.z + noseInset,
      tailZ: deckBox.max.z - noseInset,
    };
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
    this.model.updateMatrixWorld(true);
    this.contactRig = this.deriveContactRig();
    this.root.add(this.model);
    this.model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.root.userData.source = 'CyberArtsBR/Skate skateboard.glb';
    this.root.userData.contactRig = this.contactRig;
    return this;
  }

  pointWorld(x, y, z, target = new THREE.Vector3()) {
    target.set(x, y, z);
    return this.root.localToWorld(target);
  }

  update({ airborne = false, flipState = null, grabState = null, manual = null, manualBalance = 0,
    grind = null, grindBalance = 0, wallRide = null, bail = false, bailProgress = 0,
    stance = 1, flatland = null, time = 0 }) {
    const grindPose = grind?.profile?.presentation;
    this.root.position.set(0,
      this.deckHeight + (airborne ? 0.025 : 0) + (grindPose?.visualLift || 0), 0);
    let x = grabState ? -0.045 : 0;
    let y = 0;
    let z = 0;

    if (flipState) {
      const p = clamp(flipState.progress, 0, 1);
      x += p * Math.PI * 2 * (flipState.pitch || 0);
      y += p * Math.PI * 2 * (flipState.yaw || 0);
      z += p * Math.PI * 2 * (flipState.roll || 0);
    }
    if (manual === 'manual') x -= 0.16 + clamp(manualBalance, -1, 1) * 0.035;
    if (manual === 'noseManual') x += 0.16 - clamp(manualBalance, -1, 1) * 0.035;
    if (grindPose) {
      x += grindPose.pitch || 0;
      y += grindPose.yaw || 0;
      z += grindPose.roll || 0;
      z += clamp(grindBalance, -1, 1) * 0.04;
    }
    if (wallRide) z += 0.12;

    if (flatland) {
      const wave = Math.sin(time * 7) * 0.08;
      switch (flatland) {
        case 'Pogo': x -= 0.48; break;
        case 'Wrap Around': y += wave * 2.4; break;
        case 'Handstand': x += 0.11; break;
        case 'Casper': z += Math.PI; x -= 0.12; break;
        case 'Truck Stand': y += Math.PI * 0.5; x -= 0.2; break;
        case 'Anti Casper': z += Math.PI; x += 0.12; break;
        case 'To Rail': y -= Math.PI * 0.5; break;
        case 'Switch Foot Pogo': x += 0.48; break;
        case 'One Foot Manual': x += stance > 0 ? -0.18 : 0.18; break;
        default: break;
      }
    }

    if (bail) {
      const p = clamp(bailProgress, 0, 1);
      this.root.position.x += (stance < 0 ? -1 : 1) * (0.08 + p * 0.28);
      this.root.position.y += 0.05 + p * 0.2;
      this.root.position.z += p * 0.12;
      x += p * 1.7;
      y += p * 1.1;
      z += p * 2.2;
    }

    this._rotation.set(x, y, z);
    this.root.rotation.copy(this._rotation);
  }
}
