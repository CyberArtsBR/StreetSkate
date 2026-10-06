import { UnifiedRampFeelSkillStreetPhysics } from './UnifiedRampFeelSkillStreetPhysics.js';
import { evaluateLandingYawInvariant } from './core/OrientationInvariant.js';

/**
 * Final gameplay authority for yaw.
 *
 * Contact geometry is allowed to correct position, surface normal, pitch/roll,
 * velocity and support state, but it is NEVER allowed to rotate the skater around
 * world Y. Yaw now comes only from deliberate player steering on the ground or
 * explicit airborne spin input.
 *
 * This top-level guard intentionally sits above every legacy ramp/wall/contact
 * layer so older helpers cannot reintroduce a hidden 90-degree snap.
 */
export class NoAutomaticYawSkillStreetPhysics extends UnifiedRampFeelSkillStreetPhysics {
  reset(position = this.spawn, heading = 0) {
    super.reset(position, heading);
    this.landingYawInvariantViolations = 0;
    this.lastLandingYawInvariant = null;
  }

  /** No wall, ledge, rail or stair contact may request an automatic turn. */
  detectGroundWallImpact() {
    return null;
  }

  /** Legacy wall-recovery calls are explicitly inert at runtime. */
  applyWallRecovery() {
    return false;
  }

  /**
   * Landing may change pitch/roll through the support normal, but never yaw.
   * `this.heading` already includes any explicit Q/E/L1/R1 spin performed in air,
   * so preserving it keeps real tricks while eliminating contact-driven snaps.
   *
   * Phase 1 now records the lower-layer attempted yaw before restoring the player
   * heading. This keeps current behavior while making hidden writers observable
   * so they can be removed instead of permanently relying on an undo layer.
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

    this.heading = invariant.preservedHeading;
    this.airHeading = invariant.preservedHeading;
    this.groundDirection();
    return true;
  }
}
