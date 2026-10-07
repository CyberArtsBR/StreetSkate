import test from 'node:test';
import assert from 'node:assert/strict';

import { StableRampReturnSkillStreetPhysics } from '../src/game/StableRampReturnSkillStreetPhysics.js';
import { RampWallSafetySkillStreetPhysics } from '../src/game/RampWallSafetySkillStreetPhysics.js';
import { DeckAwareRampExitSkillStreetPhysics } from '../src/game/DeckAwareRampExitSkillStreetPhysics.js';
import { SafeCopingExitSkillStreetPhysics } from '../src/game/SafeCopingExitSkillStreetPhysics.js';

test('transfer launch has one runtime takeoff application seam', () => {
  assert.equal(Object.hasOwn(RampWallSafetySkillStreetPhysics.prototype, 'takeoff'), false);
  assert.equal(Object.hasOwn(DeckAwareRampExitSkillStreetPhysics.prototype, 'takeoff'), false);
  assert.equal(Object.hasOwn(SafeCopingExitSkillStreetPhysics.prototype, 'takeoff'), true);
});

test('final momentum chain goes directly through StableBoardContact', async () => {
  const { MomentumRollSkillStreetPhysics } = await import('../src/game/MomentumRollSkillStreetPhysics.js');
  const { StableBoardContactSkillStreetPhysics } = await import('../src/game/StableBoardContactSkillStreetPhysics.js');
  assert.equal(Object.getPrototypeOf(MomentumRollSkillStreetPhysics.prototype), StableBoardContactSkillStreetPhysics.prototype);
});

test('final stateful runtime goes directly through StableRampReturn', async () => {
  const { StatefulSkillStreetPhysics } = await import('../src/game/StatefulSkillStreetPhysics.js');
  assert.equal(Object.getPrototypeOf(StatefulSkillStreetPhysics.prototype), StableRampReturnSkillStreetPhysics.prototype);
});

test('runtime chain does not contain deleted compatibility wrappers', async () => {
  const { StatefulSkillStreetPhysics } = await import('../src/game/StatefulSkillStreetPhysics.js');
  const names = [];
  let proto = StatefulSkillStreetPhysics.prototype;
  while (proto) {
    names.push(proto.constructor?.name || '');
    proto = Object.getPrototypeOf(proto);
  }
  for (const dead of [
    'UnifiedRampFeelSkillStreetPhysics',
    'BowlLandingSkillStreetPhysics',
    'IntegratedRampSafetySkillStreetPhysics',
    'NoAutomaticYawSkillStreetPhysics',
    'YawStableStreetSkater',
  ]) assert.equal(names.includes(dead), false, `${dead} leaked back into runtime chain`);
});
