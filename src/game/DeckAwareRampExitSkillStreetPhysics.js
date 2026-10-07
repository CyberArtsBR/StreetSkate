import * as THREE from 'three';
import { RampWallSafetySkillStreetPhysics } from './RampWallSafetySkillStreetPhysics.js';
import { PHYSICS } from './StreetPhysics.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = THREE.MathUtils.clamp;

export const DECK_AWARE_EXIT = Object.freeze({
  scanStart: 0.22,
  scanEnd: 3.0,
  scanStep: 0.16,
  scanHeight: 0.72,
  scanDepth: 1.45,
  deckMinNormalY: 0.93,
  deckHeightTolerance: 0.42,
  minUsableWidth: 0.28,
  edgeMargin: 0.14,
  targetMinFromLip: 0.30,
  targetMaxFromLip: 2.65,
  launchVerticalMin: 4.6,
  launchVerticalMax: 6.2,
  launchHorizontalMin: 0.75,
  launchHorizontalMax: 4.8,
  landingHeightTolerance: 0.34,
  landingCorridorPad: 0.20,
  catchHorizontalRadius: 0.52,
  catchVerticalWindow: 0.46,
});

function horizontal(vector) {
  return vector.clone().setY(0);
}

function nearestSample(samples, distance) {
  let best = samples[0];
  let bestError = Infinity;
  for (const sample of samples) {
    const error = Math.abs(sample.distance - distance);
    if (error < bestError) { best = sample; bestError = error; }
  }
  return best;
}

/**
 * Scan the ACTUAL collision deck behind a coping instead of assuming every ramp
 * has the same deck width. This is important for narrow quarter-pipe platforms.
 */
export function scanDeckTransferTarget(surface, frame, config = DECK_AWARE_EXIT) {
  if (!surface?.ridingMeshes?.length || !frame?.lipPoint || !frame?.deckOutward) return null;

  const outward = horizontal(frame.deckOutward);
  if (outward.lengthSq() < 1e-8) return null;
  outward.normalize();

  const ray = new THREE.Raycaster();
  const normal = new THREE.Vector3();
  const valid = [];
  let foundRun = false;
  let missesAfterRun = 0;

  for (let distance = config.scanStart; distance <= config.scanEnd + 1e-6; distance += config.scanStep) {
    const origin = frame.lipPoint.clone().addScaledVector(outward, distance);
    origin.y = frame.lipPoint.y + config.scanHeight;
    ray.set(origin, DOWN);
    ray.far = config.scanDepth;

    let sample = null;
    for (const hit of ray.intersectObjects(surface.ridingMeshes, false)) {
      if (hit.object?.userData?.railId) continue;
      surface.normal(hit, normal);
      if (normal.y < config.deckMinNormalY) continue;
      if (Math.abs(hit.point.y - frame.lipPoint.y) > config.deckHeightTolerance) continue;
      sample = { distance, point: hit.point.clone(), normal: normal.clone() };
      break;
    }

    if (sample) {
      if (foundRun && missesAfterRun > 0) break;
      foundRun = true;
      missesAfterRun = 0;
      valid.push(sample);
    } else if (foundRun) {
      missesAfterRun += 1;
      if (missesAfterRun >= 1) break;
    }
  }

  if (!valid.length) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const usableWidth = Math.max(config.scanStep, last.distance - first.distance + config.scanStep);
  if (usableWidth < config.minUsableWidth) return null;

  let safeStart = first.distance + config.edgeMargin;
  let safeEnd = last.distance - config.edgeMargin;
  if (safeEnd < safeStart) {
    safeStart = first.distance;
    safeEnd = last.distance;
  }
  let targetDistance = (safeStart + safeEnd) * 0.5;
  targetDistance = clamp(targetDistance, config.targetMinFromLip,
    Math.min(config.targetMaxFromLip, Math.max(config.targetMinFromLip, last.distance)));

  const targetSample = nearestSample(valid, targetDistance);
  return {
    found: true,
    direction: outward,
    startDistance: first.distance,
    endDistance: last.distance,
    usableWidth,
    targetDistance: targetSample.distance,
    targetPoint: targetSample.point.clone(),
    targetNormal: targetSample.normal.clone(),
  };
}

/** Compatibility helper retained for tests/tuning; runtime uses TransferLaunchResult. */
export function deckAwareLaunchSpeed(targetDistance, verticalSpeed, config = DECK_AWARE_EXIT) {
  const vertical = Math.max(0.1, Math.abs(Number(verticalSpeed) || 0));
  const airTime = Math.max(0.28, (2 * vertical) / Math.max(PHYSICS.gravity, 0.1));
  const speed = (Math.max(0, Number(targetDistance) || 0) / airTime) * 1.08;
  return clamp(speed, config.launchHorizontalMin, config.launchHorizontalMax);
}

export function supportMatchesDeckTarget(support, air, config = DECK_AWARE_EXIT) {
  const control = air?.exitControl;
  if (!control?.geometryAware || control.abortToReturn || !control.targetPoint) return true;
  if (!support?.position || !support?.normal) return false;
  if (support.normal.y < config.deckMinNormalY) return false;
  if (Math.abs(support.position.y - control.targetPoint.y) > config.landingHeightTolerance) return false;

  const outward = horizontal(support.position.clone().sub(air.frame.lipPoint))
    .dot(horizontal(air.frame.deckOutward).normalize());
  return outward >= control.startDistance - config.landingCorridorPad
    && outward <= control.endDistance + config.landingCorridorPad;
}

/**
 * Final ramp-exit layer driven by real deck geometry captured from the collision
 * mesh. It prevents narrow quarter-pipe decks from launching the rider off their
 * back edge and rejects lower/outer geometry as a false late landing.
 *
 * Transfer flight stepping is inherited from RampWallSafety, which now owns one
 * canonical TransferFlightResult executor for generic, deck-target and abort-return.
 */
export class DeckAwareRampExitSkillStreetPhysics extends RampWallSafetySkillStreetPhysics {
  stepAir(dt, input, drive, before) {
    const controlledAir = this.transitionAir;
    super.stepAir(dt, input, drive, before);

    if (!controlledAir || this.grounded || this.transitionAir !== controlledAir) return;
    const control = controlledAir.exitControl;
    if (!control?.geometryAware || control.abortToReturn || !control.targetPoint) return;
    if (this.velocity.y > 0) return;

    const horizontalError = horizontal(control.targetPoint.clone().sub(this.position)).length();
    const verticalAboveDeck = this.position.y - control.targetPoint.y;
    if (horizontalError > DECK_AWARE_EXIT.catchHorizontalRadius
      || verticalAboveDeck < -0.08
      || verticalAboveDeck > DECK_AWARE_EXIT.catchVerticalWindow) return;

    // Last-resort four-wheel catch inside the verified deck corridor. This is a
    // short local probe, not a teleport; it prevents a one-frame seam miss from
    // letting the board cross the deck and later bail on geometry underneath.
    const support = this.ensureBoardContact().snapToGround(
      this.position, this.heading, 0.34, 0.48,
    );
    if (support?.supported && supportMatchesDeckTarget(support, controlledAir)) {
      this.land(support);
    }
  }
}
