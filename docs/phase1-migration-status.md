# StreetSkate Phase 1 — Migration Status

Branch: `refactor/core-skate-controller-v1`

Production `main` remains untouched by this refactor branch.

## Canonical authorities already introduced

### TransitionController

The final runtime now uses `TransitionController` as the authoritative transition system for:

- authored transition rail selection;
- transition IDs/types/capabilities;
- approach detection;
- launch detection;
- vert `begin()` trajectory;
- per-frame `advance()` trajectory;
- presentation normal.

`TransitionGuide` remains only as a legacy regression oracle / compatibility implementation for parity tests. Runtime transition identity must originate from a canonical candidate; coping/rail names are not reinterpreted at takeoff.

### InputInterpreter

Ollie release semantics are interpreted once in the final runtime. The interpreter owns the distinction between:

- ollie;
- pump;
- vert ollie;
- grind ollie-out;
- blocked pump;
- air release.

`PumpSystem` no longer decides what a physical button means.

### TravelState

`resolveTravelState()` is now the shared derivation for:

- world travel direction;
- signed travel relative to the deck;
- fakie.

Legacy `rollingSign`, `fakie`, and `travelDirection` fields remain populated for compatibility, but their synchronized values now come from one pure function. Passive vert return may therefore be fakie without inventing yaw.

### LaunchEnergyModel

Ramp launch energy is calculated once. The old lower-layer arcade ramp boost no longer independently adds a second launch bonus.

### LandingResult

The central bowl/ramp landing acceptance decision is pure and canonical. It owns:

- support mode (`full`, `truckFirst`, `wheelFirst`, reject);
- correction limit;
- flip catch/bail decision;
- alignment threshold;
- board/travel alignment;
- planar touchdown velocity;
- half-turn count;
- partial touchdown classification.

`BowlLandingSkillStreetPhysics.land()` now consumes this result while preserving the validated mutation order.

### LandingPolicy (shadow / next handoff)

A pure landing route policy now defines priority between:

1. verified original-transition return;
2. abort-to-return;
3. deck-target rejection;
4. standard landing.

The policy is tested but the large deck/coping wrappers have not yet been routed through it.

### Orientation invariant

`NoAutomaticYawSkillStreetPhysics.land()` no longer silently hides lower-layer yaw writes without evidence. It now records:

- attempted lower-layer landing yaw delta;
- whether the no-auto-yaw invariant was violated;
- cumulative violation count.

The player-authored pre-contact heading remains the final heading, so behavior is preserved while hidden writers become observable in replay/debug snapshots.

## Legacy compatibility still present

The inheritance tower still contains these high-risk landing/re-entry wrappers:

- `DeckAwareRampExitSkillStreetPhysics.land()`;
- `SafeCopingExitSkillStreetPhysics.land()`;
- `StableRampReturnSkillStreetPhysics.land()`;
- `MomentumRollSkillStreetPhysics.land()`;
- `NoAutomaticYawSkillStreetPhysics.land()`;
- top-level pump landing bookkeeping.

The target is not to replace these with another subclass. Their geometry checks and decisions are being moved into pure results/policies first, then execution can be composed explicitly.

## Current invariants

- No ramp, coping, wall, rail or collision contact may create horizontal yaw.
- Explicit air spin remains the only airborne yaw input.
- Fakie is derived from deck heading versus travel, not restored as a ramp-specific boolean.
- Transition identity must be authored and canonical.
- Ramp launch energy has one authority.
- The original production arena remains active.
- Phase 1 does not merge or deploy to production `main`.

## Next safe migration sequence

1. route deck/original-transition landing wrappers through `LandingPolicy`;
2. add replay assertions for landing yaw invariant violations;
3. consolidate remaining landing side effects behind one explicit landing executor;
4. remove pass-through / obsolete landing overrides only after CI parity;
5. then move to continuous collision authority and camera-state work.
