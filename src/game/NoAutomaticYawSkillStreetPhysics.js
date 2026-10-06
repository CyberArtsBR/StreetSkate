import { UnifiedRampFeelSkillStreetPhysics } from './UnifiedRampFeelSkillStreetPhysics.js';
import { evaluateLandingYawInvariant } from './core/OrientationInvariant.js';

/**
 * Final observability guard for yaw ownership.
 *
 * Contact geometry may correct position, surface normal, pitch/roll, velocity and
 * support state, but horizontal yaw belongs only to deliberate ground steering or
 * explicit airborne spin. Lower-layer automatic wall/coping/landing yaw writers
 * have been removed during Phase 1; this layer now measures the invariant instead
 * of silently repairing violations after the fact.
 */
export class NoAutomaticYawSkillStreetPhysics extends UnifiedRampFeelSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.landingYawInvariantViolations = 0;
    this.lastLandingYawInvariant = null;
  }

  /** Compatibility API remains inert: wall contact never owns yaw. */
  detectGroundWallImpact() {
    return null;
  }

  /** Compatibility API remains inert: wall contact never owns yaw. */
  applyWallRecovery() {
    return false;
  }

  /**
   * Observe, never repair. If any lower layer changes yaw during touchdown the
   * counter becomes non-zero and deterministic replay fails CI on that frame.
   * This avoids masking the real writer with a top-level "undo".
   */
  land(support) {
    const playerHeading = this.heading;
    const landed = super.land(support);
    if (!landed) return false;

    const invariant = evaluateLandingYawInvariant({
      playerHeading,
      lowerLayerHeading: this.heading,
    });
    this.lastLandingYawInvariant = invariant;
    if (invariant.violated) this.landingYawInvariantViolations += 1;
    return true;
  }
}
