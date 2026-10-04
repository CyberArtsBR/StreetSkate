import * as THREE from 'three';

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.initialized = false;
  }

  snap(player) {
    this.initialized = false;
    this.update(player, 1);
  }

  update(player, dt) {
    const forward = player.forward;
    const speedRatio = Math.min(Math.abs(player.speed) / player.config.maxSpeed, 1);
    const desired = player.root.position.clone()
      .addScaledVector(forward, -6.8 - speedRatio * 2.2)
      .add(new THREE.Vector3(0, 3.2 + speedRatio * 0.8, 0));
    const look = player.root.position.clone()
      .addScaledVector(forward, 3 + speedRatio * 3)
      .add(new THREE.Vector3(0, 1.05, 0));
    if (!this.initialized) {
      this.position.copy(desired);
      this.target.copy(look);
      this.initialized = true;
    }
    const positionBlend = 1 - Math.exp(-5.5 * dt);
    const targetBlend = 1 - Math.exp(-7 * dt);
    this.position.lerp(desired, positionBlend);
    this.target.lerp(look, targetBlend);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }
}
