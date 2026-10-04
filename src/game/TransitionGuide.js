import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const CAPTURE_SCALE = 1.3;
const EPSILON = 1e-8;
const clamp = THREE.MathUtils.clamp;

function horizontal(vector) {
  return vector.clone().setY(0);
}

function safeNormal(vector, fallback) {
  if (!vector || vector.lengthSq() < EPSILON) return fallback.clone();
  return vector.clone().normalize();
}

function accelerateToward(current, target, maxDelta) {
  const correction = target.clone().sub(current);
  const length = correction.length();
  if (length <= maxDelta || length < EPSILON) return target.clone();
  return current.clone().addScaledVector(correction, maxDelta / length);
}

/**
 * Coping-aware transition helper. It owns only the local vert-air trajectory;
 * board trick orientation is deliberately kept outside this controller.
 */
export class TransitionGuide {
  constructor(rails = []) {
    this.edges = [];
    for (const rail of rails) {
      if (!/coping/i.test(rail.name)) continue;
      for (let i = 1; i < rail.points.length; i++) {
        const a = new THREE.Vector3(...rail.points[i - 1]);
        const b = new THREE.Vector3(...rail.points[i]);
        const tangent = horizontal(b.clone().sub(a));
        if (tangent.lengthSq() < EPSILON) continue;
        this.edges.push({ a, b, tangent: tangent.normalize(), name: rail.name });
      }
    }
  }

  candidate(position, normal, velocity, { maxGap, below, above, maxNormalY, minAlignment }) {
    if (!normal || normal.y > maxNormalY) return null;
    const rampInward = horizontal(normal);
    if (rampInward.lengthSq() < EPSILON) return null;
    rampInward.normalize();
    const deckOutward = rampInward.clone().negate();
    const travel = horizontal(velocity);
    if (travel.lengthSq() > 0.001 && travel.normalize().dot(deckOutward) < minAlignment) return null;

    let closest = null;
    let distance = maxGap;
    for (const edgeInfo of this.edges) {
      const edge = edgeInfo.b.clone().sub(edgeInfo.a).setY(0);
      const t = clamp(
        position.clone().sub(edgeInfo.a).setY(0).dot(edge) / Math.max(edge.lengthSq(), EPSILON), 0, 1,
      );
      const lipPoint = edgeInfo.a.clone().lerp(edgeInfo.b, t);
      const gap = horizontal(position.clone().sub(lipPoint)).length();
      const lipSurfaceY = lipPoint.y - 0.025;
      if (gap >= distance || position.y < lipSurfaceY - below || position.y > lipSurfaceY + above) continue;

      let copingTangent = edgeInfo.tangent.clone();
      // Keep the local basis orthogonal even on coarse curved coping segments.
      copingTangent.addScaledVector(rampInward, -copingTangent.dot(rampInward));
      copingTangent = safeNormal(copingTangent, edgeInfo.tangent);
      closest = {
        lipPoint,
        copingTangent,
        rampInward: rampInward.clone(),
        deckOutward: deckOutward.clone(),
        surfaceNormal: safeNormal(normal, UP),
        name: edgeInfo.name,
        gap,
      };
      distance = gap;
    }
    return closest;
  }

  /** Wider zone that converts a released ollie into a buffered lip boost. */
  approachAt(position, normal, velocity) {
    if (velocity.y < 0.05) return null;
    return this.candidate(position, normal, velocity, {
      maxGap: 1.7 * CAPTURE_SCALE,
      below: 1.9 * CAPTURE_SCALE,
      above: 0.32 * CAPTURE_SCALE,
      maxNormalY: 0.9,
      minAlignment: 0.06,
    });
  }

  /** Tight lip capture used for actual vert takeoff. */
  launchAt(position, normal, velocity) {
    if (velocity.y <= -0.05) return null;
    return this.candidate(position, normal, velocity, {
      maxGap: 0.52 * CAPTURE_SCALE,
      below: 0.3 * CAPTURE_SCALE,
      above: 0.32 * CAPTURE_SCALE,
      maxNormalY: 0.7,
      minAlignment: 0.12,
    });
  }

