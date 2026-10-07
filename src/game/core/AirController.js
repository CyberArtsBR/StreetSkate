export const AIR_CONTROL = Object.freeze({
  turnRate: 3.8,
  maxTurnInput: 1,
});

/**
 * Pure fixed-step airborne orientation + gravity.
 * It consumes one already-interpreted player turn command and never reads contact
 * normals, collision geometry, stance, or smoothed ground steering.
 */
export function resolveAirMotion({
  airHeading = 0,
  airSpin = 0,
  turnInput = 0,
  velocityY = 0,
  gravity = 20,
  dt = 0,
  config = AIR_CONTROL,
} = {}) {
  const step = Math.max(0, Number(dt) || 0);
  const turn = Math.max(
    -config.maxTurnInput,
    Math.min(config.maxTurnInput, Number(turnInput) || 0),
  );
  const nextAirSpin = (Number(airSpin) || 0) - turn * config.turnRate * step;
  const heading = (Number(airHeading) || 0) + nextAirSpin;
  const nextVelocityY = (Number(velocityY) || 0)
    - Math.max(0, Number(gravity) || 0) * step;

  return Object.freeze({
    turnInput: turn,
    airSpin: nextAirSpin,
    heading,
    velocityY: nextVelocityY,
  });
}
