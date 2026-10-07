# StreetSkate Phase 1 — Core Authority Map

Baseline production `main`: `b9d657ad813975857219dab37089dd2ec96ccb24`

Development branch: `refactor/core-skate-controller-v1`

Production `main` is unchanged by Phase 1.

## Why Phase 1 was needed

The baseline runtime used a long inheritance chain where several layers could independently rewrite the same gameplay concepts: landing, ramp launch, transfer trajectory, heading, fakie/travel state, collision response and input meaning. Fixing one layer could therefore be overridden later by another `super` call.

Phase 1 keeps compatibility class names where useful, but moves decision authority into explicit pure/result modules and composes those results at controlled runtime seams.

## Current runtime chain

The final runtime now instantiates `StreetSkater` directly. `YawStableStreetSkater` is a compatibility alias only; its coping-safe orientation basis was moved into `StreetSkater`, eliminating the duplicate PlayerState / TransitionController instances that wrapper used to create.

The final skater still uses compatibility inheritance for migration safety, but several levels are now aliases or thin adapters rather than independent gameplay authorities:

```text
StreetSkater
   └─ StatefulSkillStreetPhysics             composition root + input/pump/ramp-energy + landing post
      └─ StableRampReturnSkillStreetPhysics  explicit-spin air orientation + return semantics
         └─ ArcadeParkMobility...            carve + grind magnet + re-entry steer lock
            └─ SafeCopingExit...             coping safety / continuous re-entry geometry
               └─ DeckAwareRampExit...       real deck scan / landing corridor / catch
                  └─ RampWallSafety...        transition landing + transfer-flight executor
                     └─ MomentumRoll...       ground momentum + canonical travel sync
                        └─ StableBoardContact... board support + explicit collision-result application
                           └─ BoardContact...
                              └─ SkillStreetPhysics
                                 └─ StreetPhysics
```

`NoAutomaticYawSkillStreetPhysics` still exists as a compatibility file but is no longer in the final runtime chain.

## Current canonical authority table

| State / behavior | Canonical authority | Runtime application seam | Legacy status |
|---|---|---|---|
| transition identity / authored ramp selection | `TransitionMetadata` + `TransitionController` | `StatefulSkillStreetPhysics.transitions` | `TransitionGuide` retained as regression oracle only |
| transition approach / launch detection | `TransitionController` | board/ramp takeoff paths | name-regex authority removed |
| vert begin / advance trajectory | `TransitionController` | VERT_AIR path | old guide no longer runtime authority |
| ollie / pump / vert / grind-out command meaning | `CoreSkateController` + `InputInterpreter` | top `StatefulSkillStreetPhysics.advance()` | raw release interpretation removed from PumpSystem |
| world travel direction / sign / fakie | `CoreSkateController.syncTravel()` + `TravelState` | canonical PlayerState first, then compatibility outputs | legacy fields synchronized outputs only |
| ground steering / propulsion / rolling resistance / flat auto-push | `CoreSkateController` + `GroundMotor` | `MomentumRoll.stepGround()` adapter applies explicit results | duplicated motor math removed from inheritance layer |
| ramp launch energy | `CoreSkateController` + `LaunchEnergyModel` | top `StatefulSkillStreetPhysics.stepGround()/takeoff()` | `UnifiedRampFeel` compatibility wrapper bypassed |
| pre-launch facing / heading / stance / ramp context | `TakeoffContext` | top `StatefulSkillStreetPhysics` + `StableRampReturn` | duplicated pre-launch math removed |
| controlled coping-transfer launch profile | `TransferLaunchResult` | single `SafeCopingExit.takeoff()` transfer-launch seam | lower ramp layers cannot mutate transfer launch |
| real-deck transfer / missing-deck return decision | `TransferLaunchResult` | deck geometry evidence feeds the `SafeCopingExit` launch seam | scan remains geometry service; decision math centralized |
| narrow/unsafe deck return decision | `TransferLaunchResult` | `SafeCopingExit.takeoff()` | deck-fit rule centralized |
| airborne transfer flight | `TransferFlightResult` | single `RampWallSafety.advanceControlledTransfer()` | DeckAware override removed and structurally forbidden by test |
| landing route priority | `LandingPolicy` | DeckAware / SafeCoping landing filters | independent route trees removed |
| landing acceptance / alignment / catch/bail | `LandingResult` | stable/base + bowl/ramp adapters | duplicated acceptance bodies removed |
| accepted touchdown state mutation | `LandingExecutor` | all accepted landing paths | projected support tangent cannot write yaw |
| post-landing orientation / travel / pump bookkeeping | `LandingPostPipeline` | top runtime + direct StableRampReturn compatibility path | nested post hooks deferred; one execution per landing |
| horizontal yaw invariant | player steering + explicit air spin only | orientation + replay invariants | wall/coping/contact auto-yaw removed |
| body continuous collision | `CoreSkateController` + `CollisionResolver` over validated `ParkCollision.move()` | `StableBoardContact.resolveMotion()` | collision result has no heading/yaw field |
| four-wheel support | board contact solver | StableBoardContact / LandingResult | preserved from validated baseline |
| camera input snapshot | `CameraState` | `FollowCamera` | presentation cannot mutate physics |
| replay state observation | `GameplayStateSnapshot` | deterministic replay + debug HUD | side-effect free |

