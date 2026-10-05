import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSharpDeckBlocker,
  isUnsafeSupportDrop,
} from '../src/game/StableBoardContactSkillStreetPhysics.js';

test('nose/tail blocker accepts vertical ledge faces', () => {
  assert.equal(isSharpDeckBlocker({ y: 0.01 }), true);
  assert.equal(isSharpDeckBlocker({ y: -0.04 }), true);
});

test('nose/tail blocker ignores rideable transition faces', () => {
  assert.equal(isSharpDeckBlocker({ y: 0.22 }), false);
  assert.equal(isSharpDeckBlocker({ y: 0.68 }), false);
  assert.equal(isSharpDeckBlocker({ y: -0.3 }), false);
});

test('partial support cannot pull the board sharply downward', () => {
  assert.equal(isUnsafeSupportDrop({
    contactCount: 1,
    maxWheelGap: 0.12,
    correctionAlongNormal: -0.06,
    normalContinuity: 1,
  }), true);
  assert.equal(isUnsafeSupportDrop({
    contactCount: 2,
    maxWheelGap: 0.08,
    correctionAlongNormal: -0.05,
    normalContinuity: 0.99,
  }), true);
});

test('small seam corrections remain grounded', () => {
  assert.equal(isUnsafeSupportDrop({
    contactCount: 2,
    maxWheelGap: 0.025,
    correctionAlongNormal: -0.025,
    normalContinuity: 0.99,
  }), false);
});

test('disconnected lower flat surface becomes air instead of a down snap', () => {
  assert.equal(isUnsafeSupportDrop({
    contactCount: 4,
    maxWheelGap: 0.11,
    correctionAlongNormal: -0.09,
    normalContinuity: 0.995,
  }), true);
});

test('continuous changing transition normal is not mistaken for a drop', () => {
  assert.equal(isUnsafeSupportDrop({
    contactCount: 4,
    maxWheelGap: 0.10,
    correctionAlongNormal: -0.08,
    normalContinuity: 0.82,
  }), false);
});
