import { MathUtils } from 'three';

// Original procedural timings, shared by the deck and the rider. These are not
// imported animation clips or timings extracted from a commercial game's data.
export const FLIP_TIMING = Object.freeze({ pop: 0.14, flick: 0.34, rotationEnd: 0.82, catchEnd: 0.94 });

export function flipMotion(progress = 0) {
  const p = MathUtils.clamp(progress, 0, 1);
  const rotation = MathUtils.smoothstep(p, 0.12, FLIP_TIMING.rotationEnd);
  const lift = MathUtils.smoothstep(p, 0, FLIP_TIMING.flick);
  const catchWeight = MathUtils.smoothstep(p, FLIP_TIMING.rotationEnd, FLIP_TIMING.catchEnd);
  const clearance = lift * (1 - catchWeight);
  const flick = MathUtils.smoothstep(p, FLIP_TIMING.pop, FLIP_TIMING.flick)
    * (1 - MathUtils.smoothstep(p, 0.56, FLIP_TIMING.rotationEnd));
  return { rotation, clearance, footLift: clearance * 0.22, flick, catchWeight };
}

export function flipTurns(flipState) {
  const progress = MathUtils.clamp(flipState?.progress || 0, 0, 1);
  const rotation = flipMotion(progress).rotation;
  const start = flipState?.rotationStartProgress;
  const upgrading = Number.isFinite(start) && flipState?.rotationFrom;
  const blend = upgrading
    ? MathUtils.smoothstep(progress, start, Math.max(start + 0.01, FLIP_TIMING.rotationEnd))
    : rotation;
  const turns = {};
  for (const axis of ['pitch', 'yaw', 'roll']) {
    turns[axis] = MathUtils.lerp(upgrading ? flipState.rotationFrom[axis] || 0 : 0, flipState?.[axis] || 0, blend);
  }
  return turns;
}

// The foot sweeps backwards while planted, then returns above the deck. Keeping
// one continuous phase prevents starting each push half way through a stroke.
export function pushMotion(phase = 0) {
  const p = ((phase % 1) + 1) % 1;
  const leave = MathUtils.smoothstep(p, 0, 0.16);
  const recover = MathUtils.smoothstep(p, 0.58, 0.92);
  const contact = leave * (1 - MathUtils.smoothstep(p, 0.54, 0.68));
  const sweep = MathUtils.smoothstep(p, 0.18, 0.6);
  return {
    side: 0.11 * leave * (1 - recover),
    height: -0.13 * contact + 0.08 * Math.sin(Math.PI * recover),
    foreAft: MathUtils.lerp(-0.15, 0.27, sweep) * leave * (1 - recover),
    contact,
  };
}

export function popMotion(progress = 1) {
  const p = MathUtils.clamp(progress, 0, 1);
  return -0.26 * Math.sin(Math.PI * p) * (1 - MathUtils.smoothstep(p, 0.6, 1));
}

export function landingMotion(progress = 1) {
  const p = MathUtils.clamp(progress, 0, 1);
  return MathUtils.smoothstep(p, 0, 0.2) * (1 - MathUtils.smoothstep(p, 0.2, 1));
}

export const GRAB_POSES = Object.freeze({
  Indy: [-0.12, 0, 0.12], Melon: [-0.16, 0, -0.14],
  Nosegrab: [0.23, 0, 0], Tailgrab: [-0.23, 0, 0],
  Japan: [-0.18, 0.12, -0.28], Madonna: [0.18, -0.08, 0.12],
  Benihana: [-0.22, 0.1, 0.1], Airwalk: [0.08, 0, 0],
});
