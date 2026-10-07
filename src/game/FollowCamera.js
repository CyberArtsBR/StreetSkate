import * as THREE from 'three';
import { resolveCameraClearance } from './CameraClearance.js';
import {
  captureCameraState,
  resolveCameraTravelDirection,
} from './core/CameraState.js';

const UP = new THREE.Vector3(0, 1, 0);

export const THPS_CAMERA = Object.freeze({
  // Lower chase view; movement and vert context own the camera, never trick yaw.
  // The rig follows world travel, not the deck nose, so a 180 stays visually stable.
  distance: 5.8,
  height: 1.55,
  anchorHeight: 1.15,
  lookAhead: 1.1,
  targetHeight: 1.0,
  airDistance: 6.5,
  airHeight: 2.2,
  vertDistance: 6.8,
  vertHeight: 2.6,
  contextFollowRate: 5,
  returnHoldTime: 0.35,
  occlusionReleaseRate: 4,

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
    this.vertDirection = this.direction.clone();
    this.wasReturning = false;
    this.returnHold = 0;
    this.distance = THPS_CAMERA.distance;
    this.height = THPS_CAMERA.height;
    this.occlusionDistance = null;
    this.initialized = false;
  }

  snap(player) {
    this.initialized = false;
    this.wasReturning = false;
    this.returnHold = 0;
    this.distance = THPS_CAMERA.distance;
    this.height = THPS_CAMERA.height;
    this.occlusionDistance = null;
    this.update(player, 1, {});
  }

  update(player, dt, input = {}) {
    // Automatic chase follows travel with contextual air framing; deck spins and
    // stance changes never orbit the camera around the rider.
    void input;

    const state = captureCameraState(player, {
      previousDirection: this.direction,
      initialized: this.initialized,
    });
    if (state.transitionReturning && !this.wasReturning) this.vertDirection.copy(this.direction);
    if (!state.transitionReturning && this.wasReturning) this.returnHold = THPS_CAMERA.returnHoldTime;
    this.wasReturning = state.transitionReturning;
    this.returnHold = Math.max(0, this.returnHold - dt);
    const holdSide = state.transitionReturning || (state.grounded && this.returnHold > 0);
    const followDirection = holdSide ? this.vertDirection : state.travelDirection;
    if (!this.initialized) this.direction.copy(followDirection);
    else {
      const rate = cameraDirectionRate(this.direction, followDirection);
      this.direction.copy(smoothCameraDirection(this.direction, followDirection, dt, rate));
    }

    const desiredDistance = state.transitionReturning ? THPS_CAMERA.vertDistance
      : !state.grounded ? THPS_CAMERA.airDistance : THPS_CAMERA.distance;
    const desiredHeight = state.transitionReturning ? THPS_CAMERA.vertHeight
      : !state.grounded ? THPS_CAMERA.airHeight : THPS_CAMERA.height;
    const contextBlend = this.initialized ? 1 - Math.exp(-THPS_CAMERA.contextFollowRate * dt) : 1;
    this.distance = THREE.MathUtils.lerp(this.distance, desiredDistance, contextBlend);
    this.height = THREE.MathUtils.lerp(this.height, desiredHeight, contextBlend);
    const frame = fixedChaseFrame(state, this.direction, {
      ...THPS_CAMERA, distance: this.distance, height: this.height,
      lookAhead: holdSide ? 0.25 : THPS_CAMERA.lookAhead,
    });
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
    let resolvedPosition = resolveCameraClearance(player?.surface, frame.anchor,
      this.position, this.camera.position);
    const easedEye = this.camera.position.clone().lerp(resolvedPosition,
      1 - Math.exp(-12 * dt));
    const easedClear = player?.surface?.camera
      ? player.surface.camera(frame.anchor, easedEye) : easedEye;
    if (easedClear.distanceTo(frame.anchor) >= 1.8) resolvedPosition = easedClear;
    const eyeOffset = resolvedPosition.clone().sub(frame.anchor);
    const clearDistance = resolvedPosition.distanceTo(frame.anchor);
    if (clearDistance >= 1.8 && this.occlusionDistance !== null) {
      this.occlusionDistance = Math.max(1.8, this.occlusionDistance);
    }
    if (this.occlusionDistance === null || clearDistance < this.occlusionDistance) {
      this.occlusionDistance = clearDistance;
    } else {
      this.occlusionDistance = THREE.MathUtils.lerp(this.occlusionDistance, clearDistance,
        1 - Math.exp(-THPS_CAMERA.occlusionReleaseRate * dt));
    }
    if (eyeOffset.lengthSq() > 1e-8) eyeOffset.setLength(Math.min(clearDistance, this.occlusionDistance));
    this.camera.position.copy(frame.anchor).add(eyeOffset);
    // Exceptional enclosed spaces must not fill the view with the inside of a
    // face/hat. This changes presentation only and recovers as soon as space opens.
    if (player?.visual) player.visual.visible = this.camera.position.distanceTo(frame.anchor) > 1.15;
    this.camera.lookAt(this.target);
  }
}
