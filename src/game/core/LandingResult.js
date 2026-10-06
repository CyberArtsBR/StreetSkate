import * as THREE from 'three';

export const LANDING_REJECT_REASON = Object.freeze({
  YOUNG_UPWARD: 'YOUNG_UPWARD',
  SUPPORT: 'SUPPORT',
  CORRECTION: 'CORRECTION',
  BOARD_FORWARD: 'BOARD_FORWARD',
  ALIGNMENT: 'ALIGNMENT',
  FLIP: 'FLIP',
});

export function transitionLandingSupportMode(support) {
  const count = support?.count || 0;
  const front = Boolean(support?.frontSupported);
  const rear = Boolean(support?.rearSupported);
  if (count < 1) return 'reject';
  if (count >= 2 && front && rear) return 'full';

  const normalY = Math.abs(support?.normal?.y ?? 1);
  if (normalY < 0.995 && (front || rear)) {
    if (count >= 2) return 'truckFirst';
    return 'wheelFirst';
  }
  return 'reject';
}

export function transitionFlipLandingMode(progress, normalY = 1, contactMode = 'full') {
  if (!Number.isFinite(progress)) return 'clear';
  if (progress >= 0.88) return 'clear';

  const mode = contactMode === true ? 'truckFirst' : contactMode;
  const ny = Math.abs(normalY);
  let threshold = 0.62;
  if (ny < 0.90) threshold = 0.28;
  else if (ny < 0.97) threshold = 0.34;
  else if (ny < 0.995) threshold = 0.40;
  if (mode === 'truckFirst') threshold = Math.min(threshold, 0.22);
  if (mode === 'wheelFirst') threshold = Math.min(threshold, 0.18);
  return progress >= threshold ? 'autoCatch' : 'bail';
}

export function transitionAlignmentThreshold(normalY = 1, contactMode = 'full') {
  const mode = contactMode === true ? 'truckFirst' : contactMode;
  const ny = Math.abs(normalY);
  if (mode === 'wheelFirst') return 0.08;
  if (mode === 'truckFirst') return 0.12;
  if (ny < 0.90) return 0.14;
  if (ny < 0.97) return 0.22;
  if (ny < 0.995) return 0.30;
  return 0.44;
}

/**
 * Pure landing decision boundary extracted from the legacy BowlLanding layer.
 * It never mutates physics. The caller applies an accepted result or triggers a
 * bail/reject exactly as before. This becomes the future BoardContact ->
 * LandingResult seam while Phase 1 still preserves the inheritance runtime.
 */
export function evaluateTransitionLanding({
  support,
  position,
  velocity,
  forward,
  airTime = 0,
  flipProgress = null,
  maxLandingCorrection = 0.22,
} = {}) {
  const verticalSpeed = Number(velocity?.y) || 0;
  if (airTime < 0.075 && verticalSpeed > 0.05) {
    return {
      accepted: false,
      shouldBail: false,
      rejectReason: LANDING_REJECT_REASON.YOUNG_UPWARD,
      supportMode: 'reject',
    };
  }

  const supportMode = transitionLandingSupportMode(support);
  if (supportMode === 'reject' || !support?.position || !support?.normal) {
    return {
      accepted: false,
      shouldBail: false,
      rejectReason: LANDING_REJECT_REASON.SUPPORT,
      supportMode,
    };
  }

  const partialTouchdown = supportMode !== 'full';
  const correction = support.position.clone().sub(position || new THREE.Vector3());
  let correctionLimit = maxLandingCorrection;
  if (supportMode === 'truckFirst') correctionLimit = Math.max(correctionLimit, 0.34);
  if (supportMode === 'wheelFirst') correctionLimit = Math.max(correctionLimit, 0.42);
  if (correction.length() > correctionLimit) {
    return {
      accepted: false,
      shouldBail: false,
      rejectReason: LANDING_REJECT_REASON.CORRECTION,
      supportMode,
      partialTouchdown,
      correction,
      correctionLimit,
    };
  }

  const boardForward = (forward?.clone?.() || new THREE.Vector3(0, 0, -1))
    .projectOnPlane(support.normal);
  if (boardForward.lengthSq() < 1e-7) {
    return {
      accepted: false,
      shouldBail: false,
      rejectReason: LANDING_REJECT_REASON.BOARD_FORWARD,
      supportMode,
      partialTouchdown,
      correction,
      correctionLimit,
    };
  }
  boardForward.normalize();

  const planarVelocity = (velocity?.clone?.() || new THREE.Vector3())
    .projectOnPlane(support.normal);
  const planarSpeed = planarVelocity.length();
  let alignment = 1;
  if (planarSpeed > 0.18) {
    const tangent = planarVelocity.clone().multiplyScalar(1 / planarSpeed);
    alignment = boardForward.dot(tangent);
  }

  const flipMode = Number.isFinite(flipProgress)
    ? transitionFlipLandingMode(flipProgress, support.normal.y, supportMode)
    : 'clear';
  const alignmentThreshold = transitionAlignmentThreshold(support.normal.y, supportMode);
  const alignmentUnsafe = planarSpeed > 0.18 && Math.abs(alignment) < alignmentThreshold;
  const flipUnsafe = flipMode === 'bail';

  if (alignmentUnsafe || flipUnsafe) {
    return {
      accepted: false,
      shouldBail: true,
      rejectReason: flipUnsafe ? LANDING_REJECT_REASON.FLIP : LANDING_REJECT_REASON.ALIGNMENT,
      supportMode,
      partialTouchdown,
      correction,
      correctionLimit,
      boardForward,
      planarVelocity,
      planarSpeed,
      alignment,
      flipMode,
      alignmentThreshold,
    };
  }

  return {
    accepted: true,
    shouldBail: false,
    rejectReason: null,
    supportMode,
    partialTouchdown,
    correction,
    correctionLimit,
    boardForward,
    planarVelocity,
    planarSpeed,
    alignment,
    flipMode,
    alignmentThreshold,
  };
}
