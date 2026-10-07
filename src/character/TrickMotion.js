import { MathUtils } from 'three';

// Original procedural timing: prepare, rotate, catch. Shared by feet and deck.
export function flipMotion(progress = 0) {
  const p = MathUtils.clamp(progress, 0, 1);
  const rotation = MathUtils.smoothstep(p, 0.12, 0.82);
  const clearance = Math.sin(Math.PI * MathUtils.smoothstep(p, 0, 0.94));
  return { rotation, clearance, footLift: clearance * 0.24 };
}

export const GRAB_POSES = Object.freeze({
  Indy: [-0.12, 0, 0.12], Melon: [-0.16, 0, -0.14],
  Nosegrab: [0.23, 0, 0], Tailgrab: [-0.23, 0, 0],
  Japan: [-0.18, 0.12, -0.28], Madonna: [0.18, -0.08, 0.12],
  Benihana: [-0.22, 0.1, 0.1], Airwalk: [0.08, 0, 0],
});
