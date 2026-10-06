import * as THREE from 'three';
import { TransitionGuide } from '../TransitionGuide.js';
import {
  compileTransitionMetadata,
  PRODUCTION_TRANSITION_AUTHORING,
} from './TransitionMetadata.js';

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
 * TransitionGuide is intentionally geometry-only; every runtime rail must pass
 * through this exact authoring table before it can participate in vert physics.
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
 * Phase 1 transition authority.
 *
 * The controller owns semantic rail selection and approach/launch detection.
 * TransitionGuide remains only as a temporary trajectory delegate for
 * begin/advance/presentationNormal. Canonical identity is created by candidate()
 * and must be carried into begin(); names are never reinterpreted at takeoff.
 */
export class TransitionController {
  constructor({ rails = [], authoring = PRODUCTION_TRANSITION_AUTHORING } = {}) {
    this.rails = authoredTransitionRails(rails, authoring);
    this.transitions = compileTransitionMetadata(this.rails, authoring);
    this.byId = new Map(this.transitions.map(transition => [transition.id, transition]));
    this.byRailName = new Map(this.transitions.map(transition => [transition.sourceRail, transition]));
    this.geometryGuide = new TransitionGuide(this.rails);

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

  /** Trajectory execution remains delegated until its own parity migration. */
  begin(position, velocity, edge, options = {}) {
    const air = this.geometryGuide.begin(position, velocity, edge, options);
    const transition = edge?.transitionId ? this.get(edge.transitionId) : null;
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
    return this.geometryGuide.advance(air, position, velocity, input, dt);
  }

  presentationNormal(air, verticalSpeed) {
    return this.geometryGuide.presentationNormal(air, verticalSpeed);
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
