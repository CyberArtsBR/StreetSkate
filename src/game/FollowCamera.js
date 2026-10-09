import * as THREE from 'three';
import { resolveCameraClearance } from './CameraClearance.js';
import {
  captureCameraState,
  resolveCameraTravelDirection,
} from './core/CameraState.js';

const UP = new THREE.Vector3(0, 1, 0);

export const THPS_CAMERA = Object.freeze({
  // Fixed world-axis view. Only player position translates the gameplay rig.
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
  highSpeedFollowGain: 0.48,
  highSpeedFollowCap: 9,
  speedLookAheadGain: 0.065,
  speedLookAheadCap: 0.85,

  // Classic skate cameras do not instantly orbit behind the rider every time a
  // quarter pipe reverses world travel. Normal carving recenters deliberately;
  // a near-180 travel reversal rotates much more slowly and stays readable.
  directionFollowRate: 4.2,
  reverseDirectionFollowRate: 0.82,
  reverseDotThreshold: -0.18,
  positionFollowRate: 9.5,
  targetFollowRate: 12.0,
  verticalFollowRate: 14,
  vertVerticalFollowRate: 24,
  maximumFollowLag: 1.4,
  classicVertDistance: 3.6,
  classicVertHeight: 4.4,
  classicGrindZoom: 0.94,
  classicTrickZoom: 0.92,
  landingHoldTime: 0.9,
  returnReframeRate: 8,
  reverseReturnReframeRate: 2.4,
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

/**
 * A long camera arm is intentional on the bowl return: shorter, taller rigs
 * become a near top-down shot as the rider crosses the lip. Keep ground and
 * downhill landing visible while retaining high behind-the-skater framing.
 */
export function highFollowFraming({
  grounded = false, transitionReturning = false, wallRideActive = false,
  horizontalSpeed = 0,
} = {}) {
  if (transitionReturning) return { distance: 11.6, height: 5.3, lookAhead: 1.4 };
  const lead = Math.min(THPS_CAMERA.speedLookAheadCap,
    Math.max(0, horizontalSpeed) * THPS_CAMERA.speedLookAheadGain);
  if (wallRideActive) return { distance: 10.5, height: 6.1, lookAhead: 0.8 + lead };
  if (grounded) return { distance: 9.5, height: 5.4, lookAhead: 0.55 + lead };
  return { distance: 10.5, height: 5.8, lookAhead: 0.75 + lead };
}

/** Backward-compatible helper now delegated to canonical CameraState. */
export function resolveTravelFollowDirection(player, previousDirection = null, initialized = true) {
  return resolveCameraTravelDirection(player, previousDirection, initialized);
}

/**
 * Deterministic fixed camera frame. Speed, stance, jump state and vert state do
 * not change the distance or pitch unless the caller supplies a different frame
 * configuration. The first argument can be gameplay or CameraState because
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
    this.mode = 'follow';
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.direction = new THREE.Vector3(0, 0, -1);
    this.vertDirection = this.direction.clone();
    this.wasReturning = false;
    this.returnHold = 0;
    this.distance = THPS_CAMERA.distance;
    this.height = THPS_CAMERA.height;
    this.occlusionDistance = null;
    this.occlusionActive = false;
    this.clearanceCache = { fixedAxis: true };
    this.initialized = false;
    this.lookYaw = 0;
    this.lookTilt = 0;
    this.lookHold = 0;
    this.trickZoomActive = false;
    this.zoom = 1;
    this.lookAhead = 0;
  }

  setMode(mode, player = null) {
    this.mode = ['follow', 'classic', 'fixed'].includes(mode) ? mode : 'follow';
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    if (player) this.snap(player);
  }

  snap(player) {
    this.clearanceCache = { fixedAxis: this.mode === 'fixed' };
    this.initialized = false;
    this.wasReturning = false;
    this.returnHold = 0;
    this.distance = THPS_CAMERA.distance;
    this.height = THPS_CAMERA.height;
    this.occlusionDistance = null;
    this.occlusionActive = false;
    this.lookYaw = 0; this.lookTilt = 0; this.lookHold = 0;
    this.trickZoomActive = false; this.zoom = 1;
    this.lookAhead = 0;
    this.update(player, 1, {});
  }

  update(player, dt, input = {}) {
    dt = THREE.MathUtils.clamp(Number(dt) || 0, 0, 0.1);
    const state = captureCameraState(player, {
      previousDirection: this.direction,
      initialized: this.initialized,
    });
    const classic = this.mode !== 'fixed';
    const highFollow = this.mode === 'follow';
    const returning = state.transitionReturning;
    if (classic) {
      if (!this.initialized) this.direction.copy(state.travelDirection);
      if (returning && !this.wasReturning) {
        this.vertDirection.copy(highFollow && state.returnDirection ? state.returnDirection : this.direction);
        if (highFollow) { this.lookYaw = 0; this.lookTilt = 0; this.lookHold = 0; }
      }
      if (returning) this.returnHold = THPS_CAMERA.landingHoldTime;
      else {
        // Keep the chosen return side through touchdown. Release only into
        // matching downhill travel or deliberate player steering, never a stale
        // uphill heading from the coping contact.
        const aligned = state.travelDirection.dot(this.vertDirection) > 0.5;
        // A mismatched downhill vector must never latch the camera on the
        // old vert side forever. Deliberate steering/alignment clears it sooner.
        const deliberateExit = aligned || Math.abs(input.steer || 0) > 0.25
          || state.grindActive || input.vertExit;
        this.returnHold = Math.max(0, this.returnHold - dt * (deliberateExit ? 2 : 1));
      }
      // High Follow anticipates the downhill return as soon as vert air begins.
      // Classic retains its original ramp-side framing. Trick spins steer neither.
      if (returning || this.returnHold > 0) {
        if (highFollow) {
          // Even a true 180-degree coping reversal must not whip the camera.
          const reverse = this.direction.dot(this.vertDirection) < THPS_CAMERA.reverseDotThreshold;
          const rate = reverse ? THPS_CAMERA.reverseReturnReframeRate : THPS_CAMERA.returnReframeRate;
          this.direction.copy(smoothCameraDirection(this.direction, this.vertDirection, dt, rate));
        } else this.direction.copy(this.vertDirection);
      }
      else if (!state.bailing) this.direction.copy(smoothCameraDirection(
        this.direction, state.travelDirection, dt,
        cameraDirectionRate(this.direction, state.travelDirection)));
      if (returning && state.doingTrick) this.trickZoomActive = true;
      if (!returning) this.trickZoomActive = false;
      const zoomTarget = highFollow ? 1 : this.trickZoomActive ? THPS_CAMERA.classicTrickZoom
        : state.grindActive ? THPS_CAMERA.classicGrindZoom : 1;
      this.zoom = THREE.MathUtils.lerp(this.zoom, zoomTarget, 1 - Math.exp(-5 * dt));
      const highFrame = highFollow ? highFollowFraming({ ...state, transitionReturning: returning || this.returnHold > 0 }) : null;
      const distance = highFollow ? highFrame.distance
        : returning ? THPS_CAMERA.classicVertDistance
        : state.grounded || state.grindActive ? THPS_CAMERA.distance : THPS_CAMERA.airDistance;
      const height = highFollow ? highFrame.height
        : returning ? THPS_CAMERA.classicVertHeight
        : state.grounded || state.grindActive ? THPS_CAMERA.height : THPS_CAMERA.airHeight;
      const blend = this.initialized ? 1 - Math.exp(-THPS_CAMERA.contextFollowRate * dt) : 1;
      this.distance = THREE.MathUtils.lerp(this.distance, distance * this.zoom, blend);
      this.height = THREE.MathUtils.lerp(this.height, height, blend);
      if (input.cameraActive && !returning) {
        this.lookYaw -= (input.mouseDX || 0) * 0.004 + (input.cameraX || 0) * dt * 2.1;
        this.lookTilt = THREE.MathUtils.clamp(this.lookTilt
          + (input.mouseDY || 0) * 0.003 + (input.cameraY || 0) * dt, -0.45, 0.65);
        this.lookHold = 1.2;
      } else {
        this.lookHold = returning ? 0 : Math.max(0, this.lookHold - dt);
        if (!this.lookHold) {
          this.lookYaw = wrapAngle(this.lookYaw) * Math.exp(-4 * dt);
          this.lookTilt *= Math.exp(-4 * dt);
        }
      }
    } else {
      this.direction.set(0, 0, -1);
      this.distance = THPS_CAMERA.distance;
      this.height = THPS_CAMERA.height;
    }
    this.wasReturning = returning;
    if (!this.initialized) this.followCenter = state.position.clone();
    else {
      // Fast cruises need a faster tripod, not an ever-growing lag behind a
      // 20+ m/s skater. Exponential damping remains stable across frame rates.
      const followRate = THPS_CAMERA.positionFollowRate + Math.min(
        THPS_CAMERA.highSpeedFollowCap,
        state.horizontalSpeed * THPS_CAMERA.highSpeedFollowGain,
      );
      const horizontal = 1 - Math.exp(-followRate * dt);
      const vertical = 1 - Math.exp(-(returning
        ? THPS_CAMERA.vertVerticalFollowRate : THPS_CAMERA.verticalFollowRate) * dt);
      this.followCenter.x = THREE.MathUtils.lerp(this.followCenter.x, state.position.x, horizontal);
      this.followCenter.z = THREE.MathUtils.lerp(this.followCenter.z, state.position.z, horizontal);
      this.followCenter.y = THREE.MathUtils.lerp(this.followCenter.y, state.position.y, vertical);
      const lag = this.followCenter.clone().sub(state.position);
      if (lag.length() > THPS_CAMERA.maximumFollowLag) {
        this.followCenter.copy(state.position).add(lag.setLength(THPS_CAMERA.maximumFollowLag));
      }
    }
    const viewDirection = this.direction.clone();
    if (classic) viewDirection.applyAxisAngle(UP, this.lookYaw);
    const lookAheadTarget = highFollow ? highFollowFraming({ ...state, transitionReturning: returning || this.returnHold > 0 }).lookAhead : classic && !returning ? 0.55 : 0;
    this.lookAhead = classic ? THREE.MathUtils.lerp(this.lookAhead, lookAheadTarget,
      this.initialized ? 1 - Math.exp(-8 * dt) : 1) : 0;
    const frame = fixedChaseFrame({ position: this.followCenter }, viewDirection,
      { ...THPS_CAMERA, distance: this.distance,
        height: this.height + (classic ? this.lookTilt * 3 : 0),
        lookAhead: this.lookAhead });
    this.position.copy(frame.desired);
    this.target.copy(frame.target);
    this.initialized = true;

    // The tripod is intentionally smoothed, but all clearance rays originate
    // at the real rider, so follow lag never conceals a camera/character overlap.
    const riderAnchor = state.position.clone().addScaledVector(UP, THPS_CAMERA.anchorHeight);
    const minArm = state.wallRideActive ? 3.3 : 2.35;
    this.clearanceCache.fixedAxis = highFollow || this.mode === 'fixed';
    this.clearanceCache.minimumDistance = minArm;
    const resolvedPosition = resolveCameraClearance(
      player?.surface, riderAnchor, this.position, this.camera.position, this.clearanceCache,
    );
    const eyeOffset = resolvedPosition.clone().sub(riderAnchor);
    const clearDistance = eyeOffset.length();
    const clipped = resolvedPosition.distanceToSquared(this.position) > 0.0001;

    // Occlusion gets out of the way immediately and releases smoothly. Never
    // expand the collision-verified eye vector beyond the resolved distance:
    // that would put the camera back inside the very wall that shortened it.
    if (this.occlusionDistance === null || clearDistance < this.occlusionDistance) {
      this.occlusionDistance = clearDistance;
    } else {
      this.occlusionDistance = THREE.MathUtils.lerp(this.occlusionDistance, clearDistance,
        1 - Math.exp(-THPS_CAMERA.occlusionReleaseRate * dt));
    }
    const safeDistance = Math.min(clearDistance, this.occlusionDistance);
    if (clearDistance > 1e-8) eyeOffset.multiplyScalar(safeDistance / clearDistance);
    this.occlusionActive = clipped || safeDistance < clearDistance - 0.02;
    this.camera.position.copy(riderAnchor).add(eyeOffset);
    // Even when geometry offers no minimum-clearance solution, never hide the
    // model or choose an untested point through a solid surface.
    if (player?.visual) player.visual.visible = true;
    this.camera.lookAt(this.target);
  }
}
