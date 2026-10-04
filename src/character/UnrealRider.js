import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Aim using world directions; Unreal bone axes are not anatomical Euler axes.
function aim(bone, child, target) {
  bone.updateWorldMatrix(true, true);
  const origin = bone.getWorldPosition(V());
  const current = child.getWorldPosition(V()).sub(origin).normalize();
  const desired = target.clone().sub(origin).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(current, desired)
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}

function solveLimb(upper, lower, end, target, pole) {
  const hip = upper.getWorldPosition(V());
  const knee = lower.getWorldPosition(V());
  const foot = end.getWorldPosition(V());
  const a = hip.distanceTo(knee), b = knee.distanceTo(foot);
  const axis = target.clone().sub(hip).normalize();
  const distance = THREE.MathUtils.clamp(hip.distanceTo(target), Math.abs(a - b) + 0.001, a + b - 0.001);
  const along = (a * a + distance * distance - b * b) / (2 * distance);
  const perpendicular = pole.clone().sub(hip).projectOnPlane(axis).normalize();
  const desiredKnee = hip.clone().addScaledVector(axis, along)
    .addScaledVector(perpendicular, Math.sqrt(Math.max(0, a * a - along * along)));
  aim(upper, lower, desiredKnee);
  aim(lower, end, target);
}

export class UnrealRider {
  constructor(url) {
    this.url = url;
    this.root = new THREE.Group();
    this.root.name = 'street-rider';
    this.rest = new Map();
    this.feet = {};
    this.deckHeight = 0.12;
  }

  async load() {
    this.model = (await new GLTFLoader().loadAsync(this.url)).scene;
    const box = new THREE.Box3().setFromObject(this.model);
    this.model.scale.setScalar(1.82 / box.getSize(V()).y);
    this.model.rotation.y = Math.PI / 2;
    this.model.position.y = -box.min.y * this.model.scale.x;
    this.baseY = this.model.position.y;
    this.root.add(this.model);
    this.model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
      if (o.isBone) this.rest.set(o, o.quaternion.clone());
    });
    this.bones = Object.fromEntries([...this.rest.keys()].map(b => [b.name, b]));
    this.root.updateMatrixWorld(true);
    for (const side of ['l', 'r']) {
      const foot = this.bones['foot_' + side];
      this.feet[side] = {
        point: this.root.worldToLocal(foot.getWorldPosition(V())),
        quaternion: foot.getWorldQuaternion(new THREE.Quaternion()),
      };
    }
    this.root.userData.rig = 'Unreal 61-bone skeleton; procedural skating pose with foot IK';
    this.root.userData.runtimeHeight = 1.82;
    return this;
  }

  update({ speedRatio = 0, crouch = 0, airborne = false, steer = 0, grab = false, time = 0, bail = false }) {
    for (const [bone, q] of this.rest) bone.quaternion.copy(q);
    const compression = THREE.MathUtils.clamp(crouch + (airborne ? 0.25 : 0), 0, 1);
    this.root.position.y = this.deckHeight + (airborne ? 0.025 : 0);
    this.model.position.y = this.baseY - 0.025 - compression * 0.13;
    this.root.updateWorldMatrix(true, true);
    const rootRotation = this.root.getWorldQuaternion(new THREE.Quaternion());
    for (const side of ['l', 'r']) {
      const target = this.root.localToWorld(this.feet[side].point.clone());
      solveLimb(this.bones['thigh_' + side], this.bones['calf_' + side], this.bones['foot_' + side],
        target, this.root.localToWorld(V(1, 0.2, 0)));
      const foot = this.bones['foot_' + side];
      foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(rootRotation.clone().multiply(this.feet[side].quaternion)));
    }
    for (const side of ['l', 'r']) {
      const sign = side === 'l' ? -1 : 1;
      const upper = this.bones['upperarm_' + side];
      const shoulder = this.root.worldToLocal(upper.getWorldPosition(V()));
      const sway = Math.sin(time * 4) * 0.015 * speedRatio;
      const target = shoulder.add(V(0.08 + compression * 0.05, -0.24 + Math.abs(steer) * 0.08 + sway, sign * 0.25));
      if (grab && side === 'l') target.set(0.14, 0.35, -0.22);
      if (bail) target.y += 0.25;
      solveLimb(upper, this.bones['lowerarm_' + side], this.bones['hand_' + side],
        this.root.localToWorld(target), this.root.localToWorld(V(0.5, 0.7, sign * 0.6)));
    }
    // Turn the face toward the nose while retaining the sideways skating stance.
    const head = this.bones.head;
    const headWorld = head.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0).applyQuaternion(rootRotation), 0.8);
    head.quaternion.copy(head.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(turn.multiply(headWorld)));
    this.root.updateWorldMatrix(true, true);
  }
}
