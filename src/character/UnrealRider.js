import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { flipMotion } from './TrickMotion.js';
import { PRESENTATION_STATES, springStep, transitionFrequency } from './PresentationState.js';
import { resolveHumanoidBones, humanoidIKAudit } from './RigMapping.js';
import { riderCrouchOffset, ensurePelvisDeckClearance, outwardKneePole, boundedHandReach, neutralHandOffset } from './SkatePoseConstraints.js';
import { footWorldOrientation } from './FootOrientation.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const C = THREE.MathUtils.clamp;
const SIDES = ['l', 'r'];
const SEMANTIC = Object.freeze({
  root: 'root', pelvis: 'pelvis', spine1: 'spine_01', spine2: 'spine_02', spine3: 'spine_03',
  neck: 'neck_01', head: 'head', clavicleL: 'clavicle_l', clavicleR: 'clavicle_r',
  upperArmL: 'upperarm_l', upperArmR: 'upperarm_r', lowerArmL: 'lowerarm_l', lowerArmR: 'lowerarm_r',
  handL: 'hand_l', handR: 'hand_r', thighL: 'thigh_l', thighR: 'thigh_r',
  calfL: 'calf_l', calfR: 'calf_r', footL: 'foot_l', footR: 'foot_r',
});

function finiteQ(q) {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}
function finiteV(v) {
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function setWorldQ(bone, quaternion) {
  if (!bone?.parent || !finiteQ(quaternion) || quaternion.lengthSq() < 1e-12) return;
  const local = bone.parent.getWorldQuaternion(Q()).invert().multiply(quaternion).normalize();
  if (!finiteQ(local)) return;
  bone.quaternion.copy(local);
  bone.updateWorldMatrix(false, true);
}

function aim(bone, child, target) {
  if (!bone || !child) return;
  bone.updateWorldMatrix(true, true);
  const origin = bone.getWorldPosition(V());
  const restDirection = child.getWorldPosition(V()).sub(origin);
  const direction = target.clone().sub(origin);
  if (restDirection.lengthSq() < 1e-9 || direction.lengthSq() < 1e-9) return;
  setWorldQ(bone, Q().setFromUnitVectors(restDirection.normalize(), direction.normalize())
    .multiply(bone.getWorldQuaternion(Q())));
}

function limb(upper, lower, end, target, pole) {
  if (!upper || !lower || !end || !finiteV(target) || !finiteV(pole)) return;
  const origin = upper.getWorldPosition(V());
  const joint = lower.getWorldPosition(V());
  const tip = end.getWorldPosition(V());
  const a = origin.distanceTo(joint), b = joint.distanceTo(tip);
  const axis = target.clone().sub(origin);
  if (a < 1e-5 || b < 1e-5 || axis.lengthSq() < 1e-9) return;
  const epsilon = Math.min(0.001, a * 0.01, b * 0.01);
  const minReach = Math.abs(a - b) + epsilon, maxReach = a + b - epsilon;
  if (maxReach <= minReach) return;
  const distance = C(axis.length(), minReach, maxReach);
  axis.normalize();
  const along = (a * a + distance * distance - b * b) / (2 * distance);
  const side = pole.clone().sub(origin).projectOnPlane(axis);
  // Prefer the current knee plane over flipping between world axes.
  if (side.lengthSq() < 1e-8) side.copy(joint).sub(origin).projectOnPlane(axis);
  if (side.lengthSq() < 1e-8) side.set(0, 0, 1).projectOnPlane(axis);
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0).projectOnPlane(axis);
  side.normalize();
  const wantedJoint = origin.clone().addScaledVector(axis, along)
    .addScaledVector(side, Math.sqrt(Math.max(0, a * a - along * along)));
  aim(upper, lower, wantedJoint);
  aim(lower, end, origin.clone().addScaledVector(axis, distance));
}