  begin(position, velocity, edge, { boardForward = null, launchBoost = 0 } = {}) {
    const incomingVelocity = velocity.clone();
    const incomingSpeed = clamp(incomingVelocity.length(), 0, 24);
    const tangentVelocity = incomingVelocity.dot(edge.copingTangent);
    const tangentSpeed = Math.min(Math.abs(tangentVelocity), 2.8);
    const surfaceVerticality = 1 - clamp(edge.surfaceNormal.y, 0, 1);
    const geometryConversion = THREE.MathUtils.lerp(0.82, 0.99, surfaceVerticality);
    const nonLateralSpeed = Math.sqrt(Math.max(0, incomingSpeed * incomingSpeed - tangentSpeed * tangentSpeed));
    const baseVertical = Math.max(Math.max(0, incomingVelocity.y), nonLateralSpeed * geometryConversion);
    const boost = clamp(launchBoost || 0, 0, 8.5);
    // Treat the ollie as extra launch energy rather than replacing momentum with a huge Y constant.
    const launchVertical = clamp(Math.sqrt(baseVertical * baseVertical + Math.pow(boost * 0.72, 2)), 2.5, 15.5);
    const lateralVelocity = clamp(tangentVelocity, -2.6, 2.6);
    const inwardDrift = clamp(incomingSpeed * 0.055, 0.22, 0.85);

    const launchHorizontal = edge.copingTangent.clone().multiplyScalar(lateralVelocity)
      .addScaledVector(edge.rampInward, inwardDrift);
    velocity.copy(launchHorizontal).addScaledVector(UP, launchVertical);

    const returnTarget = edge.lipPoint.clone().addScaledVector(edge.rampInward, 0.26);
    returnTarget.y = edge.lipPoint.y - 0.035;

    return {
      mode: 'return',
      frame: {
        lipPoint: edge.lipPoint.clone(),
        copingTangent: edge.copingTangent.clone(),
        rampInward: edge.rampInward.clone(),
        deckOutward: edge.deckOutward.clone(),
        surfaceNormal: edge.surfaceNormal.clone(),
        boardForward: safeNormal(boardForward || incomingVelocity, edge.deckOutward),
        incomingTangentVelocity: incomingVelocity.clone().projectOnPlane(edge.surfaceNormal),
        incomingSpeed,
        launchBoost: boost,
        returnTarget,
      },
      launchVertical,
      launchHorizontal: launchHorizontal.clone(),
      lateralVelocity,
      apexPassed: false,
      exitRequested: false,
      transferring: false,
      age: 0,
      copingName: edge.name,
      returnError: horizontal(returnTarget.clone().sub(position)).length(),
    };
  }

  advance(air, position, velocity, input = {}, dt) {
    air.age += dt;
    if (velocity.y <= 0) air.apexPassed = true;
    if (input.vertExit) air.exitRequested = true;

    const canTransfer = air.apexPassed || (air.age > 0.18 && velocity.y < air.launchVertical * 0.48);
    if (air.exitRequested && canTransfer && !air.transferring) {
      air.mode = 'transfer';
      air.transferring = true;
    }

    const frame = air.frame;
    const currentHorizontal = horizontal(velocity);
    if (air.transferring) {
      const exitSpeed = clamp(frame.incomingSpeed * 0.72 + 1.1, 3.8, 10.5);
      const retainedLateral = frame.copingTangent.clone().multiplyScalar(air.lateralVelocity * 0.55);
      const desired = frame.deckOutward.clone().multiplyScalar(exitSpeed).add(retainedLateral);
      const next = accelerateToward(currentHorizontal, desired, 18 * dt);
      velocity.x = next.x;
      velocity.z = next.z;
    } else if (!air.apexPassed) {
      // Small spatial drift is intentional: never freeze X/Z, but keep the rider on the ramp side.
      const lateral = frame.copingTangent.clone().multiplyScalar(air.lateralVelocity * Math.exp(-1.25 * air.age));
      const inward = frame.rampInward.clone().multiplyScalar(clamp(frame.incomingSpeed * 0.045, 0.18, 0.68));
      const desired = inward.add(lateral);
      const next = accelerateToward(currentHorizontal, desired, 7.5 * dt);
      velocity.x = next.x;
      velocity.z = next.z;
    } else {
      const error = horizontal(frame.returnTarget.clone().sub(position));
      const desired = error.multiplyScalar(4.9);
      desired.addScaledVector(frame.copingTangent, air.lateralVelocity * Math.exp(-2.2 * air.age) * 0.28);
      if (desired.length() > 6.5) desired.setLength(6.5);
      const returnAccel = clamp(17 + frame.incomingSpeed * 0.45, 18, 26);
      const next = accelerateToward(currentHorizontal, desired, returnAccel * dt);
      velocity.x = next.x;
      velocity.z = next.z;
    }

    air.returnError = horizontal(frame.returnTarget.clone().sub(position)).length();
  }

  presentationNormal(air, verticalSpeed) {
    if (air?.transferring) return UP;
    if (!air?.frame) return UP;
    const level = 1 - clamp(Math.abs(verticalSpeed) / Math.max(air.launchVertical, 0.01), 0, 1);
    const blend = THREE.MathUtils.smoothstep(level, 0, 0.78);
    return air.frame.surfaceNormal.clone().lerp(UP, blend).normalize();
  }
}
