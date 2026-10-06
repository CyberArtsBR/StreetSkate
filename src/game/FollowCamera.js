import * as THREE from 'three';
import {
  captureCameraState,
  resolveCameraTravelDirection,
} from './core/CameraState.js';

const UP = new THREE.Vector3(0, 1, 0);

export const THPS_CAMERA = Object.freeze({
  // High, wide, fixed-pitch chase view inspired by classic Tony Hawk games.
  // The rig follows world travel, not the deck nose, so a 180 stays visually stable.
  distance: 7.0,
  height: 6.0,
  anchorHeight: 1.15,
  lookAhead: 1.6,
  targetHeight: 0.90,

  // Classic skate cameras do not instantly orbit behind the rider every time a
  // quarter pipe reverses world travel. Normal carving recenters deliberately;
  // a near-180 travel reversal rotates much more slowly and stays readable.
  directionFollowRate: 4.2,
  reverseDirectionFollowRate: 0.82,
  reverseDotThreshold: -0.18,
  positionFollowRate: 9.5,
  targetFollowRate: 12.0,
});

function wrapAngle(value) {
  let result = (value + Math.PI) % (Math.PI * 2);
  if (result < 0) result += Math.PI * 2;
  return result - Math.PI;
}

/**
 * Angular interpolation avoids the classic vector-lerp failure at a 180° change,
 * where opposite vectors shrink toward zero and then suddenly flip. This is the
 * key to keeping the camera on a Tony-Hawk-like side during vert reversals.
 */
export function smoothCameraDirection(current, target, dt, rate) {
  const from = current?.clone?.() || new THREE.Vector3(0, 0, -1);
  const to = target?.clone?.() || new THREE.Vector3(0, 0, -1);
  from.y = 0;
  to.y = 0;
  if (from.lengthSq() < 1e-8) from.set(0, 0, -1);
  if (to.lengthSq() < 1e-8) to.copy(from);
  from.normalize();
  to.normalize();

  const fromYaw = Math.atan2(from.x, from.z);
  const toYaw = Math.atan2(to.x, to.z);
  const delta = wrapAngle(toYaw - fromYaw);
  const alpha = 1 - Math.exp(-Math.max(0, Number(rate) || 0) * Math.max(0, Number(dt) || 0));
  const yaw = fromYaw + delta * alpha;
  return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
}

export function cameraDirectionRate(current, target, config = THPS_CAMERA) {
  const from = current?.clone?.() || new THREE.Vector3(0, 0, -1);
  const to = target?.clone?.() || new THREE.Vector3(0, 0, -1);
  from.y = 0;
  to.y = 0;
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return config.directionFollowRate;
  from.normalize();
  to.normalize();
  return from.dot(to) < config.reverseDotThreshold
    ? config.reverseDirectionFollowRate
    : config.directionFollowRate;
}

/** Backward-compatible helper now delegated to canonical CameraState. */
export function resolveTravelFollowDirection(player, previousDirection = null, initialized = true) {
  return resolveCameraTravelDirection(player, previousDirection, initialized);
}

/**
 * Deterministic fixed camera frame. Speed, stance, jump state and vert state do
 * not change the distance or pitch; only the smoothed world travel direction can
 * rotate it. The first argument can be a gameplay object or CameraState because
 * this frame only consumes its copied `position`.
 */
export function fixedChaseFrame(player, direction, config = THPS_CAMERA) {
  const travel = direction.clone();
  travel.y = 0;
  if (travel.lengthSq() < 1e-8) travel.set(0, 0, -1);
  travel.normalize();

  const anchor = player.position.clone().addScaledVector(UP, config.anchorHeight);
  const desired = anchor.clone()
    .addScaledVector(travel, -config.distance)
    .addScaledVector(UP, config.height);
  const target = player.position.clone()
    .addScaledVector(travel, config.lookAhead)
    .addScaledVector(UP, config.targetHeight);

  return { anchor, desired, target, travel };
}

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.direction = new THREE.Vector3(0, 0, -1);
    this.initialized = false;
  }

  snap(player) {
    this.initialized = false;
    this.update(player, 1, {});
  }

  update(player, dt, input = {}) {
    // Intentionally ignore manual camera orbit/pitch input. The gameplay camera
    // owns one fixed aerial angle so spins, fakie and vert never reframe the rider.
    void input;

    const state = captureCameraState(player, {
      previousDirection: this.direction,
      initialized: this.initialized,
    });
    const followDirection = state.travelDirection;
    if (!this.initialized) this.direction.copy(followDirection);
    else {
      const rate = cameraDirectionRate(this.direction, followDirection);
      this.direction.copy(smoothCameraDirection(this.direction, followDirection, dt, rate));
    }

    const frame = fixedChaseFrame(state, this.direction);
    if (!this.initialized) {
      this.position.copy(frame.desired);
      this.target.copy(frame.target);
      this.initialized = true;
    } else {
      this.position.lerp(
        frame.desired,
        1 - Math.exp(-THPS_CAMERA.positionFollowRate * dt),
      );
      this.target.lerp(
        frame.target,
        1 - Math.exp(-THPS_CAMERA.targetFollowRate * dt),
      );
    }

    // Occlusion stays a presentation-only query against the collision surface.
    const resolvedPosition = player?.surface?.camera
      ? player.surface.camera(frame.anchor, this.position)
      : this.position;
    this.camera.position.copy(resolvedPosition);
    this.camera.lookAt(this.target);
  }
}
