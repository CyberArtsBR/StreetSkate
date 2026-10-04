import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const RIG = Object.freeze({
  pelvis: 'pelvis', spine1: 'spine_01', spine2: 'spine_02', spine3: 'spine_03',
  head: 'head', leftThigh: 'thigh_l', rightThigh: 'thigh_r', leftCalf: 'calf_l',
  rightCalf: 'calf_r', leftFoot: 'foot_l', rightFoot: 'foot_r',
  leftUpperArm: 'upperarm_l', rightUpperArm: 'upperarm_r',
  leftLowerArm: 'lowerarm_l', rightLowerArm: 'lowerarm_r',
});

export class UnrealRider {
  constructor(url) {
    this.url = url;
    this.root = new THREE.Group();
    this.root.name = 'street-rider';
    this.model = null;
    this.bones = {};
    this.rest = new Map();
  }

  async load() {
    try {
      const gltf = await new GLTFLoader().loadAsync(this.url);
      this.model = gltf.scene;
    } catch (error) {
      console.warn('Rider GLB unavailable; using procedural test rider.', error);
      this.model = this._buildFallback();
    }
    this.model.name = 'TheanchoURi';
    const referenceSphere = this.model.getObjectByName('Icosphere');
    referenceSphere?.removeFromParent();
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const height = box.max.y - box.min.y;
    const scale = 1.82 / Math.max(height, 0.01);
    this.model.scale.setScalar(scale);
    this.model.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(this.model);
    this.model.position.y -= scaled.min.y;
    this.model.traverse((object) => {
      if (object.isMesh) {
        if (!object.geometry.attributes.normal) object.geometry.computeVertexNormals();
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
      if (object.isBone) this.rest.set(object, object.quaternion.clone());
    });
    for (const [slot, name] of Object.entries(RIG)) this.bones[slot] = this.model.getObjectByName(name);
    this.root.add(this.model);
    this.root.userData.rig = 'Unreal Engine-style 61-bone skeleton';
    this.root.userData.sourceHeight = height;
    this.root.userData.runtimeHeight = 1.82;
    return this;
  }

  _buildFallback() {
    const root = new THREE.Group();
    root.name = 'TheanchoURi-fallback';
    const skin = new THREE.MeshStandardMaterial({ color: 0xc69a78, roughness: 0.72 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x242b36, roughness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x70d7ff, roughness: 0.55, metalness: 0.15 });
    const add = (geometry, material, position, rotation=[0,0,0]) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.castShadow=true; root.add(mesh); return mesh;
    };
    add(new THREE.CapsuleGeometry(.24,.62,5,10), cloth, [0,1.08,0]);
    add(new THREE.SphereGeometry(.24,16,12), skin, [0,1.67,0]);
    add(new THREE.CapsuleGeometry(.10,.52,4,8), cloth, [-.18,.53,.02],[0,0,.08]);
    add(new THREE.CapsuleGeometry(.10,.52,4,8), cloth, [.18,.53,-.02],[0,0,-.08]);
    add(new THREE.BoxGeometry(.18,.09,.52), accent, [-.18,.13,.04]);
    add(new THREE.BoxGeometry(.18,.09,.52), accent, [.18,.13,-.04]);
    add(new THREE.CapsuleGeometry(.075,.48,4,8), skin, [-.38,1.10,0],[0,0,.5]);
    add(new THREE.CapsuleGeometry(.075,.48,4,8), skin, [.38,1.10,0],[0,0,-.5]);
    root.userData.fallback = true;
    return root;
  }

  _rotate(slot, x = 0, y = 0, z = 0) {
    const bone = this.bones[slot];
    if (!bone) return;
    bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')));
  }

  update({ speedRatio = 0, crouch = 0, airborne = false, steer = 0, grab = false, time = 0 }) {
    for (const [bone, rest] of this.rest) bone.quaternion.copy(rest);
    const compression = THREE.MathUtils.clamp(crouch + (airborne ? 0.28 : 0), 0, 1);
    const bob = airborne ? 0 : Math.sin(time * (5 + speedRatio * 7)) * 0.025 * speedRatio;
    this._rotate('pelvis', -0.12 - compression * 0.22, steer * 0.05, bob);
    this._rotate('spine1', 0.08 + compression * 0.10, -0.12, -steer * 0.08);
    this._rotate('spine2', 0.05, -0.14, -steer * 0.07);
    this._rotate('spine3', 0.02, -0.10, -steer * 0.05);
    this._rotate('head', 0, 0.18, steer * 0.05);
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? -1 : 1;
      this._rotate(`${side}Thigh`, -0.30 - compression * 0.30, sign * 0.05, sign * 0.11);
      this._rotate(`${side}Calf`, 0.55 + compression * 0.42, 0, 0);
      this._rotate(`${side}Foot`, -0.19 - compression * 0.08, sign * 0.04, 0);
      this._rotate(`${side}UpperArm`, grab ? -0.9 : -0.12, -0.1, sign * (0.74 + speedRatio * 0.16));
      this._rotate(`${side}LowerArm`, grab ? -0.75 : -0.26, 0, sign * 0.12);
    }
    this.root.position.y = 0.13 - compression * 0.10 + bob;
  }
}
