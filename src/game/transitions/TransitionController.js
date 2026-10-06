import * as THREE from 'three';
import {
  compileTransitionMetadata,
  PRODUCTION_TRANSITION_AUTHORING,
} from './TransitionMetadata.js';

const UP = new THREE.Vector3(0, 1, 0);
const CAPTURE_SCALE = 1.3;
const RAMP_EXIT_INPUT_THRESHOLD = 0.35;
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

function nearestPointOnSegmentXZ(position, a, b, out = new THREE.Vector3()) {
  const ab = b.clone().sub(a);
  const flatAB = new THREE.Vector3(ab.x, 0, ab.z);
  const lengthSq = flatAB.lengthSq();
  if (lengthSq < EPSILON) return out.copy(a);

  const ap = position.clone().sub(a);
  const t = clamp((ap.x * flatAB.x + ap.z * flatAB.z) / lengthSq, 0, 1);
  return out.copy(a).lerp(b, t);
}

function legacySourceName(candidate) {
  return candidate?.name
    ?? candidate?.copingName
    ?? candidate?.edge?.name
    ?? null;
}

/**
 * Authoritative semantic gate for transition rails.
 * Every runtime rail must pass through this exact authoring table before it can
 * participate in vert physics.
 */
export function authoredTransitionRails(
  rails = [],
  authoring = PRODUCTION_TRANSITION_AUTHORING,
) {
  return rails.filter(rail => Boolean(authoring[rail?.name]));
}

/**
 * Debug/migration bridge for inspecting legacy candidates. Runtime takeoff no
 * longer uses this lookup: canonical identity must originate at candidate time.
 */
export function authoredTransitionIdentity(
  candidate,
  authoring = PRODUCTION_TRANSITION_AUTHORING,
) {
  const sourceName = legacySourceName(candidate);
  const authored = sourceName ? authoring[sourceName] : null;
  return {
    sourceName,
    transitionId: authored?.id ?? null,
    type: authored?.type ?? null,
    supportsVert: Boolean(authored?.supportsVert),
    supportsTransfer: Boolean(authored?.supportsTransfer),
    supportsPump: Boolean(authored?.supportsPump),
    mapped: Boolean(authored),
  };
}

/**
 * Canonical transition authority for Phase 1.
 *
 * Owns authored rail selection, approach/launch detection, vert-air trajectory,
 * transfer/return steering and presentation normal. TransitionGuide remains only
 * as a legacy regression oracle while the inheritance stack is being dismantled.
 */
