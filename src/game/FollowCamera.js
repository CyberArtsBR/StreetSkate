import * as THREE from 'three';
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Third-person skate cameras should follow world travel, not the deck nose.
 * After a 180 the board faces the opposite way while momentum keeps travelling
 * along the same line, so the camera must stay on the same travel side.
 */
export function resolveTravelFollowDirection(player, previousDirection = null, initialized = true) {
  const travel = player?.velocity?.clone?.() || new THREE.Vector3();
  travel.y = 0;
  if (travel.lengthSq() > 0.16) return travel.normalize();

  if (initialized && previousDirection?.lengthSq?.() > 1e-6) {
    const previous = previousDirection.clone();
    previous.y = 0;
    if (previous.lengthSq() > 1e-6) return previous.normalize();
  }

  const deckForward = player?.forward?.clone?.() || new THREE.Vector3(0, 0, -1);
  deckForward.y = 0;
  if (deckForward.lengthSq() > 1e-6) return deckForward.normalize();
  return new THREE.Vector3(0, 0, -1);
}

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
    this.vertBlend = 0;
  }
  snap(player) { this.initialized = false; this.vertBlend = player.movementState === 'VERT_AIR' ? 1 : 0; this.update(player, 1, {}); }
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

    const vertActive = player.movementState === 'VERT_AIR' && player.transitionAir && !player.transitionAir.transferring;
    const blendRate = vertActive ? 5.5 : 7.5;
    const vertTarget = vertActive ? 1 : 0;
    this.vertBlend += (vertTarget - this.vertBlend) * (1 - Math.exp(-blendRate * dt));

    // Momentum is the camera authority. This deliberately ignores deck heading
    // while moving, which prevents the camera from orbiting 180 degrees when the
    // rider lands switch/fakie.
    let forward = resolveTravelFollowDirection(player, this.direction, this.initialized);
    if (vertActive) {
      // View from the ramp side toward coping. This frame is stable through 180/360 board spins.
      const lipForward = player.transitionAir.frame.deckOutward.clone();
      lipForward.y = 0;
      if (lipForward.lengthSq() > 0.001) forward.copy(lipForward).normalize();
    }

    const orbit = forward.clone().applyAxisAngle(UP, this.yawOffset * (1 - this.vertBlend * 0.45));
    const ratio = Math.min(Math.abs(player.speed) / player.config.maxSpeed, 1);
    if (!this.initialized) this.direction.copy(orbit);
    this.direction.lerp(orbit, 1 - Math.exp(-(vertActive ? 5.8 : 4) * dt)).normalize();

    const frame = player.transitionAir?.frame;
    const heightAboveLip = frame ? Math.max(0, player.position.y - frame.lipPoint.y) : 0;
    const anchor = player.position.clone().addScaledVector(UP, 1.15 + this.vertBlend * 0.32);
    const distance = 5.1 + ratio * 1.5 + this.vertBlend * 1.65;
    const height = 2.1 + this.pitchOffset * 4.1 + this.vertBlend * (1.1 + Math.min(1.4, heightAboveLip * 0.22));
    const desired = anchor.clone().addScaledVector(this.direction, -distance).addScaledVector(UP, height);

    const normalLook = anchor.clone().addScaledVector(this.direction, 1.4).addScaledVector(UP, -this.pitchOffset * 0.85);
    let look = normalLook;
    if (frame) {
      const contextLook = player.position.clone().lerp(frame.lipPoint, 0.28)
        .addScaledVector(UP, 0.95 + Math.min(0.8, heightAboveLip * 0.15));
      look = normalLook.clone().lerp(contextLook, this.vertBlend);
    }

    if (!this.initialized) {
      this.position.copy(desired); this.target.copy(look); this.initialized = true;
    }
    this.position.lerp(desired, 1 - Math.exp(-(vertActive ? 5.5 : 7) * dt));
    this.target.lerp(look, 1 - Math.exp(-10 * dt));
    this.camera.position.copy(player.surface.camera(anchor, this.position));
    this.camera.lookAt(this.target);
  }
}
