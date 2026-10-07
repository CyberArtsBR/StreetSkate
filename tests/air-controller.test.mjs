import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretAirTurn } from '../src/input/InputInterpreter.js';
import {
  AIR_CONTROL,
  resolveAirMotion,
} from '../src/game/core/AirController.js';

test('air motion preserves heading when there is no deliberate turn input', () => {
  const result = resolveAirMotion({
    airHeading: 0.35,
    airSpin: 0,
    turnInput: 0,
    velocityY: 4,
    gravity: 20,
    dt: 1 / 120,
  });
  assert.ok(Math.abs(result.airSpin) < 1e-12);
  assert.ok(Math.abs(result.heading - 0.35) < 1e-12);
  assert.ok(Math.abs(result.velocityY - (4 - 20 / 120)) < 1e-12);
});

test('explicit current-frame air direction owns airborne yaw', () => {
  const dt = 1 / 120;
  const turn = interpretAirTurn({ steer: 1, spin: 0 });
  const result = resolveAirMotion({
    airHeading: 0.35,
    airSpin: 0,
    turnInput: turn,
    velocityY: 3,
    gravity: 20,
    dt,
  });
  assert.equal(turn, 1);
  assert.ok(Math.abs(result.airSpin + AIR_CONTROL.turnRate * dt) < 1e-12);
  assert.ok(result.heading < 0.35);
});

test('bumper spin and directional air input share one semantic clamp', () => {
  assert.equal(interpretAirTurn({ steer: 0.6, spin: 0.7 }), 1);
  assert.equal(interpretAirTurn({ steer: -0.6, spin: -0.7 }), -1);
  assert.ok(Math.abs(interpretAirTurn({ steer: 0.6, spin: -0.2 }) - 0.4) < 1e-12);
});

test('air controller clamps compatibility turn input but never reads contact geometry', () => {
  const dt = 1 / 120;
  const result = resolveAirMotion({
    airHeading: 0,
    airSpin: 0,
    turnInput: 99,
    velocityY: 0,
    gravity: 0,
    dt,
  });
  assert.ok(Math.abs(
    result.airSpin + AIR_CONTROL.maxTurnInput * AIR_CONTROL.turnRate * dt
  ) < 1e-12);
  assert.equal('normal' in result, false);
  assert.equal('headingFromContact' in result, false);
});
