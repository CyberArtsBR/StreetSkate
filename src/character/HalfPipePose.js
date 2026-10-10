// Adapted from CyberArtsBR/Skate SkatePoseController / SkateAnimationController
// at 53af1f2. StreetSkate owns movement and trick timing; this is presentation.
const clamp = value => Math.min(1, Math.max(0, Number(value) || 0));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// RiderFootIK's law-of-cosines pelvis target: respects each avatar's leg lengths.
export function kneeHeight(upper, lower, flex, lateralSquared) {
  return Math.sqrt(Math.max(.001, upper * upper + lower * lower
    + 2 * upper * lower * Math.cos(flex) - lateralSquared));
}

export function halfPipePose({ charge = 0, air = 0, vert = false, verticalVelocity = 0,
  landing = 0, speed = 0, grab = 0 } = {}) {
  const airborne = clamp(air);
  const anticipation = smooth(-verticalVelocity / 12) * airborne;
  // The old 24-32% preload forced a squat even while idling or cruising.
  // Crouch now follows deliberate charge, air, grab and landing states only.
  const preload = 0;
  const aerialCrouch = vert ? 0.94 - anticipation * 0.16 : 0.70 - anticipation * 0.12;
  const flightCompression = 0.62 + aerialCrouch * 0.36;
  const compression = clamp(Math.max(
    preload + smooth(charge) * (1 - preload),
    flightCompression * airborne,
    clamp(grab) * 0.86,
  ) + clamp(landing) * 0.38);
  return { compression, torsoLean: 0.10 + compression * 0.22 + airborne * 0.08,
    response: charge > 0 || airborne > 0.1 ? 22 : 14 };
}
