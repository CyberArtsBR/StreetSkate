import * as THREE from 'three';
import {
  compileTransitionMetadata,
  PRODUCTION_TRANSITION_AUTHORING,
} from './TransitionMetadata.js';

const EPSILON = 1e-8;
const clamp = THREE.MathUtils.clamp;

function nearestPointOnSegmentXZ(position, a, b, out = new THREE.Vector3()) {
  const ab = b.clone().sub(a);
  const flatAB = new THREE.Vector3(ab.x, 0, ab.z);
  const lengthSq = flatAB.lengthSq();
  if (lengthSq < EPSILON) return out.copy(a);

  const ap = position.clone().sub(a);
  const t = clamp((ap.x * flatAB.x + ap.z * flatAB.z) / lengthSq, 0, 1);
  return out.copy(a).lerp(b, t);
}

/**
 * Phase 1 shadow transition authority.
 *
 * This class owns transition semantics and lip geometry, but it deliberately does
 * not mutate player physics yet. The legacy TransitionGuide continues to drive the
 * live branch behavior until replay parity is established. That lets us compare
 * old detection against explicit metadata before switching authority.
 */
export class TransitionController {
  constructor({ rails = [], authoring = PRODUCTION_TRANSITION_AUTHORING } = {}) {
    this.transitions = compileTransitionMetadata(rails, authoring);
    this.byId = new Map(this.transitions.map(transition => [transition.id, transition]));
    this.byRailName = new Map(this.transitions.map(transition => [transition.sourceRail, transition]));
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

  /** Map a legacy TransitionGuide result to canonical metadata without mutation. */
  inspectLegacyCandidate(candidate) {
    if (!candidate) return null;
    const sourceName = candidate.name ?? candidate.copingName ?? candidate.edge?.name ?? null;
    const transition = sourceName ? this.forRail(sourceName) : null;
    return {
      sourceName,
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
