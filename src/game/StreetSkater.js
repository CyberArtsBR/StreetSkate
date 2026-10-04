import * as THREE from 'three';
import { SkillStreetPhysics } from './SkillStreetPhysics.js';
import { UnrealRider } from '../character/UnrealRider.js';
import { StreetBoard } from '../skateboard/StreetBoard.js';
import { ensureBalanceHud } from './BalanceHud.js';

export class StreetSkater extends SkillStreetPhysics {
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
    this.balanceHud = ensureBalanceHud();
    this.update(0, {}, 0);
    return this;
  }

  update(delta, input, elapsed) {
    this.advance(delta, input);
    this.root.position.copy(this.position);
    const surfaceUp = this.bodyUp();
    this.presentationNormal.lerp(surfaceUp,
      1 - Math.exp(-18 * Math.max(delta, 1 / 120))).normalize();
    const forward = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading))
      .projectOnPlane(this.presentationNormal).normalize();
    const back = forward.clone().negate();
    const right = new THREE.Vector3().crossVectors(this.presentationNormal, back).normalize();
    this.visual.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, this.presentationNormal, back));

    const speedRatio = Math.min(Math.abs(this.speed) / this.config.maxSpeed, 1);
    const grabActive = Boolean(this.grabState && input.grabHeld);
    this.board?.update({
      flipState: this.flipState,
      airborne: !this.grounded && !this.grind,
      grab: grabActive,
      manual: this.manual,
      manualBalance: this.manualBalance,
      grind: this.grind,
      wallRide: Boolean(this.wallRide),
    });
    this.rider?.update({
      speedRatio,
      crouch: Math.max(this.charge, this.grind ? 0.34 : this.manual ? 0.2 : 0),
      airborne: !this.grounded && !this.grind,
      steer: this.steer,
      grab: grabActive,
      time: elapsed,
      dt: delta,
      bail: this.bailTime > 0,
      manual: this.manual,
      grinding: Boolean(this.grind),
      wallRide: Boolean(this.wallRide),
      stance: this.stance,
      flatland: this.flatland,
    });
    this.balanceHud?.update(this.balanceMode(), this.balanceValue());
    return { speedRatio };
  }
}
