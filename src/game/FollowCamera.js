import * as THREE from 'three';
const UP = new THREE.Vector3(0, 1, 0);
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.direction = new THREE.Vector3(0, 0, -1);
    this.initialized = false;
  }
  snap(player) { this.initialized = false; this.update(player, 1); }
  update(player, dt) {
    // Keep the camera on the travel line during aerial spins.
    const forward = player.grounded ? player.forward.clone() : player.velocity.clone();
    forward.y = 0;
    if (forward.lengthSq() < 0.1) forward.copy(this.direction);
    forward.normalize();
    const ratio = Math.min(Math.abs(player.speed) / player.config.maxSpeed, 1);
    if (!this.initialized) this.direction.copy(forward);
    this.direction.lerp(forward, 1 - Math.exp(-4 * dt)).normalize();
    const anchor = player.position.clone().addScaledVector(UP, 1.15);
    const desired = anchor.clone().addScaledVector(this.direction, -5.1 - ratio * 1.5).addScaledVector(UP, 2.1);
    const look = anchor.clone().addScaledVector(this.direction, 1.4);
    if (!this.initialized) {
      this.position.copy(desired); this.target.copy(look); this.initialized = true;
    }
    this.position.lerp(desired, 1 - Math.exp(-7 * dt));
    this.target.lerp(look, 1 - Math.exp(-10 * dt));
    this.camera.position.copy(player.surface.camera(anchor, this.position));
    this.camera.lookAt(this.target);
  }
}
