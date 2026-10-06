# StreetSkate Phase 1 — Migration Status

Branch: `refactor/core-skate-controller-v1`

Production `main` remains untouched by this refactor branch.

## Canonical authorities now active

### TransitionController

The final runtime uses `TransitionController` for authored transition selection, IDs/types/capabilities, approach/launch detection, vert begin/advance trajectory and presentation normal. `TransitionGuide` remains a compatibility/regression oracle only.

### InputInterpreter

Ollie release semantics are interpreted once. The interpreter owns ollie, pump, vert ollie, grind ollie-out, blocked pump and air-release meaning.

### TravelState

`resolveTravelState()` is the canonical derivation for world travel direction, signed travel relative to the deck and fakie. Legacy `rollingSign`, `fakie` and `travelDirection` fields remain synchronized compatibility outputs.

### LaunchEnergyModel

Ramp launch energy has one authority. Lower layers no longer inject an independent second ramp boost.

### LandingPolicy

Deck/coping routing is active in the runtime. Priority is canonical:

1. verified original-transition return;
2. abort-to-return;
3. deck-target rejection;
4. standard landing.

`DeckAwareRampExitSkillStreetPhysics.land()` and `SafeCopingExitSkillStreetPhysics.land()` both consume this policy rather than maintaining independent decision trees.

### LandingResult

Landing acceptance is pure and canonical. Two validated profiles share one core evaluator:

- `evaluateTransitionLanding()` for forgiving bowl/ramp/deck-exit contact;
- `evaluateStableLanding()` for the stricter base/full-support path.

The result owns support mode, correction limit, flip catch/bail, alignment threshold, board/travel alignment and planar touchdown velocity. Contact geometry never returns heading/yaw.

### LandingExecutor

Accepted touchdown mutation is centralized in `applyAcceptedLanding()` and shared by stable/base, bowl and ramp/deck-exit paths. Explicit options preserve the small validated differences between those paths without duplicating complete `land()` bodies.

The executor preserves player-authored heading. Projected board/contact vectors are validation data only and can never become horizontal yaw.

### Orientation invariant

Automatic wall/coping/landing yaw writers were removed from the runtime path. `NoAutomaticYawSkillStreetPhysics` is now observability only: it records attempted landing yaw deltas and cumulative violations but does not repair them.

Deterministic replay requires `landingYawInvariantViolations === 0` on every frame, so a future contact-driven yaw writer fails CI instead of being silently hidden by a top-level undo.

### CollisionResolver

Body/capsule continuous collision is now consumed through an explicit `CollisionResult` boundary. `ParkCollision.move()` still owns the validated substep/overlap solver, while `CollisionResolver` returns copied position/velocity/contact results and exposes no heading/yaw field.

Regression coverage includes solid-wall collision at 3/6/9/12/15 m/s. Collision may correct position and velocity, never orientation.

### CameraState

`FollowCamera` now consumes a read-only-by-copy `CameraState` snapshot rather than reading mutable gameplay vectors throughout its update. Camera travel priority remains canonical travel state -> meaningful velocity -> previous camera side -> fakie-adjusted deck fallback.

The collision surface is queried only for presentation occlusion and cannot feed camera state back into physics.

## Inheritance tower reductions already completed

- `IntegratedRampSafetySkillStreetPhysics` became a compatibility alias instead of an empty prototype level.
- `WallContactAuthoritySkillStreetPhysics` became a compatibility alias; its old broad-wall 90-degree turn authority is gone.
- automatic wall-turn execution was removed from `MomentumRoll.stepGround()`;
- `RampWallSafety` no longer carries a dead wall-turn detector;
- coping/transition auto-align methods no longer write yaw;
- `NoAutomaticYaw` no longer overrides wall APIs or restores heading after landing;
- stable/base, bowl and ramp/deck-exit landing mutation now share the same executor.

## Current invariants

- No ramp, coping, wall, rail or collision contact may create horizontal yaw.
- Explicit air spin remains the only airborne yaw input.
- Ground steering remains the only normal grounded yaw input.
- Fakie is derived from deck heading versus travel, not restored as a ramp-specific boolean.
- Transition identity must be authored and canonical.
- Ramp launch energy has one authority.
- Collision results contain no heading/yaw authority.
- Camera consumes copied presentation state and cannot mutate physics.
- The original production arena remains active.
- Phase 1 does not merge or deploy to production `main`.

## Remaining compatibility wrappers

A few `land()` wrappers remain because they still add real post-landing behavior rather than duplicate acceptance/execution:

- `StableRampReturnSkillStreetPhysics.land()` — explicit-spin/takeoff-facing ramp orientation and travel sync;
- `ArcadeParkMobilitySkillStreetPhysics.land()` — short ramp re-entry steering lock;
- `NoAutomaticYawSkillStreetPhysics.land()` — invariant telemetry only;
- top-level `StatefulSkillStreetPhysics.land()` — pump landing window/impact bookkeeping.

`DeckAwareRampExit` and `SafeCopingExit` still own geometry-specific pre-routing, but their route decisions are already canonical through `LandingPolicy`.

## Next safe migration sequence

1. compose the remaining post-landing hooks explicitly instead of relying on nested `super.land()` order;
2. keep geometry-specific deck/coping detection separate from landing acceptance;
3. remove compatibility prototype levels only when their last hook has moved to composition;
4. extend deterministic replay with real transition/coping tapes as those hooks move;
5. only after parity gates are green decide whether Phase 1 is ready for review/merge.
