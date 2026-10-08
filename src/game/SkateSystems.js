export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const BOARD_GEOMETRY = Object.freeze({
  length: 1.05,
  halfLength: 0.525,
  wheelbase: 0.62,
  halfWheelbase: 0.31,
  track: 0.22,
  halfTrack: 0.11,
  wheelRadius: 0.031,
  deckThickness: 0.018,
  truckClearance: 0.055,
  slideClearance: 0.024,
});

export const GRIND_CAPTURE = Object.freeze({
  distance: 0.27,
  blendTime: 0.10,
  predictionTime: 0.085,
  maxRiseVelocity: 0.45,
  maxAbove: 0.28,
  maxBelow: 0.07,
  antiStallSpeed: 8.5,
  cooldown: 0.28,
});

const PROFILE = (name, contact, clearance, difficulty, durationRate, presentation, approach = {}) => Object.freeze({
  name, contact, clearance, difficulty, durationRate,
  presentation: Object.freeze({ pitch: 0, yaw: 0, roll: 0, visualLift: 0, ...presentation }),
  approach: Object.freeze({ minAlignment: 0.34, maxAlignment: 1, minTangentSpeed: 0.18, ...approach }),
});

export const GRIND_PROFILES = Object.freeze({
  '50-50': PROFILE('50-50', 'bothTrucks', 0.058, 1.00, 34, {}),
  '5-0': PROFILE('5-0', 'rearTruck', 0.060, 1.14, 39, { pitch: -0.11, roll: 0.018 }),
  Nosegrind: PROFILE('Nosegrind', 'frontTruck', 0.060, 1.14, 39, { pitch: 0.11, roll: -0.018 }),
  Boardslide: PROFILE('Boardslide', 'deckCenter', 0.024, 1.12, 38, { yaw: Math.PI / 2, roll: 0.028 }, { minAlignment: 0.12, maxAlignment: 0.62, minTangentSpeed: 0.14 }),
  Noseslide: PROFILE('Noseslide', 'noseDeck', 0.026, 1.18, 42, { pitch: 0.035, yaw: Math.PI / 2, roll: 0.02 }, { minAlignment: 0.16, maxAlignment: 0.78 }),
  Tailslide: PROFILE('Tailslide', 'tailDeck', 0.026, 1.18, 42, { pitch: -0.035, yaw: -Math.PI / 2, roll: -0.02 }, { minAlignment: 0.16, maxAlignment: 0.78 }),
  Smith: PROFILE('Smith', 'rearTruck', 0.052, 1.32, 48, { pitch: -0.075, yaw: 0.10, roll: -0.12 }, { minAlignment: 0.28 }),
  Feeble: PROFILE('Feeble', 'rearTruck', 0.052, 1.30, 47, { pitch: -0.07, yaw: -0.10, roll: 0.12 }, { minAlignment: 0.28 }),
  Crook: PROFILE('Crook', 'frontTruck', 0.054, 1.34, 50, { pitch: 0.09, yaw: 0.10, roll: 0.085 }, { minAlignment: 0.28 }),
  Overcrook: PROFILE('Overcrook', 'frontTruck', 0.054, 1.38, 52, { pitch: 0.10, yaw: -0.10, roll: -0.085 }, { minAlignment: 0.28 }),
});

export function grindProfile(name = '50-50') {
  return GRIND_PROFILES[name] || GRIND_PROFILES['50-50'];
}

export function railSurfaceHeight(centerY, radius, clearance = 0) {
  return centerY + Math.max(0, radius || 0) + Math.max(0, clearance || 0);
}

export function contactLongitudinalOffsets(profileOrName) {
  const profile = typeof profileOrName === 'string' ? grindProfile(profileOrName) : profileOrName;
  switch (profile.contact) {
    case 'frontTruck': return [BOARD_GEOMETRY.halfWheelbase];
    case 'rearTruck': return [-BOARD_GEOMETRY.halfWheelbase];
    case 'noseDeck': return [BOARD_GEOMETRY.halfLength * 0.78];
    case 'tailDeck': return [-BOARD_GEOMETRY.halfLength * 0.78];
    case 'bothTrucks': return [-BOARD_GEOMETRY.halfWheelbase, BOARD_GEOMETRY.halfWheelbase];
    default: return [0];
  }
}

