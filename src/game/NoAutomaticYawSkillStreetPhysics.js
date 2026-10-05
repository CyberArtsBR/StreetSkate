import { UnifiedRampFeelSkillStreetPhysics } from './UnifiedRampFeelSkillStreetPhysics.js';

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
   */
  land(support) {
    const playerHeading = this.heading;
    const landed = super.land(support);
    if (!landed) return false;

    this.heading = playerHeading;
    this.airHeading = playerHeading;
    this.groundDirection();
    return true;
  }
}