## Composition root

`CoreSkateController` is now the shared owner for canonical services used by the final runtime:

- `PlayerState`;
- `TransitionController`;
- `CollisionResolver`;
- semantic Ollie/pump/vert/grind-out interpretation;
- canonical travel synchronization;
- canonical ground motor decisions (signed speed, player steering delta, gravity/push/drag);
- remembered ramp-energy sampling / takeoff context orchestration.

Compatibility subclasses still execute validated gameplay behavior, but new authority must attach to this composition root instead of adding another physics inheritance layer.

## Orientation contract

Horizontal yaw may change only from:

1. deliberate grounded steering;
2. explicit airborne spin input;
3. explicit player-authored trick behavior where intended.

It may **not** be created by:

- ramp normal;
- coping contact;
- landing projection;
- wall collision;
- rail collision;
- collision recovery;
- transfer targeting;
- travel/fakie synchronization.

`landingYawInvariantViolations` is captured in deterministic replay and must remain zero every frame.

## Travel / stance contract

Canonical concepts:

- `deckHeading`: where the board/nose faces horizontally;
- `travelDirection`: where the board actually moves in world space;
- `stance`: rider stance;
- `fakie`: derived relationship between deck facing and travel.

Passive same-wall vert return therefore keeps yaw but may become fakie when travel reverses. An explicit 180 changes deck facing through player input and may realign it with return travel.

## Transition / transfer contract

Authored transition identity is explicit. Important production coping/vert rails are selected by metadata, not by arbitrary names containing `coping`.

Takeoff is now separated into explicit responsibilities:

```text
InputInterpreter / ramp intent
        ↓
TransitionController candidate
        ↓
LaunchEnergyModel + TakeoffContext
        ↓
base transitionAir creation
        ↓
TransferLaunchResult
  ├─ controlled transfer profile
  ├─ real-deck target / missing-deck return
  └─ unsafe-deck return
        ↓
TransferFlightResult
  ├─ generic flight
  ├─ verified deck targeting
  └─ abort-to-return flight
```

The actual deck raycast stays in `DeckAwareRampExit` because it is geometry evidence, not gameplay decision authority.

## Landing contract

```text
board/support geometry
        ↓
LandingPolicy route
        ↓
LandingResult acceptance
        ↓
LandingExecutor touchdown mutation
        ↓
LandingPostPipeline
```

No support normal or projected tangent is allowed to manufacture horizontal heading.

## Collision contract

`CollisionResolver` returns explicit copied results:

- resolved position;
- resolved velocity;
- contacts / wall contacts.

It cannot return or mutate yaw. High-speed wall tests cover approximately 3 / 6 / 9 / 12 / 15+ m/s.

## Deterministic verification boundary

`captureGameplayState()` provides the canonical JSON-safe fixed-step snapshot for replay and debugging. The Phase 1 acceptance matrix now includes:

- baseline fixed-step determinism and finite-state checks;
- passive same-wall ramp return with zero invented yaw;
- explicit 180 return with canonical stance/fakie relationship;
- authored transition identity and trajectory parity;
- wide-deck coping transfer;
- narrow-deck / abort-to-return path;
- transfer flight before/after apex;
- high-speed wall impact replay with no tunnelling and no yaw authority;
- air-to-touchdown manual bridge using real up/down tap input;
- repeated pump-release replay with canonical energy / delta-speed transaction output;
- generic bank/kicker ramp-memory launch through the real Ollie/takeoff path;
- >2 m deterministic big-air result with zero no-input yaw;
- collision speed coverage at approximately 3 / 6 / 9 / 12 / 15+ m/s;
- existing grind/manual balance regressions;
- board / vert / pump dedicated verifiers.

Replay snapshots also expose pump energy/delta speed, transition identity, wheel support, canonical travel/fakie state, and landing-yaw invariant counters.

## Compatibility shells intentionally retained

Phase 1 does not delete every historical filename simply to shorten the tree. These remain where they protect old imports/tests while carrying no competing authority:

- `IntegratedRampSafetySkillStreetPhysics` alias;
- `WallContactAuthoritySkillStreetPhysics` alias;
- `NoAutomaticYawSkillStreetPhysics` compatibility file outside final runtime;
- `YawStableStreetSkater` compatibility alias; coping-safe basis lives in `StreetSkater`;
- `BaseStatefulSkillStreetPhysics` compatibility wrapper outside final runtime;
- `UnifiedRampFeelSkillStreetPhysics` compatibility wrapper outside final runtime;
- `BowlLandingSkillStreetPhysics` standalone compatibility/regression class outside final runtime;
- `TransitionGuide` oracle;
- pure legacy helpers used only for parity/tuning tests.

Deleting these files can be a later cleanup after staging confidence; it is no longer required to obtain single gameplay authority.

## Phase 1 merge gate

Core architecture is a review candidate, not production-approved yet.

Before merge:

1. `main` must still be checked fresh for concurrent work;
2. full Phase 1 CI must pass on the exact integration head;
3. branch needs a browser/staging build;
4. production-park gameplay must be tested across ramps, vert return, coping transfer, grind/manual, clipping and camera reversal;
5. merge/deploy requires explicit approval.

The sealed Game Development Studio GPU/performance CLI is unavailable in the current environment, so no sealed GPU capture or measured frame-time claim is made in Phase 1 documentation.
