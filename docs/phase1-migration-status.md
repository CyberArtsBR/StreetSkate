# StreetSkate Phase 1 — Migration Status

Branch: `refactor/core-skate-controller-v1`

Production `main` remains untouched by this refactor branch.

Status: **REVIEW CANDIDATE — NOT MERGED / NOT DEPLOYED**

## Canonical authorities active in final runtime

### TransitionController

The final runtime uses `TransitionController` for authored transition selection, IDs/types/capabilities, approach/launch detection, vert begin/advance trajectory and presentation normal. `TransitionGuide` remains a compatibility/regression oracle only.

### InputInterpreter

Ollie release semantics are interpreted once. The interpreter owns ollie, pump, vert ollie, grind ollie-out, blocked pump and air-release meaning.

### TravelState

`resolveTravelState()` is the canonical derivation for world travel direction, signed travel relative to the deck and fakie. Legacy `rollingSign`, `fakie` and `travelDirection` fields remain synchronized compatibility outputs.

### LaunchEnergyModel

Ramp launch energy has one authority. Lower layers no longer inject an independent second ramp boost.

### LandingPolicy

Deck/coping routing is active in runtime with canonical priority:

1. verified original-transition return;
2. abort-to-return;
3. deck-target rejection;
4. standard landing.

`DeckAwareRampExitSkillStreetPhysics.land()` and `SafeCopingExitSkillStreetPhysics.land()` consume this policy instead of maintaining independent decision trees.

### LandingResult

Landing acceptance is pure and canonical. Two validated profiles share one core evaluator:

- `evaluateTransitionLanding()` for forgiving bowl/ramp/deck-exit contact;
- `evaluateStableLanding()` for the stricter base/full-support path.

The result owns support mode, correction limit, flip catch/bail, alignment threshold, board/travel alignment and planar touchdown velocity. Contact geometry never returns heading/yaw.

### LandingExecutor

Accepted touchdown mutation is centralized in `applyAcceptedLanding()` and shared by stable/base, bowl and ramp/deck-exit paths. Explicit options preserve the small validated differences between those paths without duplicating complete `land()` bodies.

The executor preserves player-authored heading. Projected board/contact vectors are validation data only and can never become horizontal yaw.

### LandingPostPipeline

Final runtime post-landing behavior is explicitly composed after one accepted landing instead of depending on nested `super.land()` order. The pipeline owns the ordered post hooks for:

1. raw lower-layer yaw invariant observation;
2. transition/ramp re-entry steering lock;
3. takeoff-facing + explicit-spin ramp orientation;
4. incoming travel reconstruction for ramp return;
5. canonical travel/fakie synchronization;
6. pump landing window / impact bookkeeping.

Lower compatibility wrappers can still execute their historical hook when instantiated directly, but the final runtime sets `deferLandingPostHooks` and applies the composition once at the top level.

### Orientation invariant

Automatic wall/coping/landing yaw writers were removed from runtime. The final runtime no longer inherits `NoAutomaticYawSkillStreetPhysics`; yaw telemetry is initialized by `BaseStatefulSkillStreetPhysics` and applied by `LandingPostPipeline`.

Deterministic replay requires `landingYawInvariantViolations === 0` on every frame. A future contact-driven yaw writer therefore fails CI instead of being silently repaired by a top-level undo.

### CollisionResolver

Body/capsule continuous collision is consumed through an explicit `CollisionResult` boundary. `ParkCollision.move()` still owns the validated substep/overlap solver, while `CollisionResolver` returns copied position/velocity/contact results and exposes no heading/yaw field.

Regression coverage includes solid-wall collision at 3/6/9/12/15 m/s. Collision may correct position and velocity, never orientation.

### CameraState

`FollowCamera` consumes a read-only-by-copy `CameraState` snapshot rather than reading mutable gameplay vectors throughout its update. Camera travel priority remains canonical travel state -> meaningful velocity -> previous camera side -> fakie-adjusted deck fallback.

The collision surface is queried only for presentation occlusion and cannot feed camera state back into physics.

## Inheritance tower reductions completed

- `IntegratedRampSafetySkillStreetPhysics` became a compatibility alias instead of an empty prototype level.
- `WallContactAuthoritySkillStreetPhysics` became a compatibility alias; its old broad-wall 90-degree turn authority is gone.
- automatic wall-turn execution was removed from `MomentumRoll.stepGround()`.
- `RampWallSafety` no longer carries a dead wall-turn detector.
- coping/transition auto-align methods no longer write yaw.
- `NoAutomaticYawSkillStreetPhysics` is no longer part of the final runtime inheritance chain.
- stable/base, bowl and ramp/deck-exit landing mutation share the same executor.
- final runtime ramp orientation, re-entry lock, travel sync, yaw telemetry and pump landing bookkeeping are composed by `LandingPostPipeline` instead of nested post-landing overrides.

## Deterministic replay gates now active

Baseline replay requires finite canonical state and zero landing-yaw violations on every captured frame.

Additional fixed-step multiframe tapes cover:

- passive same-wall ramp return: no spin, no automatic yaw, final fakie;
- explicit 180 ramp return: player-authored 180 preserved, stance reverses, final travel regular;
- geometry-aware coping transfer to a verified deck corridor;
- geometry-aware `abortToReturn` reconnect without deck-target rejection.

Each replay is run twice and must be byte-identical through `firstReplayDivergence()` / final signature checks.

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
- Phase 1 does not merge or deploy to production `main` without an explicit integration decision.

## Compatibility code intentionally retained for review

Some historical classes/files remain so regression tests, old imports and focused subsystem tests keep a stable API while review happens. In the final runtime their duplicate post-landing effects are deferred or bypassed by canonical authorities.

Notably retained:

- `StableRampReturnSkillStreetPhysics.land()` compatibility path;
- `ArcadeParkMobilitySkillStreetPhysics.land()` compatibility path;
- `NoAutomaticYawSkillStreetPhysics` compatibility class/file;
- `TransitionGuide` regression oracle;
- legacy pure wall-recovery helpers used by migration tests only.

These are cleanup candidates after integration confidence, not blockers for authority correctness.

## Review-candidate gate

Before any merge to `main`:

1. compare branch against the current fresh `main` and inspect concurrent production changes;
2. review the authority boundaries and compatibility code above;
3. run the complete Phase 1 CI on the exact integration head;
4. perform browser/gameplay validation of ramps, vert returns, coping transfer, grind/manual and camera feel;
5. merge/deploy only after explicit approval.
