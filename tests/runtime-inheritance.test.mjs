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
