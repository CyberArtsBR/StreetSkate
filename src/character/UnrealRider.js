import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function setWorldRotation(bone, rotation) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}

function frame(direction, reference) {
  const x = direction.clone().normalize();
  const y = reference.clone().projectOnPlane(x);
  if (y.lengthSq() < 1e-8) y.copy(Math.abs(x.y) < 0.9 ? V(0, 1, 0) : V(0, 0, 1)).projectOnPlane(x);
  y.normalize();
  const z = V().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// Aim using world directions; Unreal bone axes are not anatomical Euler axes.
function aim(bone, child, target) {
  bone.updateWorldMatrix(true, true);
  const origin = bone.getWorldPosition(V());
  const current = child.getWorldPosition(V()).sub(origin).normalize();
  const desired = target.clone().sub(origin).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(current, desired)
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  setWorldRotation(bone, rotation);
}

function solveLimb(upper, lower, end, target, pole, alignElbow = false) {
  const hip = upper.getWorldPosition(V());
  const knee = lower.getWorldPosition(V());
  const foot = end.getWorldPosition(V());
  const a = hip.distanceTo(knee), b = knee.distanceTo(foot);
  const axis = target.clone().sub(hip).normalize();
  const distance = THREE.MathUtils.clamp(hip.distanceTo(target), Math.abs(a - b) + 0.001, a + b - 0.001);
  const reachable = hip.clone().addScaledVector(axis, distance);
  const along = (a * a + distance * distance - b * b) / (2 * distance);
  const perpendicular = pole.clone().sub(hip).projectOnPlane(axis).normalize();
  const desiredKnee = hip.clone().addScaledVector(axis, along)
    .addScaledVector(perpendicular, Math.sqrt(Math.max(0, a * a - along * along)));
  if (alignElbow) {
    // Match the authored elbow bend plane, not just the upper-arm direction.
    // A direction-only solve can roll the sleeve and make the elbow bend sideways.
    const restDirection = knee.clone().sub(hip).normalize();
    const restNormal = V().crossVectors(restDirection, foot.clone().sub(knee).normalize());
    const desiredDirection = desiredKnee.clone().sub(hip).normalize();
    const desiredNormal = V().crossVectors(desiredDirection, reachable.clone().sub(desiredKnee).normalize());
    if (restNormal.lengthSq() > 1e-5 && desiredNormal.lengthSq() > 1e-5) {
      const rotation = frame(desiredDirection, desiredNormal)
        .multiply(frame(restDirection, restNormal).invert())
        .multiply(upper.getWorldQuaternion(new THREE.Quaternion()));
      setWorldRotation(upper, rotation);
    } else aim(upper, lower, desiredKnee);
  } else aim(upper, lower, desiredKnee);
  aim(lower, end, reachable);
}

export class UnrealRider {
  constructor(url) {
    this.url = url;
    this.root = new THREE.Group();
    this.root.name = 'street-rider';
    this.rest = new Map();
    this.feet = {};
    this.hands = {};
    this.pose = { compression: 0, air: 0, grab: 0, steer: 0 };
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
      const hand = this.bones['hand_' + side];
      const wrist = hand.getWorldPosition(V());
      const fingers = this.bones['middle_03_' + side].getWorldPosition(V()).sub(wrist);
      const thumb = this.bones['thumb_02_' + side].getWorldPosition(V()).sub(wrist);
      this.hands[side] = {
        frame: frame(fingers, thumb),
        rotation: hand.getWorldQuaternion(new THREE.Quaternion()),
      };
    }
    this.root.userData.rig = 'Unreal 61-bone skeleton; procedural skating pose with foot IK';
    this.root.userData.runtimeHeight = 1.82;
    return this;
  }

  update({ speedRatio = 0, crouch = 0, airborne = false, steer = 0, grab = false, time = 0, dt = 1 / 60, bail = false }) {
    for (const [bone, q] of this.rest) bone.quaternion.copy(q);
    const blend = 1 - Math.exp(-12 * Math.max(dt, 1 / 120));
    const goals = { compression: THREE.MathUtils.clamp(crouch + (airborne ? grab ? 0.8 : 0.3 : 0), 0, 1),
      air: Number(airborne), grab: Number(grab), steer };
    for (const key of Object.keys(this.pose)) this.pose[key] += (goals[key] - this.pose[key]) * blend;
    const { compression, air, grab: grabWeight, steer: balance } = this.pose;
    this.root.position.y = this.deckHeight + (airborne ? 0.025 : 0);
    this.model.position.y = this.baseY - 0.025 - compression * 0.13;
    this.root.updateWorldMatrix(true, true);
    const rootRotation = this.root.getWorldQuaternion(new THREE.Quaternion());
    const rotate = (name, axis, angle) => {
      const bone = this.bones[name];
      const delta = new THREE.Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(rootRotation), angle);
      setWorldRotation(bone, delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
    };
    // Share the gaze and crouch across the torso instead of twisting only the neck.
    for (const name of ['spine_01', 'spine_02', 'spine_03']) {
      rotate(name, V(0, 1, 0), 0.055);
      rotate(name, V(0, 0, 1), -0.015 - compression * 0.045 - balance * 0.018);
    }
    rotate('neck_01', V(0, 1, 0), 0.13);
    rotate('head', V(0, 1, 0), 0.28);
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
      const lower = this.bones['lowerarm_' + side];
      const hand = this.bones['hand_' + side];
      const shoulder = this.root.worldToLocal(upper.getWorldPosition(V()));
      const sway = Math.sin(time * 3.5 + sign * 0.4) * 0.008 * speedRatio;
      const target = shoulder.clone().add(V(0.13 + compression * 0.025,
        -0.31 + air * 0.065 + sign * balance * 0.035 + sway, sign * (0.13 + air * 0.075)));
      if (side === 'l') target.lerp(V(0.18, 0.43, -0.22), grabWeight);
      if (bail) target.y += 0.25;
      const elbowPole = shoulder.clone().add(V(-0.18, -0.2, sign * 0.7));
      solveLimb(upper, lower, hand, this.root.localToWorld(target), this.root.localToWorld(elbowPole), true);

      // Fingers extend along the forearm; thumbs face forward. Share wrist roll
      // with the forearm so the cuffs do not take the entire twist.
      const fingerDirection = hand.getWorldPosition(V()).sub(lower.getWorldPosition(V())).normalize();
      const thumbDirection = V(1, 0, 0).applyQuaternion(rootRotation);
      const desired = frame(fingerDirection, thumbDirection)
        .multiply(this.hands[side].frame.clone().invert()).multiply(this.hands[side].rotation);
      const current = hand.getWorldQuaternion(new THREE.Quaternion());
      const correction = desired.clone().multiply(current.clone().invert());
      if (correction.w < 0) correction.set(-correction.x, -correction.y, -correction.z, -correction.w);
      const roll = THREE.MathUtils.clamp(2 * Math.atan2(V(correction.x, correction.y, correction.z).dot(fingerDirection), correction.w), -0.8, 0.8);
      const forearmRoll = new THREE.Quaternion().setFromAxisAngle(fingerDirection, roll * 0.65);
      setWorldRotation(lower, forearmRoll.multiply(lower.getWorldQuaternion(new THREE.Quaternion())));
      const twist = this.bones['lowerarm_twist_01_' + side];
      twist.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(hand.position.clone().normalize(), -roll * 0.325).multiply(this.rest.get(twist)));
      const wrist = hand.getWorldQuaternion(new THREE.Quaternion());
      const angle = wrist.angleTo(desired);
      setWorldRotation(hand, wrist.slerp(desired, Math.min(1, 0.45 / Math.max(angle, 1e-6))));
    }
    this.root.updateWorldMatrix(true, true);
  }
}