export class TransitionController {
  constructor({ rails = [], authoring = PRODUCTION_TRANSITION_AUTHORING } = {}) {
    this.rails = authoredTransitionRails(rails, authoring);
    this.transitions = compileTransitionMetadata(this.rails, authoring);
    this.byId = new Map(this.transitions.map(transition => [transition.id, transition]));
    this.byRailName = new Map(this.transitions.map(transition => [transition.sourceRail, transition]));

    this.edges = [];
    for (const transition of this.transitions) {
      const path = transition.lipPath;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1].clone();
        const b = path[i].clone();
        const tangent = horizontal(b.clone().sub(a));
        if (tangent.lengthSq() < EPSILON) continue;
        this.edges.push({
          a,
          b,
          tangent: tangent.normalize(),
          name: transition.sourceRail,
          transitionId: transition.id,
          transitionType: transition.type,
          supportsVert: transition.supportsVert,
          supportsTransfer: transition.supportsTransfer,
          supportsPump: transition.supportsPump,
        });
      }
    }
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  forRail(name) {
    return this.byRailName.get(name) || null;
  }

  nearestLip(position, maxGap = Infinity) {
    if (!position) return null;
    let best = null;
    let bestGap = Number(maxGap);

    for (const transition of this.transitions) {
      const path = transition.lipPath;
      for (let i = 1; i < path.length; i++) {
        const point = nearestPointOnSegmentXZ(position, path[i - 1], path[i]);
        const dx = position.x - point.x;
        const dz = position.z - point.z;
        const gap = Math.hypot(dx, dz);
        if (gap >= bestGap) continue;

        const tangent = path[i].clone().sub(path[i - 1]).setY(0);
        if (tangent.lengthSq() > EPSILON) tangent.normalize();
        bestGap = gap;
        best = {
          transition,
          point: point.clone(),
          tangent,
          segmentIndex: i - 1,
          gap,
          verticalDelta: position.y - point.y,
        };
      }
    }
    return best;
  }

  candidate(position, normal, velocity, {
    maxGap,
    below,
    above,
    maxNormalY,
    minAlignment,
  }) {
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
        position.clone().sub(edgeInfo.a).setY(0).dot(edge) / Math.max(edge.lengthSq(), EPSILON),
        0,
        1,
      );
      const lipPoint = edgeInfo.a.clone().lerp(edgeInfo.b, t);
      const gap = horizontal(position.clone().sub(lipPoint)).length();
      const lipSurfaceY = lipPoint.y - 0.025;
      if (gap >= distance || position.y < lipSurfaceY - below || position.y > lipSurfaceY + above) continue;

      let copingTangent = edgeInfo.tangent.clone();
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
        transitionId: edgeInfo.transitionId,
        transitionType: edgeInfo.transitionType,
        supportsVert: edgeInfo.supportsVert,
        supportsTransfer: edgeInfo.supportsTransfer,
        supportsPump: edgeInfo.supportsPump,
      };
      distance = gap;
    }
    return closest;
  }

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

  launchAt(position, normal, velocity) {
    if (velocity.y <= -0.05) return null;
    return this.candidate(position, normal, velocity, {
      maxGap: 0.62 * CAPTURE_SCALE,
      below: 0.48 * CAPTURE_SCALE,
      above: 0.34 * CAPTURE_SCALE,
      maxNormalY: 0.84,
      minAlignment: 0.05,
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
    let launchVertical = clamp(Math.sqrt(baseVertical * baseVertical + Math.pow(boost * 0.72, 2)), 2.5, 15.5);
    const lateralVelocity = clamp(tangentVelocity, -2.6, 2.6);
    const exitRequested = Boolean(edge.exitRequested);

    let launchHorizontal;
    if (exitRequested) {
      const exitSpeed = clamp(incomingSpeed * 0.78 + 0.9, 4.8, 12.8);
      const retainedLateral = edge.copingTangent.clone().multiplyScalar(lateralVelocity * 0.45);
      launchHorizontal = edge.deckOutward.clone().multiplyScalar(exitSpeed).add(retainedLateral);
      launchVertical = clamp(launchVertical * 0.80, 3.2, 11.8);
    } else {
      const inwardDrift = clamp(incomingSpeed * 0.055, 0.22, 0.85);
      launchHorizontal = edge.copingTangent.clone().multiplyScalar(lateralVelocity)
        .addScaledVector(edge.rampInward, inwardDrift);
    }
    velocity.copy(launchHorizontal).addScaledVector(UP, launchVertical);

    const returnTarget = edge.lipPoint.clone().addScaledVector(edge.rampInward, 0.26);
    returnTarget.y = edge.lipPoint.y - 0.035;

    const transition = edge?.transitionId ? this.get(edge.transitionId) : null;
    const air = {
      mode: exitRequested ? 'transfer' : 'return',
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
      exitRequested,
      transferring: exitRequested,
      age: 0,
      copingName: edge.name,
      returnError: horizontal(returnTarget.clone().sub(position)).length(),
    };

    if (transition) {
      air.transitionId = transition.id;
      air.transitionType = transition.type;
      air.supportsTransfer = transition.supportsTransfer;
      air.supportsPump = transition.supportsPump;
      air.frame.transitionId = transition.id;
      air.frame.transitionType = transition.type;
    }
    return air;
  }

  advance(air, position, velocity, input = {}, dt) {
    air.age += dt;
    if (velocity.y <= 0) air.apexPassed = true;

    const upExit = (Number(input.drive) || 0) > RAMP_EXIT_INPUT_THRESHOLD
      || input.directionTaps?.includes?.('up');
    if (input.vertExit || upExit) air.exitRequested = true;

    const canTransfer = upExit
      ? air.age > 0.01
      : air.apexPassed || (air.age > 0.18 && velocity.y < air.launchVertical * 0.48);
    if (air.exitRequested && canTransfer && !air.transferring) {
      air.mode = 'transfer';
      air.transferring = true;
    }

    const frame = air.frame;
    const currentHorizontal = horizontal(velocity);
    if (air.transferring) {
      const exitSpeed = clamp(frame.incomingSpeed * 0.78 + 0.9, 4.8, 12.8);
      const retainedLateral = frame.copingTangent.clone().multiplyScalar(air.lateralVelocity * 0.45);
      const desired = frame.deckOutward.clone().multiplyScalar(exitSpeed).add(retainedLateral);
      const next = accelerateToward(currentHorizontal, desired, (upExit ? 48 : 30) * dt);
      velocity.x = next.x;
      velocity.z = next.z;
    } else if (!air.apexPassed) {
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

  /** Debug-only bridge for comparing old name-based candidates during migration. */
  inspectLegacyCandidate(candidate) {
    const identity = authoredTransitionIdentity(candidate);
    if (!identity.mapped) return identity;
    const transition = this.forRail(identity.sourceName);
    return {
      ...identity,
      transitionId: transition?.id ?? null,
      type: transition?.type ?? null,
      mapped: Boolean(transition),
    };
  }

  debugSummary(position, maxGap = 2.5) {
    const nearest = this.nearestLip(position, maxGap);
    if (!nearest) return { count: this.transitions.length, nearest: null };
    return {
      count: this.transitions.length,
      nearest: {
        id: nearest.transition.id,
        type: nearest.transition.type,
        sourceRail: nearest.transition.sourceRail,
        gap: nearest.gap,
        verticalDelta: nearest.verticalDelta,
        segmentIndex: nearest.segmentIndex,
      },
    };
  }
}
