import * as THREE from 'three';

function horizontal(vector) {
  return vector.clone().setY(0);
}

/**
 * Verify that a support belongs to the same authored transition that launched
 * the active vert-air state. This is geometry evidence only; it never mutates
 * gameplay orientation or velocity.
 */
export function supportMatchesOriginalTransition(support, air, config) {
  if (!support?.position || !support?.normal || !air?.frame?.lipPoint
    || !air?.frame?.deckOutward || !air?.frame?.rampInward || !config) return false;

  const ny = Math.abs(support.normal.y);
  if (ny < config.recoveryNormalMinY || ny > config.recoveryNormalMaxY) return false;

  const outward = horizontal(air.frame.deckOutward);
  const inward = horizontal(air.frame.rampInward);
  if (outward.lengthSq() < 1e-8 || inward.lengthSq() < 1e-8) return false;
  outward.normalize();
  inward.normalize();

  const fromLip = support.position.clone().sub(air.frame.lipPoint);
  const tangent = air.frame.copingTangent?.clone?.();
  if (tangent?.lengthSq?.() > 1e-8 && Number.isFinite(config.contactCorridor)) {
    tangent.y = 0;
    if (tangent.lengthSq() > 1e-8) {
      tangent.normalize();
      const lateral = horizontal(fromLip).dot(tangent);
      if (Math.abs(lateral) > config.contactCorridor) return false;
    }
  }

  const signedOutward = horizontal(fromLip).dot(outward);
  if (signedOutward > config.recoveryOutwardMax
    || signedOutward < -config.recoveryInwardMax) return false;

  const dy = support.position.y - air.frame.lipPoint.y;
  if (dy > config.recoveryAboveLip || dy < -config.recoveryBelowLip) return false;

  const horizontalNormal = horizontal(support.normal);
  if (horizontalNormal.lengthSq() < 1e-8) return false;
  horizontalNormal.normalize();
  if (horizontalNormal.dot(inward) < config.recoveryNormalAlignment) return false;

  return true;
}

export function originalTransitionSweep(surface, from, to, air, config) {
  if (!surface?.sweepRideable || !from || !to || !air?.frame || !config) return null;
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const hit = surface.sweepRideable(
    from,
    to,
    point,
    normal,
    config.continuousSweepExtra,
  );
  if (!hit) return null;
  const candidate = { position: point.clone(), normal: normal.clone() };
  if (!supportMatchesOriginalTransition(candidate, air, config)) return null;
  return {
    point: point.clone(),
    normal: normal.clone(),
    fraction: hit.fraction ?? 1,
  };
}

export function makeEmergencyTransitionSupport({
  hit,
  velocity,
  forward,
  contactSkin = 0.018,
} = {}) {
  if (!hit?.normal?.clone || !hit?.point?.clone) return null;
  const normal = hit.normal.clone().normalize();
  const position = hit.point.clone().addScaledVector(normal, contactSkin);
  const leadingFront = (velocity?.dot?.(forward) || 0) >= 0;
  return {
    supported: true,
    count: 1,
    frontSupported: leadingFront ? 1 : 0,
    rearSupported: leadingFront ? 0 : 1,
    position,
    supportPoint: hit.point.clone(),
    normal,
    maxWheelGap: 0,
    contacts: [],
  };
}

export function continuousReentryEligible({
  activeAir,
  grounded = false,
  sameAir = true,
  velocityY = 0,
} = {}) {
  if (!activeAir?.frame || grounded || !sameAir) return false;
  return Boolean(activeAir.apexPassed || velocityY <= 0.8);
}

/**
 * First continuous re-entry candidate: the real board-contact solver with a
 * transition-oriented support basis.
 */
export function resolveWheelReentryCandidate({
  activeAir,
  grounded = false,
  sameAir = true,
  velocityY = 0,
  contact,
  before,
  position,
  heading = 0,
  referenceNormal,
  velocity,
  config,
} = {}) {
  if (!continuousReentryEligible({ activeAir, grounded, sameAir, velocityY })) return null;
  if (!contact?.solveLanding || !before || !position || !velocity || !config) return null;

  const normal = referenceNormal?.clone?.()
    || activeAir.frame.surfaceNormal?.clone?.()
    || new THREE.Vector3(0, 1, 0);
  if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
  normal.normalize();

  const support = contact.solveLanding(
    before,
    position,
    heading,
    normal,
    velocity,
  );
  if (!support?.supported || !supportMatchesOriginalTransition(support, activeAir, config)) return null;
  return Object.freeze({
    source: 'wheel-sweep',
    support,
  });
}

/**
 * Hard anti-tunnelling fallback. The center sweep only becomes a landing
 * candidate when its hit belongs to the same authored transition; otherwise it
 * returns null and cannot steal contact from another ramp/floor.
 */
export function resolveSweepReentryCandidate({
  activeAir,
  surface,
  contact,
  before,
  position,
  heading = 0,
  velocity,
  forward,
  config,
} = {}) {
  if (!activeAir?.frame || !surface || !contact || !before || !position || !velocity || !config) return null;

  const hit = originalTransitionSweep(surface, before, position, activeAir, config);
  if (!hit) return null;

  const candidate = hit.point.clone().addScaledVector(
    hit.normal,
    config.continuousContactSkin,
  );
  const resolved = contact.solveGround?.(
    candidate,
    before,
    heading,
    hit.normal,
    false,
  );

  let support = resolved?.supported && resolved.position?.distanceTo?.(candidate) <= 0.18
    ? resolved
    : null;
  if (!support || !supportMatchesOriginalTransition(support, activeAir, config)) {
    support = makeEmergencyTransitionSupport({
      hit,
      velocity,
      forward,
      contactSkin: config.continuousContactSkin,
    });
  }
  if (!support) return null;

  return Object.freeze({
    source: 'center-sweep',
    hit,
    candidate,
    support,
  });
}
