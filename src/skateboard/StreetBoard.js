import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PRODUCTION_BOARD_CONTACT_RIG } from '../game/SkateboardContactRig.js';
import { flipTurns, popMotion, GRAB_POSES } from '../character/TrickMotion.js';
import { SKATEBOARD_FINISHES } from './BoardFinishes.js';

const clamp = THREE.MathUtils.clamp;

export class StreetBoard {
  constructor(url) {
    this.url = url;
    this.root = new THREE.Group();
    this.root.name = 'street-board';
    this._rotation = new THREE.Euler();
    this._poseQuaternion = new THREE.Quaternion();
    this.poseReady = false;
    // Persistent equivalent board yaw prevents a completed shove-it from unwinding.
    this._yawHold = 0;
    this._wasFlipping = false;
    this._lastFlipYaw = 0;
    this._lastFlipProgress = 0;
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
    // 20% larger deck with fully remeasured wheel/support geometry.
    this.model.scale.setScalar(1.26 / original.getSize(new THREE.Vector3()).x);
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
    let finish = 0;
    try { finish = Number(localStorage.getItem('streetskate.boardFinish')) || 0; } catch {}
    this.setFinish(finish);
    return this;
  }

  setFinish(index = 0) {
    if (!Number.isFinite(index)) index = 0;
    this.finishIndex = ((Math.trunc(index) % SKATEBOARD_FINISHES.length) + SKATEBOARD_FINISHES.length) % SKATEBOARD_FINISHES.length;
    const finish = SKATEBOARD_FINISHES[this.finishIndex];
    if (!this.model) return;
    this.root.updateWorldMatrix(true, true);
    const inverse = this.root.matrixWorld.clone().invert();
    this.model.traverse(mesh => {
      if (!mesh.isMesh || !/^Board1/i.test(mesh.name)) return;
      if (!mesh.userData.gradientOwned) {
        mesh.geometry = mesh.geometry.clone();
        const own = material => { const m = material.clone(); m.map = null; m.vertexColors = true; m.color.set('#ffffff'); m.roughness = 0.46; m.emissive.set('#18212b'); m.emissiveIntensity = 0.16; return m; };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
        mesh.userData.gradientOwned = true;
      }
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);
      const positions = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
      const colors = new Float32Array(positions.count * 3), p = new THREE.Vector3(), n = new THREE.Vector3();
      const bounds = new THREE.Box3();
      for (let i = 0; i < positions.count; i++) bounds.expandByPoint(p.fromBufferAttribute(positions, i).applyMatrix4(transform));
      const stops = finish.stops.map(color => new THREE.Color(color));
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(transform);
        n.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
        const t = clamp((p.z - bounds.min.z) / Math.max(0.001, bounds.max.z - bounds.min.z), 0, 1);
        const color = t < 0.5 ? stops[0].clone().lerp(stops[1], t * 2) : stops[1].clone().lerp(stops[2], (t - 0.5) * 2);
        // Retain dark grip in the center, with a visible gradient perimeter.
        if (n.y > 0.6 && Math.abs(p.x) < (bounds.max.x - bounds.min.x) * 0.34) color.multiplyScalar(0.18);
        color.toArray(colors, i * 3);
      }
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    });
    try { localStorage.setItem('streetskate.boardFinish', String(this.finishIndex)); } catch {}
  }

  pointWorld(x, y, z, target = new THREE.Vector3()) {
    target.set(x, y, z);
    return this.root.localToWorld(target);
  }

  resetPresentation() {
    this.poseReady = false;
    this._yawHold = 0;
    this._wasFlipping = false;
    this._lastFlipYaw = 0;
    this._lastFlipProgress = 0;
  }

  update({ presentation = null, airborne = false, flipState = null, grabState = null, grabWeight = 0, manual = null, manualBalance = 0,
    grind = null, grindBalance = 0, wallRide = null, bail = false, bailProgress = 0,
    stance = 1, flatland = null, time = 0, dt = 1 / 60 }) {
    const grindPose = grind?.profile?.presentation;
    this.root.position.set(0,
      this.deckHeight + (airborne ? 0.025 : 0) + (grindPose?.visualLift || 0), 0);
    const grabPose = GRAB_POSES[grabState?.name] || [0, 0, 0];
    if (!flipState && this._wasFlipping) {
      // 180/360 yaw is physically equivalent for a symmetrical deck; keep the
      // attained visual orientation instead of visibly spinning backwards.
      if (!bail && this._lastFlipProgress >= 0.90) {
        const halfTurns = Math.round(this._lastFlipYaw / Math.PI);
        this._yawHold = THREE.MathUtils.euclideanModulo(this._yawHold + halfTurns * Math.PI, Math.PI * 2);
      }
      this._wasFlipping = false;
    }
    let x = grabPose[0] * grabWeight;
    let y = grabPose[1] * grabWeight + this._yawHold;
    let z = grabPose[2] * grabWeight;

    if (flipState) {
      const turns = flipTurns(flipState);
      this._wasFlipping = true;
      this._lastFlipYaw = turns.yaw * Math.PI * 2;
      this._lastFlipProgress = flipState.progress ?? 0;
      x += turns.pitch * Math.PI * 2;
      y += turns.yaw * Math.PI * 2;
      z += turns.roll * Math.PI * 2;
    } else if (airborne && !grabState && !bail) {
      x += popMotion(presentation?.popProgress ?? 1);
    }
    // Readable nose/tail lift while respecting short-deck ground clearance.
    if (manual === 'manual') x -= 0.225 + clamp(manualBalance, -1, 1) * 0.018;
    if (manual === 'noseManual') x += 0.225 - clamp(manualBalance, -1, 1) * 0.018;
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
    this._poseQuaternion.setFromEuler(this._rotation);
    // Flips follow their complete rotation trajectory exactly. Ordinary pose
    // changes crossfade so manuals/grinds don't snap to a different deck angle.
    if (flipState || bail || !this.poseReady) this.root.quaternion.copy(this._poseQuaternion);
    else this.root.quaternion.slerp(this._poseQuaternion, 1 - Math.exp(-22 * Math.max(0, dt)));
    this.poseReady = true;
  }
}
