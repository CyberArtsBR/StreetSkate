# StreetSkate Phase 1 — Runtime Authority Baseline

Baseline main SHA: `b9d657ad813975857219dab37089dd2ec96ccb24`

Development branch: `refactor/core-skate-controller-v1`

This document freezes the Phase 1 starting architecture before any gameplay behavior is migrated. It is intentionally descriptive: the first Phase 1 slice adds observability/replay without changing physics feel.

## Actual runtime inheritance chain

The active skater is instantiated through `YawStableStreetSkater`, whose physics path is:

```text
YawStableStreetSkater
└─ StreetSkater
   └─ StatefulSkillStreetPhysics        (pump wrapper)
      └─ BaseStatefulSkillStreetPhysics (movement-state sync)
         └─ NoAutomaticYawSkillStreetPhysics
            └─ UnifiedRampFeelSkillStreetPhysics
               └─ StableRampReturnSkillStreetPhysics
                  └─ WallContactAuthoritySkillStreetPhysics
                     └─ ArcadeParkMobilitySkillStreetPhysics
                        └─ SafeCopingExitSkillStreetPhysics
                           └─ DeckAwareRampExitSkillStreetPhysics
                              └─ IntegratedRampSafetySkillStreetPhysics
                                 └─ RampWallSafetySkillStreetPhysics
                                    └─ MomentumRollSkillStreetPhysics
                                       └─ BowlLandingSkillStreetPhysics
                                          └─ StableBoardContactSkillStreetPhysics
                                             └─ BoardContactSkillStreetPhysics
                                                └─ SkillStreetPhysics
                                                   └─ StreetPhysics
```

This is the core Phase 1 risk: several layers override the same semantic operations (`land`, `takeoff`, `stepGround`, `stepAir`, `resolveMotion`, travel/fakie synchronization), so final behavior depends on call order through `super` rather than on one explicit controller.

## Current authority map

| State / behavior | Current writers / owners | Conflict observed | Phase 1 target owner |
|---|---|---|---|
| `position` | `StreetPhysics`, board-contact layers, coping/deck recovery, wall recovery, grind/manual code | collision/contact/transition code can all correct position | `CollisionResolver` + `BoardContactSolver`, applied through `SkateController` |
| `velocity` | `StreetPhysics`, `SkillStreetPhysics`, `MomentumRoll`, ramp safety, deck exit, coping recovery, pump, grind/manual | ramp energy and recovery are additive across layers | `GroundMotor`, `EnergyModel`, `AirController`, `CollisionResolver` with explicit result merge |
| `heading` | base ground steer, legacy collision alignment, grind/wallride, ramp/landing layers, final no-auto-yaw guard | lower layers may write yaw then upper layers undo/replace it | `OrientationController` / canonical `deckHeading` |
| `airHeading` | base takeoff/air, grind exits, stable ramp return, no-auto-yaw landing | duplicates `heading` semantics | derive from `deckHeading` + explicit air spin |
| `airSpin` | base air solver, stable ramp return constraints, landing/trick accounting | steering historically leaked into air spin | `AirController` explicit spin only |
| `movementState` | base `setMovementState`, gameplay systems, final sync wrapper | boolean substate and enum can disagree | one explicit `PlayerState.mode` FSM |
| `grounded` | derived by `setMovementState`, then also inferred/overridden by contact paths | duplicated source of truth | derived from canonical mode/contact result |
| `normal` | ground/contact solver, landing, coping/transition support | legitimate shared geometry state but modified at several levels | `BoardContactSolver` support result |
| `stance` | base switch input, stable ramp landing | stance can be changed independently of fakie/travel | canonical rider `stance`; never used as travel sign |
| `fakie` | momentum layer, integrated landing, stable ramp wrapper | can disagree with rolling sign / stance | derived from `deckHeading` vs `travelDirection` |
| `rollingSign` | momentum layer, ramp landing, support motion | duplicates travel/deck relationship | remove after migration; derive sign when needed |
| `travelDirection` | momentum layer, integrated landing, collision/ground motion | can lag or contradict velocity/facing | canonical normalized movement direction derived from velocity with hysteresis |
| `transitionAir` | base transition guide, multiple coping/ramp layers | authored vert and generic ramp paths diverge | `TransitionController` state |
| ramp launch boost | `ArcadeParkMobility` + `UnifiedRampFeel` + legacy vert/ollie paths | explicit compensation needed to avoid double boost | one `EnergyModel` |
| pumping | `StatefulSkillStreetPhysics` wrapper intercepts ollie release | pump and ollie intent share raw release path | `InputInterpreter` command + `PumpController` |
| landing | base + board contact + bowl + ramp safety + safe coping + stable return + no-auto-yaw | most serious multi-authority path | `BoardContactSolver` → `LandingResult` → `SkateController` |
| wall response | base collision, momentum recovery, ramp-wall classifier, wall-authority layer, no-auto-yaw disabling layer | dead/contradictory automatic-turn code remains underneath final guard | `CollisionResolver`; no automatic yaw |
| camera direction | `FollowCamera` from runtime movement/travel state | physics regressions can become camera regressions | future `CameraStateController` |
| visual orientation | `StreetSkater` + `YawStableStreetSkater` | presentation needs a late singularity guard | future `PresentationController` using canonical orientation |

## High-risk duplicate methods

These methods currently exist at multiple levels and must be migrated carefully rather than deleted at once:

- `land(support)`
- `takeoff(impulse, transition)`
- `stepGround(dt, input, drive)`
- `stepAir(dt, input, drive, before)`
- `resolveMotion(before, beforeUp, input)`
- `detectGroundWallImpact(dt)`
- `applyWallRecovery(hit)`
- `autoAlignOriginalTransition(...)`
- `syncTravelDirection(...)`
- `reset(...)`

## Phase 1 invariants to preserve during migration

1. Fixed simulation cadence remains 120 Hz.
2. Original `insanity-inspired-park.glb` + `park-collision.glb` stay active.
3. Four-wheel board contact remains available.
4. Grinds/manuals/tricks/pumping remain functional while being migrated.
5. No contact/ramp/wall system is allowed to create horizontal yaw automatically.
6. Explicit Q/E or LB/RB air spin remains authoritative.
7. Production `main` is not modified by Phase 1 experimental work.

## New observability boundary

Phase 1 introduces `captureGameplayState()` as a side-effect-free JSON snapshot of current legacy runtime state. Replay tests consume the snapshot rather than reading arbitrary internals differently in every test.

The first replay harness intentionally drives the existing runtime unchanged. Its purpose is to establish deterministic before/after evidence for later controller migration.

## Next migration slice

After this baseline is validated:

1. introduce a canonical `PlayerState` adapter without changing physics;
2. make `deckHeading`, `travelDirection`, and derived fakie explicit;
3. add invariant assertions for forbidden automatic yaw;
4. build transition metadata for every production ramp;
5. migrate one ramp path at a time into `TransitionController` behind replay parity tests.
