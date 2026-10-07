import test from 'node:test';
import assert from 'node:assert/strict';

import { ArcadeParkMobilitySkillStreetPhysics } from '../src/game/ArcadeParkMobilitySkillStreetPhysics.js';
import {
  WallContactAuthoritySkillStreetPhysics,
} from '../src/game/WallContactAuthoritySkillStreetPhysics.js';
import { StableRampReturnSkillStreetPhysics } from '../src/game/StableRampReturnSkillStreetPhysics.js';

import { RampWallSafetySkillStreetPhysics } from '../src/game/RampWallSafetySkillStreetPhysics.js';
import {
  IntegratedRampSafetySkillStreetPhysics,
} from '../src/game/IntegratedRampSafetySkillStreetPhysics.js';
import { DeckAwareRampExitSkillStreetPhysics } from '../src/game/DeckAwareRampExitSkillStreetPhysics.js';
import { SafeCopingExitSkillStreetPhysics } from '../src/game/SafeCopingExitSkillStreetPhysics.js';
import { StreetSkater } from '../src/game/StreetSkater.js';
import { YawStableStreetSkater } from '../src/game/YawStableStreetSkater.js';

test('wall authority compatibility alias is not a runtime prototype level', () => {
  assert.equal(WallContactAuthoritySkillStreetPhysics, ArcadeParkMobilitySkillStreetPhysics);
  assert.equal(
    Object.getPrototypeOf(StableRampReturnSkillStreetPhysics),
    ArcadeParkMobilitySkillStreetPhysics,
  );
});

test('integrated ramp safety compatibility alias is not a runtime prototype level', () => {
  assert.equal(IntegratedRampSafetySkillStreetPhysics, RampWallSafetySkillStreetPhysics);
  assert.equal(
    Object.getPrototypeOf(DeckAwareRampExitSkillStreetPhysics),
    RampWallSafetySkillStreetPhysics,
  );
});


test('transfer launch has one runtime takeoff application seam', () => {
  assert.equal(
    Object.hasOwn(RampWallSafetySkillStreetPhysics.prototype, 'takeoff'),
    false,
    'RampWallSafety must not mutate transfer launch state',
  );
  assert.equal(
    Object.hasOwn(DeckAwareRampExitSkillStreetPhysics.prototype, 'takeoff'),
    false,
    'DeckAwareRampExit must provide geometry/landing services only',
  );
  assert.equal(
    Object.hasOwn(SafeCopingExitSkillStreetPhysics.prototype, 'takeoff'),
    true,
    'SafeCopingExit is the single transfer-launch application seam',
  );
});


test('yaw-stable presentation compatibility alias is not a runtime prototype level', () => {
  assert.equal(YawStableStreetSkater, StreetSkater);
});


test('final momentum chain bypasses standalone BowlLanding compatibility class', async () => {
  const { MomentumRollSkillStreetPhysics } = await import('../src/game/MomentumRollSkillStreetPhysics.js');
  const { StableBoardContactSkillStreetPhysics } = await import('../src/game/StableBoardContactSkillStreetPhysics.js');
  const { BowlLandingSkillStreetPhysics } = await import('../src/game/BowlLandingSkillStreetPhysics.js');

  assert.equal(Object.getPrototypeOf(MomentumRollSkillStreetPhysics.prototype), StableBoardContactSkillStreetPhysics.prototype);
  assert.notEqual(Object.getPrototypeOf(MomentumRollSkillStreetPhysics.prototype), BowlLandingSkillStreetPhysics.prototype);
});


test('final stateful runtime bypasses BaseStateful compatibility wrapper', async () => {
  const { StatefulSkillStreetPhysics } = await import('../src/game/StatefulSkillStreetPhysics.js');
  const { StableRampReturnSkillStreetPhysics } = await import('../src/game/StableRampReturnSkillStreetPhysics.js');
  const { StatefulSkillStreetPhysics: BaseStateful } = await import('../src/game/BaseStatefulSkillStreetPhysics.js');

  assert.equal(Object.getPrototypeOf(StatefulSkillStreetPhysics.prototype), StableRampReturnSkillStreetPhysics.prototype);
  assert.notEqual(Object.getPrototypeOf(StatefulSkillStreetPhysics.prototype), BaseStateful.prototype);
});


test('final stateful runtime bypasses UnifiedRampFeel compatibility wrapper', async () => {
  const { StatefulSkillStreetPhysics } = await import('../src/game/StatefulSkillStreetPhysics.js');
  const { StableRampReturnSkillStreetPhysics } = await import('../src/game/StableRampReturnSkillStreetPhysics.js');
  const { UnifiedRampFeelSkillStreetPhysics } = await import('../src/game/UnifiedRampFeelSkillStreetPhysics.js');

  assert.equal(Object.getPrototypeOf(StatefulSkillStreetPhysics.prototype), StableRampReturnSkillStreetPhysics.prototype);
  assert.notEqual(Object.getPrototypeOf(StatefulSkillStreetPhysics.prototype), UnifiedRampFeelSkillStreetPhysics.prototype);
});


test('landing post-processing is not duplicated in arcade or momentum layers', async () => {
  const { MomentumRollSkillStreetPhysics } = await import('../src/game/MomentumRollSkillStreetPhysics.js');

  assert.equal(
    Object.hasOwn(ArcadeParkMobilitySkillStreetPhysics.prototype, 'land'),
    false,
    'ArcadeParkMobility must not own landing post-processing',
  );
  assert.equal(
    Object.hasOwn(MomentumRollSkillStreetPhysics.prototype, 'land'),
    false,
    'MomentumRoll must not own travel/fakie landing post-processing',
  );
});