export function manualSupportOffsets(kind) {
  const longitudinal = kind === 'noseManual' ? BOARD_GEOMETRY.halfWheelbase : -BOARD_GEOMETRY.halfWheelbase;
  return [
    { longitudinal, lateral: -BOARD_GEOMETRY.halfTrack },
    { longitudinal, lateral: BOARD_GEOMETRY.halfTrack },
  ];
}

export function captureEligibility({
  surfaceDistance,
  verticalDelta,
  velocityY,
  tangentAlignment,
  tangentSpeed,
  trajectoryClosing,
  trickName,
}) {
  const profile = grindProfile(trickName);
  const alignment = Math.abs(tangentAlignment);
  if (velocityY > GRIND_CAPTURE.maxRiseVelocity) return { eligible: false, reason: 'ascending', profile };
  if (surfaceDistance > GRIND_CAPTURE.distance) return { eligible: false, reason: 'distance', profile };
  if (verticalDelta < -GRIND_CAPTURE.maxBelow || verticalDelta > GRIND_CAPTURE.maxAbove) return { eligible: false, reason: 'height', profile };
  if (alignment < profile.approach.minAlignment || alignment > profile.approach.maxAlignment) return { eligible: false, reason: 'angle', profile };
  if (Math.abs(tangentSpeed) < profile.approach.minTangentSpeed) return { eligible: false, reason: 'tangent-speed', profile };
  if (surfaceDistance > 0.105 && trajectoryClosing < 0.012) return { eligible: false, reason: 'trajectory', profile };
  return { eligible: true, reason: 'ok', profile };
}

export function projectedGrindSpeed(tangentSpeed) {
  return Math.max(GRIND_CAPTURE.antiStallSpeed, Math.abs(tangentSpeed));
}

export function advanceRailCoordinate(s, direction, speed, dt, length, closed = false) {
  let next = s + direction * speed * dt;
  if (closed && length > 0) next = ((next % length) + length) % length;
  return { s: next, ended: !closed && (next < 0 || next > length) };
}

export function canAttemptGrind(contactCooldown) {
  return contactCooldown <= 0;
}

export function grindExitVelocity(tangentSpeed, pop = false) {
  return { along: Math.max(0, tangentSpeed), vertical: pop ? 3.25 : 0.25 };
}

export function createBalanceState(phase = 0.8) {
  return { value: 0, velocity: 0, phase, bias: Math.sin(phase) >= 0 ? 1 : -1, disturbance: 0 };
}

export function disturbBalance(state, amount) {
  state.disturbance = Math.min(1.5, (state.disturbance || 0) + Math.max(0, amount));
  return state;
}

export function stepBalance(state, {
  dt,
  duration,
  difficulty = 1,
  speed = 0,
  comboDuration = 0,
  correction = 0,
  steering = 0,
}) {
  const ramp = clamp((duration - 0.55) / 2.4, 0, 1);
  const speedTerm = clamp(speed / 14, 0, 1);
  const comboTerm = clamp(comboDuration / 24, 0, 1);
  const pressure = difficulty * (0.34 + ramp * 0.66) + speedTerm * 0.18 + comboTerm * 0.20 + Math.abs(steering) * 0.10;
  const outward = state.bias * (0.035 + ramp * 0.145) * pressure;
  const wave = Math.sin(duration * 2.15 + state.phase) * 0.055 * pressure;
  const disturbance = state.bias * (state.disturbance || 0) * 0.34;
  const correctionAccel = clamp(correction, -1, 1) * 0.72;
  const acceleration = outward + wave + disturbance - correctionAccel;
  state.velocity += acceleration * dt;
  state.velocity *= Math.exp(-0.58 * dt);
  state.value += state.velocity * dt;
  state.disturbance *= Math.exp(-2.6 * dt);
  return {
    value: state.value,
    velocity: state.velocity,
    failed: Math.abs(state.value) >= 1,
    pressure,
    ramp,
  };
}

export class DurationScoreAccumulator {
  constructor() { this.fraction = 0; this.total = 0; }
  reset() { this.fraction = 0; this.total = 0; }
  add(ratePerSecond, dt) {
    this.fraction += Math.max(0, ratePerSecond) * Math.max(0, dt);
    const whole = Math.floor(this.fraction + 1e-9);
    if (whole > 0) {
      this.fraction -= whole;
      this.total += whole;
    }
    return whole;
  }
  flushRounded() {
    const points = Math.round(this.fraction);
    this.total += points;
    this.fraction = 0;
    return points;
  }
}
