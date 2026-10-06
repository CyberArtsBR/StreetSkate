import * as THREE from 'three';
import { PlayerState, deckForwardFromHeading } from './PlayerState.js';

const EPSILON = 1e-8;
export const STATE_INVARIANT_CONFIG = Object.freeze({
  travelSpeedThreshold: 0.25,
  rollingSignThreshold: 0.18,
});

function horizontalVelocity(controller, out = new THREE.Vector3()) {
  out.set(
    Number(controller?.velocity?.x) || 0,
    0,
    Number(controller?.velocity?.z) || 0,
  );
  return out;
}

function addViolation(list, code, details = {}) {
  list.push({ code, ...details });
}

/**
 * Shadow-mode migration validator.
 *
 * This function is deliberately read-only. It compares the legacy inheritance
 * runtime with the new canonical PlayerState model and reports contradictions,
 * but never repairs them. Once replay parity is proven, these violations become
 * removal targets for the duplicated legacy writers.
 */
export function legacyStateViolations(
  controller,
  canonicalState = new PlayerState().syncFromLegacy(controller),
  config = STATE_INVARIANT_CONFIG,
) {
  const violations = [];
  const mode = controller?.movementState ?? null;
  const grounded = Boolean(controller?.grounded);
  const manual = controller?.manual ?? null;
  const transitionAir = controller?.transitionAir ?? null;

  const groundMode = mode === 'GROUND' || mode === 'MANUAL';
  if (grounded !== groundMode) {
    addViolation(violations, 'GROUND_MODE_MISMATCH', { grounded, mode });
  }
  if (mode === 'MANUAL' && !manual) {
    addViolation(violations, 'MANUAL_MODE_WITHOUT_MANUAL', { mode });
  }
  if (manual && grounded && mode !== 'MANUAL') {
    addViolation(violations, 'MANUAL_WITHOUT_MANUAL_MODE', { mode, manual });
  }
  if (transitionAir && !grounded && mode !== 'VERT_AIR') {
    addViolation(violations, 'TRANSITION_AIR_MODE_MISMATCH', { mode });
  }
  if (mode === 'VERT_AIR' && !transitionAir) {
    addViolation(violations, 'VERT_MODE_WITHOUT_TRANSITION', { mode });
  }
  if (grounded && transitionAir) {
    addViolation(violations, 'GROUNDED_WITH_TRANSITION_AIR', { mode });
  }

  const planarVelocity = horizontalVelocity(controller);
  const planarSpeed = planarVelocity.length();
  if (planarSpeed > config.travelSpeedThreshold) {
    const legacyFakie = Boolean(controller?.fakie);
    if (legacyFakie !== canonicalState.fakie) {
      addViolation(violations, 'FAKIE_DIVERGENCE', {
        legacyFakie,
        canonicalFakie: canonicalState.fakie,
        planarSpeed,
      });
    }
  }

  if (planarSpeed > config.rollingSignThreshold) {
    const deckForward = deckForwardFromHeading(canonicalState.deckHeading);
    const expectedSign = planarVelocity.dot(deckForward) < 0 ? -1 : 1;
    const actualSign = Number(controller?.rollingSign);
    if (Number.isFinite(actualSign) && Math.sign(actualSign || 1) !== expectedSign) {
      addViolation(violations, 'ROLLING_SIGN_DIVERGENCE', {
        legacyRollingSign: actualSign,
        expectedRollingSign: expectedSign,
        planarSpeed,
      });
    }
  }

  const legacyTravel = controller?.travelDirection;
  if (legacyTravel && planarSpeed > config.travelSpeedThreshold) {
    const travel = new THREE.Vector3(
      Number(legacyTravel.x) || 0,
      0,
      Number(legacyTravel.z) || 0,
    );
    if (travel.lengthSq() > EPSILON) {
      travel.normalize();
      const velocityDirection = planarVelocity.clone().normalize();
      if (travel.dot(velocityDirection) < 0.25) {
        addViolation(violations, 'TRAVEL_DIRECTION_STALE', {
          alignment: travel.dot(velocityDirection),
        });
      }
    }
  }

  return violations;
}

export function stateInvariantCodes(violations = []) {
  return violations.map(entry => entry.code);
}
