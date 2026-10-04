import * as THREE from 'three';
const UP = new THREE.Vector3(0, 1, 0);
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.direction = new THREE.Vector3(0, 0, -1);
    this.initialized = false;
    this.yawOffset = 0;
    this.pitchOffset = 0;
    this.lookIdle = 0;
  }
  snap(player) { this.initialized = false; this.update(player, 1, {}); }
  update(player, dt, input = {}) {
    const manualLook = Math.abs(input.cameraX || 0) + Math.abs(input.cameraY || 0) + Math.abs(input.mouseDX || 0) + Math.abs(input.mouseDY || 0);
    if (manualLook > 0.001) {
      this.yawOffset -= (input.cameraX || 0) * 2.35 * dt + (input.mouseDX || 0) * 0.0035;
      this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + (input.cameraY || 0) * 1.5 * dt + (input.mouseDY || 0) * 0.0028, -0.38, 0.5);
      this.lookIdle = 0;
    } else {
      this.lookIdle += dt;
      if (this.lookIdle > 1.35) {
        this.yawOffset *= Math.exp(-1.8 * dt);
        this.pitchOffset *= Math.exp(-1.8 * dt);
      }
    }

    const forward = player.grounded ? player.forward.clone() : player.velocity.clone();
    forward.y = 0;
    if (forward.lengthSq() < 0.1) forward.copy(this.direction);
    forward.normalize();
    const orbit = forward.clone().applyAxisAngle(UP, this.yawOffset);
    const ratio = Math.min(Math.abs(player.speed) / player.config.maxSpeed, 1);
    if (!this.initialized) this.direction.copy(orbit);
    this.direction.lerp(orbit, 1 - Math.exp(-4 * dt)).normalize();
    const anchor = player.position.clone().addScaledVector(UP, 1.15);
    const distance = 5.1 + ratio * 1.5;
    const height = 2.1 + this.pitchOffset * 4.1;
    const desired = anchor.clone().addScaledVector(this.direction, -distance).addScaledVector(UP, height);
    const look = anchor.clone().addScaledVector(this.direction, 1.4).addScaledVector(UP, -this.pitchOffset * 0.85);
    if (!this.initialized) {
      this.position.copy(desired); this.target.copy(look); this.initialized = true;
    }
    this.position.lerp(desired, 1 - Math.exp(-7 * dt));
    this.target.lerp(look, 1 - Math.exp(-10 * dt));
    this.camera.position.copy(player.surface.camera(anchor, this.position));
    this.camera.lookAt(this.target);
  }
}
