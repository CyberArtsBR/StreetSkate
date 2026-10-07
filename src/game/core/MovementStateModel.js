import { MOVEMENT_STATE } from '../StreetPhysics.js';

/**
 * One deterministic movement-mode decision from observable gameplay state.
 * Priority is intentional: bail > grind > wallride > grounded/manual > vert air > air.
 */
export function resolveMovementMode(runtime = {}) {
  if (Number(runtime.bailTime || 0) > 0) return MOVEMENT_STATE.BAIL;
  if (runtime.grind) return MOVEMENT_STATE.GRIND;
  if (runtime.wallRide) return MOVEMENT_STATE.WALLRIDE;
  if (runtime.grounded) return runtime.manual ? MOVEMENT_STATE.MANUAL : MOVEMENT_STATE.GROUND;
  if (runtime.transitionAir) return MOVEMENT_STATE.VERT_AIR;
  return MOVEMENT_STATE.AIR;
}
