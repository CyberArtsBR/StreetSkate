# StreetSkate Phase 1 — Migration Status

Branch: `refactor/core-skate-controller-v1`

Production `main` remains untouched by this refactor branch.

Status: **REVIEW CANDIDATE — NOT MERGED / NOT DEPLOYED**

Latest validated gameplay/test head before this documentation-only commit: `37b329926d0366740f96bcd8cb547f0ea55bf3f8`.

Current production `main` is still the original Phase 1 baseline: `b9d657ad813975857219dab37089dd2ec96ccb24`. There are no concurrent production changes to reconcile at this checkpoint.

## Canonical authorities active in final runtime

### TransitionController

The final runtime uses `TransitionController` for authored transition selection, IDs/types/capabilities, approach/launch detection, vert begin/advance trajectory and presentation normal. `TransitionGuide` remains a compatibility/regression oracle only.

### InputInterpreter

Ollie release semantics are interpreted once. The interpreter owns ollie, pump, vert ollie, grind ollie-out, blocked pump and air-release meaning.

### TravelState

`resolveTravelState()` is the canonical derivation for world travel direction, signed travel relative to the deck and fakie. Legacy `rollingSign`, `fakie` and `travelDirection` fields remain synchronized compatibility outputs.

### LaunchEnergyModel

Ramp launch energy has one authority. Lower layers no longer inject an independent second ramp boost.

### TakeoffContext

`captureTakeoffContext()` is now the canonical read-only pre-launch facts boundary. It derives/captures:

- player-authored takeoff facing, heading and stance;
- current and remembered ramp bonus;
- the one composed launch impulse;
- authored/generic ramp context;
- buffered ramp-exit intent;
- canonical transition ID/type when supplied.

`UnifiedRampFeelSkillStreetPhysics.takeoff()` consumes this context for ramp-energy composition and ramp-context detection. `StableRampReturnSkillStreetPhysics.takeoff()` consumes the same context for facing/heading/stance capture while passing the received impulse through unchanged, so energy cannot be composed a second time there.

Geometry-aware deck/coping behavior intentionally remains staged after transition creation in `DeckAwareRampExitSkillStreetPhysics` and `SafeCopingExitSkillStreetPhysics`. That ordering is sensitive and will only be migrated behind dedicated parity tests; it is not currently duplicated into `TakeoffContext`.

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

The final runtime defers historical nested post hooks and applies this composition once at the top level. The direct `StableRampReturnSkillStreetPhysics` compatibility path now does the same: lower acceptance/routing still executes, but nested post hooks are deferred and the canonical pipeline runs exactly once. Regression coverage asserts one immediate travel sync per accepted landing.

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
- the direct `StableRampReturn` compatibility landing path also defers nested post hooks and runs the canonical post pipeline exactly once.
- duplicated pre-launch ramp-energy and takeoff-facing calculations now consume `TakeoffContext` instead of being re-derived independently.

## Deterministic replay / regression gates now active

Baseline replay requires finite canonical state and zero landing-yaw violations on every captured frame.

Additional fixed-step multiframe tapes and focused regressions cover:

- passive same-wall ramp return: no spin, no automatic yaw, final fakie;
- explicit 180 ramp return: player-authored 180 preserved, stance reverses, final travel regular;
- geometry-aware coping transfer to a verified deck corridor;
- geometry-aware `abortToReturn` reconnect without deck-target rejection;
- broad solid-wall collision at 3/6/9/12/15 m/s;
- one immediate canonical travel sync per final landing;
- one immediate canonical travel sync through the direct stable-ramp compatibility path;
- flat ollie takeoff context;
- remembered ramp bonus surviving a flat final lip frame;
- live slope launch-energy parity;
- authored transition takeoff context;
- runtime takeoff facing/heading/stance capture.

Deterministic replays are run twice and must be byte-identical through `firstReplayDivergence()` / final signature checks.

## Current invariants

- No ramp, coping, wall, rail or collision contact may create horizontal yaw.
- Explicit air spin remains the only airborne yaw input.
- Ground steering remains the only normal grounded yaw input.
- Fakie is derived from deck heading versus travel, not restored as a ramp-specific boolean.
- Transition identity must be authored and canonical.
- Ramp launch energy has one authority.
- Pre-launch facing/heading/stance and ramp-context facts have one canonical capture boundary.
- Collision results contain no heading/yaw authority.
- Camera consumes copied presentation state and cannot mutate physics.
- The original production arena remains active.
- Phase 1 does not merge or deploy to production `main` without an explicit integration decision.

## Compatibility code intentionally retained for review

Some historical classes/files remain so regression tests, old imports and focused subsystem tests keep a stable API while review happens. In the final runtime their duplicate effects are deferred, bypassed or reduced to compatibility seams around canonical authorities.

Notably retained:

- `StableRampReturnSkillStreetPhysics.land()` as a compatibility entrypoint, now backed by exactly one canonical `LandingPostPipeline` execution;
- `ArcadeParkMobilitySkillStreetPhysics.land()` compatibility re-entry-lock hook for direct subsystem instances;
- `NoAutomaticYawSkillStreetPhysics` compatibility class/file, no longer in final runtime inheritance;
- `TransitionGuide` regression oracle;
- legacy pure wall-recovery helpers used by migration tests only.

These are cleanup candidates after integration confidence, not blockers for authority correctness.

## Remaining Phase 1 architecture risk

The main remaining multi-stage core path is takeoff **after** the pre-launch context:

1. contextual ramp-exit intent may select/tag a transition;
2. lower transition/base takeoff creates `transitionAir`;
3. real deck geometry is scanned behind coping;
4. deck-aware transfer velocity/target is authored;
5. unsafe/narrow deck handling may convert transfer back to same-wall return;
6. takeoff metadata is attached to the transition-air frame.

This ordering is currently validated and should not be flattened blindly. The next architecture slice should create a parity-tested post-takeoff/transfer pipeline before moving those responsibilities out of their existing classes.

## Review-candidate gate

Before any merge to `main`:

1. compare branch against the current fresh `main` and inspect concurrent production changes;
2. review the authority boundaries and compatibility code above;
3. run the complete Phase 1 CI on the exact integration head;
4. perform browser/gameplay validation of ramps, vert returns, coping transfer, grind/manual and camera feel;
5. merge/deploy only after explicit approval.
