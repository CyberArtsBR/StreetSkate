import * as THREE from 'three';
import { StreetSkater } from './StreetSkater.js';
import { PlayerState } from './core/PlayerState.js';
import { legacyStateViolations } from './core/LegacyStateInvariants.js';

const EPSILON = 1e-8;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Build the rendered board/rider basis without ever projecting the forward/yaw
 * axis into a near-parallel coping normal. At a vertical quarter-pipe lip the
 * old forward projection collapses toward zero and the visual basis can snap
 * sideways by ~90 degrees even though physics heading never changed.
 *
 * Keep the horizontal RIGHT axis authored by heading, project that across the
 * rideable surface, then derive back/forward from the surface normal. For a
 * normal quarter this preserves coping-parallel right while pitch can rotate all
 * the way to vertical. A forward-derived fallback handles wall-ride-like cases
 * where right itself is the degenerate axis.
 */
export function yawStableSurfaceBasis(
  heading,
  surfaceUp,
  rightOut = new THREE.Vector3(),
  backOut = new THREE.Vector3(),
  upOut = new THREE.Vector3(),
) {
  upOut.copy(surfaceUp || WORLD_UP);
  if (upOut.lengthSq() < EPSILON) upOut.copy(WORLD_UP);
  else upOut.normalize();

  const cos = Math.cos(Number(heading) || 0);
  const sin = Math.sin(Number(heading) || 0);

  // Local +X/right for the game's yaw convention where heading 0 faces -Z.
  rightOut.set(cos, 0, -sin);
  rightOut.addScaledVector(upOut, -rightOut.dot(upOut));

  if (rightOut.lengthSq() > 1e-6) {
    rightOut.normalize();
    backOut.crossVectors(rightOut, upOut).normalize();
    return { right: rightOut, up: upOut, back: backOut };
  }

  // Rare fallback: surface normal is nearly parallel to the yaw-right axis.
  // Preserve yaw through the opposite (back) axis instead of choosing a random
  // perpendicular vector.
  backOut.set(sin, 0, cos);
  backOut.addScaledVector(upOut, -backOut.dot(upOut));
  if (backOut.lengthSq() > 1e-6) {
    backOut.normalize();
    rightOut.crossVectors(upOut, backOut).normalize();
    return { right: rightOut, up: upOut, back: backOut };
  }

  // Fully degenerate only for invalid input; still return a deterministic basis.
  rightOut.set(1, 0, 0);
  if (Math.abs(rightOut.dot(upOut)) > 0.98) rightOut.set(0, 0, 1);
  rightOut.addScaledVector(upOut, -rightOut.dot(upOut)).normalize();
  backOut.crossVectors(rightOut, upOut).normalize();
  return { right: rightOut, up: upOut, back: backOut };
}

/**
 * Final presentation authority. Physics remains untouched; after StreetSkater
 * updates animation/presentation we replace only the root orientation basis with
 * a coping-safe basis. Therefore coping can change pitch/roll but never invent
 * horizontal yaw.
 *
 * Phase 1 also mirrors the legacy runtime into PlayerState and records invariant
 * violations in shadow mode. This observer is strictly read-only: it does not
 * normalize, repair or feed any canonical value back into gameplay yet.
 */
export class YawStableStreetSkater extends StreetSkater {
  constructor(options) {
    super(options);
    this._yawStableUp = new THREE.Vector3(0, 1, 0);
    this.playerState = new PlayerState().syncFromLegacy(this);
    this.stateViolations = [];
  }

  update(delta, input, elapsed) {
    const result = super.update(delta, input, elapsed);
    yawStableSurfaceBasis(
      this.heading,
      this.presentationNormal,
      this._rightVisual,
      this._backVisual,
      this._yawStableUp,
    );
    this.visual.quaternion.setFromRotationMatrix(
      this._basis.makeBasis(this._rightVisual, this._yawStableUp, this._backVisual),
    );

    this.playerState.syncFromLegacy(this);
    this.stateViolations = legacyStateViolations(this, this.playerState);

    if (this.debugEnabled && this.debugElement) {
      const canonical = this.playerState;
      const codes = this.stateViolations.map(entry => entry.code);
      this.debugElement.textContent += [
        '',
        '--- PHASE 1 CANONICAL ---',
        `DECK HEADING ${canonical.deckHeading.toFixed(4)}`,
        `TRAVEL       ${canonical.travelDirection.toArray().map(n => n.toFixed(3)).join(', ')}`,
        `FAKIE        ${canonical.fakie}`,
        `STATE CHECK  ${codes.length ? codes.join(', ') : 'OK'}`,
      ].join('\n');
    }
    return result;
  }
}