export class UnrealRider {
  constructor(url) {
    this.url = url;
    this.root = new THREE.Group();
    this.root.name = 'street-rider';
    this.rest = new Map();
    this.feet = {};
    this.hands = {};
    this.deckHeight = 0.12;
    this.channels = new Map(Object.values(PRESENTATION_STATES)
      .map(state => [state, { value: state === 'IDLE' ? 1 : 0, velocity: 0 }]));
    this.scalar = { compression: { value: 0, velocity: 0 } };
    this.ft = { l: V(), r: V() };
    this.soleOffsets={l:0.05,r:0.05};
    this.kneePoles={};
    this.outward={l:-1,r:1};
    this.at = { l: V(), r: V() };
  }

  async load() {
    this.model = (await new GLTFLoader().loadAsync(this.url)).scene;
    const box = new THREE.Box3().setFromObject(this.model);
    const height = box.getSize(V()).y;
    if (!Number.isFinite(height) || height < 1e-4 || !Number.isFinite(box.min.y)) {
      this.dispose();
      throw new Error('Rider GLB has invalid or empty visual bounds');
    }
    this.model.scale.setScalar(1.82 / height);
    this.model.rotation.y = Math.PI / 2;
    this.model.position.y = -box.min.y * this.model.scale.x;
    this.basePos = this.model.position.clone();
    this.baseQ = this.model.quaternion.clone();
    this.root.add(this.model);
    this.model.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
      if (object.isBone) this.rest.set(object, object.quaternion.clone());
    });
    this.bones = resolveHumanoidBones([...this.rest.keys()]);
    const missing = Object.entries(SEMANTIC).filter(([, name]) => !this.bones[name]).map(([key]) => key);
    this.rigAudit = {
      boneCount: this.rest.size, missing, ik: humanoidIKAudit(this.bones),
      semanticNames: Object.fromEntries(Object.entries(SEMANTIC).map(([key, name]) => [key, this.bones[name]?.name || null])),
    };
    if (missing.length) console.warn('[StreetSkate] rider rig missing:', missing.join(', '));
    this.root.updateWorldMatrix(true, true);
    // Imported rigs have different pivots. Center the ACTUAL two foot anchors
    // on the board rather than centering the visual bounding box or pelvis.
    const leftFoot=this.bones.foot_l, rightFoot=this.bones.foot_r;
    if(leftFoot&&rightFoot){
      const midpoint=leftFoot.getWorldPosition(V()).add(rightFoot.getWorldPosition(V())).multiplyScalar(0.5);
      const localMidpoint=this.root.worldToLocal(midpoint);
      this.model.position.x-=localMidpoint.x;
      this.model.position.z-=localMidpoint.z;
      this.basePos.copy(this.model.position);
      this.root.updateWorldMatrix(true,true);
    }
    // A foot bone is at the ankle, not the bottom of the shoe. Calibrate its
    // sole clearance per avatar once; don't reuse the imported ankle height as
    // the skateboard's deck top.
    const floorY=new THREE.Box3().setFromObject(this.model).min.y;
    // The imported rest pose may hold one sneaker above the other. A single
    // whole-model floor height must not make the lifted ankle's *extra height*
    // masquerade as extra sole thickness. Both Chimpions shoes use the same
    // board clearance, measured from the lowest rest ankle.
    const restAnkles = SIDES.map(side => this.bones['foot_' + side])
      .filter(Boolean).map(foot => this.root.worldToLocal(foot.getWorldPosition(V())).y);
    const soleClearance = restAnkles.length
      ? C(Math.min(...restAnkles) - floorY - 0.012, 0.032, 0.16)
      : 0.055;
    // Imported character axes can be mirrored by the +90 degree GLB rotation.
    // Infer leg sides from the actual positioned feet, never side labels alone.
    if (this.bones.foot_l && this.bones.foot_r) {
      const lx=this.root.worldToLocal(this.bones.foot_l.getWorldPosition(V())).x;
      const rx=this.root.worldToLocal(this.bones.foot_r.getWorldPosition(V())).x;
      this.outward.l=lx<=rx?-1:1;
      this.outward.r=-this.outward.l;
    }
    for (const side of SIDES) {
      const foot = this.bones['foot_' + side], knee=this.bones['calf_'+side];
      if (foot) {
        const footLocal=this.root.worldToLocal(foot.getWorldPosition(V()));
        this.feet[side] = { point:footLocal, q:foot.getWorldQuaternion(Q()) };
        // Excessive ankle-to-floor offsets cause visibly floating shoes on some rigs.
        this.soleOffsets[side]=soleClearance;
      }
      const thigh = this.bones['thigh_' + side];
      if (knee && thigh) {
        // The pole tracks its HIP instead of remaining fixed during crouches.
        const kneeLocal = this.root.worldToLocal(knee.getWorldPosition(V()));
        const hipLocal = this.root.worldToLocal(thigh.getWorldPosition(V()));
        this.kneePoles[side] = kneeLocal.sub(hipLocal);
      }
      const hand = this.bones['hand_' + side];
      if (hand) this.hands[side] = { q: hand.getWorldQuaternion(Q()) };
    }
    this.root.userData.rigAudit = this.rigAudit;
    this.root.userData.rig = `Unreal-style ${this.rest.size}-bone skeleton; procedural presentation + IK`;
    return this;
  }

  resetPresentation() {
    for (const [name, channel] of this.channels) Object.assign(channel, { value: name === 'IDLE' ? 1 : 0, velocity: 0 });
    for (const channel of Object.values(this.scalar)) Object.assign(channel, { value: 0, velocity: 0 });
    for (const [bone, quaternion] of this.rest) bone.quaternion.copy(quaternion);
    if (this.model) {
      this.model.position.copy(this.basePos);
      this.model.quaternion.copy(this.baseQ);
    }
  }

  w(state) { return this.channels.get(state)?.value || 0; }

  blendState(state, dt) {
    let total = 0;
    for (const [name, channel] of this.channels) {
      springStep(channel, name === state ? 1 : 0, transitionFrequency(name === state ? state : name), dt);
      channel.value = C(channel.value, 0, 1);
      total += channel.value;
    }
    // Different transition rates must not add up to two complete poses.
    if (total <= 1e-6) {
      const active = this.channels.get(state) || this.channels.get(PRESENTATION_STATES.IDLE);
      active.value = 1;
      active.velocity = 0;
      return;
    }
    for (const channel of this.channels.values()) {
      channel.value /= total;
      channel.velocity /= total;
    }
  }

  rotate(name, axis, angle, rootQ) {
    const bone = this.bones[name];
    if (!bone || Math.abs(angle) < 1e-5) return;
    setWorldQ(bone, Q().setFromAxisAngle(axis.clone().applyQuaternion(rootQ), angle).multiply(bone.getWorldQuaternion(Q())));
  }

  boardPoint(board, x, y, z) { return board?.pointWorld?.(x, y, z, V()) || null; }

  grabTarget(name, side, stance, board) {
    const sign = side === 'l' ? -1 : 1;
    const front = stance < 0 ? 'r' : 'l', rear = front === 'l' ? 'r' : 'l';
    switch (name) {
      case 'Indy': return side === rear ? this.boardPoint(board, sign * 0.14, 0.04, 0) : null;
      case 'Melon': return side === front ? this.boardPoint(board, -sign * 0.14, 0.04, 0) : null;
      case 'Nosegrab': return side === front ? this.boardPoint(board, 0, 0.05, -0.43) : null;
      case 'Tailgrab': return side === rear ? this.boardPoint(board, 0, 0.05, 0.43) : null;
      case 'Japan': return side === front ? this.boardPoint(board, -sign * 0.14, 0.04, -0.04) : null;
      case 'Madonna': return side === front ? this.boardPoint(board, sign * 0.08, 0.05, -0.43) : null;
      case 'Benihana': return side === rear ? this.boardPoint(board, sign * 0.08, 0.05, 0.35) : null;
      case 'Method': return side === front ? this.boardPoint(board, -sign * 0.14, 0.04, 0.08) : null;
      case 'Stalefish': return side === rear ? this.boardPoint(board, -sign * 0.14, 0.04, 0.16) : null;
      case 'Rocket Air': return this.boardPoint(board, sign * 0.09, 0.05, -0.41);
      case 'Seatbelt': return side === front ? this.boardPoint(board, 0.08 * sign, 0.05, 0.4) : null;
      case 'Mute': return side === front ? this.boardPoint(board, sign * 0.14, 0.04, -0.04) : null;
      case 'Judo': return side === front ? this.boardPoint(board, 0, 0.05, -0.4) : null;
      case 'Crail': return side === rear ? this.boardPoint(board, 0, 0.05, -0.4) : null;
      case 'Christ Air': return side === front ? this.boardPoint(board, -sign * 0.14, 0.04, 0) : null;
      default: return null;
    }
  }

  update({ presentation, board, speedRatio = 0, crouch = 0, steer = 0, pushWeight = 0, pushPhase = 0,
    flipState = null, grabState = null, grabWeight = 0, manual = null, manualBalance = 0,
    grindType = null, grindBalance = 0, wallRide = null, vert = false, verticalVelocity = 0,
    bail = false, bailProgress = 0, stance = 1, flatland = null, landingSeverity = 0, time = 0, dt = 1 / 60 }) {
    if (!this.model) return;
    for (const [bone, quaternion] of this.rest) bone.quaternion.copy(quaternion);
    this.model.position.copy(this.basePos);
    this.model.quaternion.copy(this.baseQ);
    this.blendState(presentation?.state || PRESENTATION_STATES.IDLE, dt);
    const air = this.w(PRESENTATION_STATES.AIR) + this.w(PRESENTATION_STATES.VERT_AIR) + this.w(PRESENTATION_STATES.OLLIE_POP);
    const brake = this.w(PRESENTATION_STATES.BRAKE), wall = this.w(PRESENTATION_STATES.WALLRIDE);
    const flat = this.w(PRESENTATION_STATES.FLATLAND), grind = this.w(PRESENTATION_STATES.GRIND);
    const manualW = this.w(PRESENTATION_STATES.MANUAL) + this.w(PRESENTATION_STATES.NOSE_MANUAL);
    const pump = this.w(PRESENTATION_STATES.PUMP);
    const grab = grabState?.name ? C(grabWeight, 0, 1) : 0;
    // Half Pipe's compact air silhouette: knees stay tucked through the flight,
    // instead of standing at takeoff and only bending near the apex.
    const tuck = air * (vert ? 0.65 : 0.53);
    const compTarget = C(Math.max(crouch, tuck, grab * 0.68)
      + landingSeverity * 0.32 + grind * 0.16 + manualW * 0.08 + pump * 0.08, 0, 1);
    const compression = C(springStep(this.scalar.compression, compTarget, grab > 0 ? 18 : 14, dt), 0, 1);
    this.root.position.y = board?.root.position.y ?? this.deckHeight;
    // Keep hip compression anatomical; IK keeps shoe soles planted on the deck.
    this.model.position.y -= riderCrouchOffset(compression, grab);
    if (manual === 'manual') this.model.position.z += 0.035 * manualW;
    if (manual === 'noseManual') this.model.position.z -= 0.035 * manualW;
    if (bail) {
      this.model.position.x += (stance < 0 ? -1 : 1) * (0.08 + bailProgress * 0.16);
      this.model.position.y -= Math.min(0.58, bailProgress * 0.72);
      // Sideways tumble sells the crash instead of merely recoiling in place.
      this.model.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(V(0,0,1), (stance < 0 ? 1 : -1) * Math.min(1.28, bailProgress * 1.68))
      );
    }
    this.root.updateWorldMatrix(true, true);
    const rootQ = this.root.getWorldQuaternion(Q());
    const balance = C(steer + manualBalance * 0.45 + grindBalance * 0.5, -1, 1);
    const apex = vert ? C(1 - Math.abs(verticalVelocity) / 4, 0, 1) : 0;
    for (const name of ['spine_01', 'spine_02', 'spine_03']) {
      this.rotate(name, V(0, 1, 0), 0.045, rootQ);
      this.rotate(name, V(0, 0, 1), (-0.015 - compression * 0.22 - balance * 0.025 + brake * 0.04 - wall * 0.05) / 3, rootQ);
      this.rotate(name, V(1, 0, 0), apex * 0.03 - pump * 0.025, rootQ);
    }
    this.rotate('pelvis', V(0, 0, 1), manualBalance * manualW * 0.08 - grindBalance * grind * 0.06, rootQ);
    this.rotate('neck_01', V(0, 1, 0), 0.11, rootQ);
    this.rotate('head', V(0, 1, 0), 0.22, rootQ);
    this.rotate('head', V(0, 0, 1), wall * -0.08 + (bail ? 0.13 : 0), rootQ);
    // Parent-bone adjustments precede IK so they cannot move solved feet/hands.
    if (grindType === 'Smith' || grindType === 'Feeble') this.rotate('pelvis', V(1, 0, 0), -0.08 * grind, rootQ);
    if (grindType === 'Crook' || grindType === 'Overcrook') this.rotate('pelvis', V(0, 0, 1), 0.1 * grind, rootQ);
    if (wallRide) this.rotate('pelvis', V(1, 0, 0), -0.1 * wall, rootQ);
    if (flatland === 'Handstand') this.rotate('spine_02', V(1, 0, 0), 0.28 * flat, rootQ);
    if (bail) {
      this.rotate('spine_02', V(1, 0, 0), 0.22, rootQ);
      this.rotate('spine_03', V(0, 0, 1), (stance < 0 ? -1 : 1) * 0.2, rootQ);
    }

    // Grabs use constrained upper-arm reach; never compress the entire rig to
    // place a hand on a target the skeleton cannot reach.
    this.root.updateWorldMatrix(true,true);
    // Idle is already deck-aligned: applying a clearance lift then could
    // reintroduce floating shoes on short-legged GLB characters.
    if (compression>0.08 || grab>0.05)
      ensurePelvisDeckClearance(this.model,this.bones.pelvis,board,0.405);
    this.root.updateWorldMatrix(true,true);
    const front = stance < 0 ? 'r' : 'l', rear = front === 'l' ? 'r' : 'l';
    const motion = flipState ? flipMotion(flipState.progress) : null;
    const deckLocked = Boolean(board && !flipState && !bail && !flatland);
    for (const side of SIDES) {
      if (!this.feet[side]) continue;
      this.ft[side].copy(this.feet[side].point);
      if (deckLocked) {
        const contact=board.contactRig||{};
        const deckTop=(contact.deckTopY||board.deckHeight)-(board.deckHeight||0);
        const width=Math.max(0.15,(contact.deckWidth||0.42)*0.43);
        const halfLength=Math.max(0.35,(contact.deckLength||1.1)*0.39);
        const x=C(this.feet[side].point.x,-width,width);
        const z=C(this.feet[side].point.z,-halfLength,halfLength);
        const y=deckTop+this.soleOffsets[side];
        this.ft[side].copy(this.root.worldToLocal(this.boardPoint(board,x,y,z)));
      }
    }
    // Ollie/vert tuck lowers the pelvis with the feet on the deck. Only a flip
    // or a named one-foot trick releases them; a generic air pose must not float.
    if (motion) {
      this.ft.l.y += motion.footLift;
      this.ft.r.y += motion.footLift;
      const heel = /Heel/i.test(flipState.name), kick = /Kick|Hard|Varial/i.test(flipState.name);
      this.ft[front].x += (front === 'l' ? -1 : 1) * (heel ? -0.16 : kick ? 0.18 : 0.08) * motion.flick;
      this.ft[front].z -= 0.12 * motion.flick;
      if (/Impossible|Shove/.test(flipState.name)) this.ft[rear].z += 0.16 * motion.clearance;
    }
    if (flatland) {
      const wave = Math.sin(time * 7);
      switch (flatland) {
        case 'Pogo': this.ft[front].y += 0.22; this.ft[rear].y += 0.05; break;
        case 'Wrap Around': this.ft[rear].x += (rear === 'l' ? -1 : 1) * (0.18 + 0.08 * wave); break;
        case 'Handstand': this.ft.l.y += 0.36; this.ft.r.y += 0.36; break;
        case 'Casper': this.ft[front].y += 0.2; this.ft[rear].z += 0.14; break;
        case 'Truck Stand': this.ft.l.y += 0.15; this.ft.r.y += 0.05; break;
        case 'Anti Casper': this.ft[rear].y += 0.2; this.ft[front].z -= 0.14; break;
        case 'To Rail': this.ft.l.x -= 0.1; this.ft.r.x += 0.1; break;
        case 'Switch Foot Pogo': this.ft[rear].y += 0.24; break;
        case 'One Foot Manual': this.ft[front].y += 0.28; break;
        default: break;
      }
    }
    if (grabState?.name === 'Japan') { this.ft[rear].y += 0.2 * grab; this.ft[rear].x += (rear === 'l' ? -1 : 1) * 0.12 * grab; }
    if (grabState?.name === 'Madonna') { this.ft[rear].y += 0.22 * grab; this.ft[rear].z += 0.2 * grab; }
    if (grabState?.name === 'Benihana') { this.ft[front].y += 0.32 * grab; this.ft[front].z -= 0.28 * grab; }
    if (grabState?.name === 'Judo') { this.ft[rear].y += 0.22 * grab; this.ft[rear].x += (rear === 'l' ? -1 : 1) * 0.36 * grab; this.ft[rear].z -= 0.18 * grab; }
    if (grabState?.name === 'Rocket Air') { this.ft[rear].z -= 0.18 * grab; this.ft[front].z -= 0.08 * grab; }
    if (grabState?.name === 'Christ Air') {
      this.ft.l.y += 0.24 * grab; this.ft.r.y += 0.24 * grab;
      this.ft.l.x -= 0.32 * grab; this.ft.r.x += 0.32 * grab;
      this.ft.l.z -= 0.20 * grab; this.ft.r.z += 0.20 * grab;
    }
    if (grabState?.name === 'Airwalk') {
      this.ft.l.y += 0.28 * grab; this.ft.r.y += 0.28 * grab;
      this.ft.l.x -= 0.2 * grab; this.ft.r.x += 0.2 * grab;
      this.ft.l.z -= 0.13 * grab; this.ft.r.z += 0.13 * grab;
    }
    if (bail) {
      this.ft.l.x -= 0.2 + bailProgress * 0.2; this.ft.r.x += 0.2 + bailProgress * 0.2;
      this.ft.l.y += 0.16; this.ft.r.y += 0.1;
    }
    for (const side of SIDES) {
      const upper = this.bones['thigh_' + side], lower = this.bones['calf_' + side], foot = this.bones['foot_' + side];
      if (!upper || !lower || !foot || !this.feet[side]) continue;
      const poleDirection=outwardKneePole(this.kneePoles[side],this.outward[side],compression);
      const kneePole=upper.getWorldPosition(V()).add(poleDirection.applyQuaternion(rootQ));
      limb(upper, lower, foot, this.root.localToWorld(this.ft[side].clone()), kneePole);
      const releasedFoot = (grab > 0.01 && (
        (['Japan', 'Madonna', 'Judo'].includes(grabState?.name) && side === rear)
        || (grabState?.name === 'Benihana' && side === front) || ['Airwalk', 'Christ Air'].includes(grabState?.name)));
      // The board may have spun 180 degrees while the skater stayed facing
      // forward. Preserve the skater's ankle yaw and only align deck tilt.
      setWorldQ(foot, footWorldOrientation(
        this.root, board, this.feet[side].q, deckLocked && !releasedFoot,
      ));
    }

    this.root.updateWorldMatrix(true, true);
    for (const side of SIDES) {
      const sign = side === 'l' ? -1 : 1;
      const upper = this.bones['upperarm_' + side], lower = this.bones['lowerarm_' + side], hand = this.bones['hand_' + side];
      if (!upper || !lower || !hand) continue;
      const shoulder = this.root.worldToLocal(upper.getWorldPosition(V()));
      const isFront=side===(stance<0?'r':'l');
      const target=this.at[side].copy(shoulder)
        .add(neutralHandOffset(this.outward[side],isFront,compression,air,balance));
      target.y += sign * manualBalance * 0.07 * manualW + sign * grindBalance * 0.1 * grind;
      target.z += sign * (0.07 * grind + 0.14 * wall);
      target.y += 0.06 * (wall + flat);
      if (bail) { target.y += 0.24 + bailProgress * 0.12; target.z += sign * 0.16; }
      const grabTarget = this.grabTarget(grabState?.name, side, stance, board);
      if (grabState?.name === 'Madonna' && side === rear) target.addScaledVector(V(-0.04, 0.34, sign * 0.26), grab);
      if (grabState?.name === 'Japan' && side === rear) target.addScaledVector(V(-0.03, 0.18, sign * 0.14), grab);
      if (grabState?.name === 'Airwalk') target.addScaledVector(V(0, 0.18, sign * 0.2), grab);
      if (grabState?.name === 'Christ Air' && side === rear) target.addScaledVector(V(0, 0.30, sign * 0.38), grab);
      const handstand = flatland === 'Handstand' && board;
      const reach = handstand ? this.boardPoint(board, sign * 0.14, 0.04, 0) : grabTarget;
      const world = this.root.localToWorld(target.clone());
      const reachWeight = handstand ? flat : grab;
      if (reach) {
        const reachFrom=upper.getWorldPosition(V());
        const limbLength=reachFrom.distanceTo(lower.getWorldPosition(V()))
          +lower.getWorldPosition(V()).distanceTo(hand.getWorldPosition(V()));
        world.lerp(boundedHandReach(reachFrom,reach,limbLength),reachWeight);
      }
      const elbowPole=this.root.localToWorld(shoulder.clone().add(
        V(this.outward[side]*0.34,-0.18,isFront?0.17:-0.11)));
      limb(upper, lower, hand, world, elbowPole);
      if (this.hands[side]) {
        const handQ = rootQ.clone().multiply(this.hands[side].q);
        if (reach && board) handQ.slerp(board.root.getWorldQuaternion(Q()).multiply(this.hands[side].q), reachWeight);
        setWorldQ(hand, handQ);
      }
    }
    for (const [bone, quaternion] of this.rest) if (!finiteQ(bone.quaternion)) bone.quaternion.copy(quaternion);
    this.root.updateWorldMatrix(true, true);
  }
  /** Release resources owned by this GLB instance after a successful hot-swap
   * or rejected import. Board, scene lighting, renderer and other riders are
   * never owned here. Repeated calls are safe.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set(), materials = new Set();
    const textures = new Set(), skeletons = new Set();
    this.model?.traverse(object => {
      if (object.isSkinnedMesh && object.skeleton) skeletons.add(object.skeleton);
      if (object.geometry) geometries.add(object.geometry);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
        for (const uniform of Object.values(material.uniforms || {})) {
          if (uniform?.value?.isTexture) textures.add(uniform.value);
        }
      }
    });
    this.root.removeFromParent();
    for (const skeleton of skeletons) skeleton.dispose?.();
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
    for (const texture of textures) texture.dispose?.();
  }

}
