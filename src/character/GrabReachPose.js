import * as THREE from 'three';

/** A bounded upper-body gather for a named airborne deck reach. The pelvis
 * hinge runs before leg IK; the spine curl lowers the shoulder without moving
 * either planted ankle or changing a bone length. */
export function grabReachPose(weight, reachingSides, enabled = true) {
  const amount = enabled && reachingSides.length
    ? THREE.MathUtils.clamp(Number.isFinite(weight) ? weight : 0, 0, 1) : 0;
  return {
    pelvisHinge: .35 * amount,
    spineCurl: .15 * amount,
    shoulderBend: .25 * amount,
    weight: amount,
  };
}

/** Keep elbow slack proportional to the loaded arm. The former fixed 3.5 cm
 * reserve consumed 8–10% of compact rigs' entire reach. This still leaves a
 * real bend and never relocates the requested rail to manufacture contact. */
export function grabReachMargin(armLength) {
  return THREE.MathUtils.clamp(armLength * .035, .01, .025);
}
