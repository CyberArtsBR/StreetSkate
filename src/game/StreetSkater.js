import * as THREE from 'three';
import { StreetPhysics } from './StreetPhysics.js';
import { UnrealRider } from '../character/UnrealRider.js';
import { StreetBoard } from '../skateboard/StreetBoard.js';

export class StreetSkater extends StreetPhysics {
  constructor(options) {
    super(options);
    this.root = new THREE.Group();
    this.root.name = 'TheanchoURi-skater';
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    this.presentationNormal = new THREE.Vector3(0, 1, 0);
  }

  async load() {
    [this.board, this.rider] = await Promise.all([
      new StreetBoard('/assets/rider/skateboard.glb').load(),
      new UnrealRider('/assets/rider/TheanchoURi.glb').load(),
    ]);
    this.visual.add(this.board.root, this.rider.root);
    this.rider.deckHeight = this.board.deckHeight;
    this.update(0, {}, 0);
    return this;
  }

  update(delta, input, elapsed) {
    this.advance(delta, input);
    this.root.position.copy(this.position);
    this.presentationNormal.lerp(this.grounded ? this.normal : new THREE.Vector3(0, 1, 0),
      1 - Math.exp(-18 * Math.max(delta, 1 / 120))).normalize();
    const forward = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading))
      .projectOnPlane(this.presentationNormal).normalize();
    const back = forward.clone().negate();
    const right = new THREE.Vector3().crossVectors(this.presentationNormal, back).normalize();
    this.visual.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, this.presentationNormal, back));
    const speedRatio = Math.min(Math.abs(this.speed) / this.config.maxSpeed, 1);
    this.board?.update({ distance: this.distance, flip: this.flipActive ? this.flipProgress : 0,
      airborne: !this.grounded, grab: !this.grounded && input.grab });
    this.rider?.update({ speedRatio, crouch: this.charge, airborne: !this.grounded,
      steer: this.steer, grab: !this.grounded && input.grab, time: elapsed, bail: this.bailTime > 0 });
    return { speedRatio };
  }
}
