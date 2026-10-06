import * as THREE from 'three';
import { IntegratedRampSafetySkillStreetPhysics } from './IntegratedRampSafetySkillStreetPhysics.js';
import { PHYSICS } from './StreetPhysics.js';
import { LANDING_ROUTE, resolveLandingRoute } from './landing/LandingPolicy.js';

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

/** Choose horizontal launch speed from real target distance and airtime. */
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
 */
export class DeckAwareRampExitSkillStreetPhysics extends IntegratedRampSafetySkillStreetPhysics {
  takeoff(impulse = 0, transition = null) {
    super.takeoff(impulse, transition);
    const air = this.transitionAir;
    if (!air?.transferring || !air.frame || !air.exitControl) return;

    const deck = scanDeckTransferTarget(this.surface, air.frame);
    if (!deck) {
      // No verified deck behind this coping: holding Up must never launch into
      // empty space. Keep a controlled same-wall return regardless of held Up.
      air.exitControl = {
        geometryAware: true,
        abortToReturn: true,
        targetPoint: air.frame.returnTarget.clone(),
      };
      air.mode = 'return';
      const tangent = air.frame.copingTangent.clone()
        .multiplyScalar((air.lateralVelocity || 0) * 0.35);
      const inward = air.frame.rampInward.clone().multiplyScalar(0.34).add(tangent);
      this.velocity.x = inward.x;
      this.velocity.z = inward.z;
      return;
    }

    const verticalSpeed = clamp(air.exitControl.verticalSpeed,
      DECK_AWARE_EXIT.launchVerticalMin, DECK_AWARE_EXIT.launchVerticalMax);
    const horizontalSpeed = deckAwareLaunchSpeed(deck.targetDistance, verticalSpeed);
    air.exitControl = {
      ...air.exitControl,
      ...deck,
      geometryAware: true,
      abortToReturn: false,
      horizontalSpeed,
      verticalSpeed,
    };
    air.launchVertical = verticalSpeed;

    const towardTarget = horizontal(deck.targetPoint.clone().sub(air.frame.lipPoint));
    if (towardTarget.lengthSq() < 1e-8) towardTarget.copy(deck.direction);
    towardTarget.normalize();
    const lateral = air.frame.copingTangent.clone()
      .multiplyScalar((air.lateralVelocity || 0) * 0.10);
    const launch = towardTarget.multiplyScalar(horizontalSpeed).add(lateral);
    this.velocity.x = launch.x;
    this.velocity.z = launch.z;
    this.velocity.y = verticalSpeed;
    air.launchHorizontal = launch.clone();
  }

  advanceControlledTransfer(air, dt) {
    const control = air?.exitControl;
    if (!control?.geometryAware) {
      super.advanceControlledTransfer(air, dt);
      return;
    }

    air.age += dt;
    if (this.velocity.y <= 0) air.apexPassed = true;

    if (control.abortToReturn) {
      const current = horizontal(this.velocity);
      let desired;
      if (!air.apexPassed) {
        desired = air.frame.rampInward.clone().multiplyScalar(0.30)
          .addScaledVector(air.frame.copingTangent,
            (air.lateralVelocity || 0) * Math.exp(-1.8 * air.age) * 0.25);
      } else {
        desired = horizontal(air.frame.returnTarget.clone().sub(this.position)).multiplyScalar(4.4);
        if (desired.length() > 5.6) desired.setLength(5.6);
      }
      const delta = desired.clone().sub(current);
      const maxDelta = (air.apexPassed ? 24 : 10) * dt;
      if (delta.length() > maxDelta) delta.setLength(maxDelta);
      const next = current.add(delta);
      this.velocity.x = next.x;
      this.velocity.z = next.z;
      air.returnError = horizontal(air.frame.returnTarget.clone().sub(this.position)).length();
      return;
    }

    const target = control.targetPoint;
    const toTarget = horizontal(target.clone().sub(this.position));
    const distance = toTarget.length();
    let desired = new THREE.Vector3();
    if (distance > 1e-5) {
      const desiredSpeed = air.apexPassed
        ? clamp(distance * 3.0, 0.20, 2.25)
        : clamp(distance * 2.0, 0.55, control.horizontalSpeed);
      desired.copy(toTarget).multiplyScalar(desiredSpeed / distance);
    }

    const current = horizontal(this.velocity);
    const delta = desired.sub(current);
    const maxDelta = (air.apexPassed ? 36 : 24) * dt;
    if (delta.length() > maxDelta) delta.setLength(maxDelta);
    const next = current.add(delta);
    this.velocity.x = next.x;
    this.velocity.z = next.z;
    air.returnError = distance;
  }

  land(support) {
    const air = this.transitionAir;
    const control = air?.exitControl;
    const deckTargetMatches = supportMatchesDeckTarget(support, air);
    const route = resolveLandingRoute({
      geometryAware: Boolean(control?.geometryAware),
      abortToReturn: Boolean(control?.abortToReturn),
      deckTargetMatches,
    });

    if (route === LANDING_ROUTE.ABORT_TO_RETURN) {
      const transferring = air.transferring;
      air.transferring = false;
      const landed = super.land(support);
      if (!landed && this.transitionAir === air) air.transferring = transferring;
      return landed;
    }

    if (route === LANDING_ROUTE.REJECT_DECK_TARGET) return false;
    return super.land(support);
  }

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
