import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  GROUND_MOTOR,
  arcadeTurnGain,
  automaticPushAcceleration,
  groundSteeringDelta,
  passiveRollingResistance,
  rampReentrySteerScale,
  resolveGroundPropulsion,
  signedGroundSpeed,
  transitionGravityScale,
} from '../src/game/core/GroundMotor.js';

test('signed ground speed preserves canonical fakie sign at zero speed', () => {
  const state = signedGroundSpeed({
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
    rollingSign: -1,
  });
  assert.equal(state.travelSign, -1);

  const step = resolveGroundPropulsion({
    speed: state.speed,
    travelSign: state.travelSign,
    forwardY: 0,
    normalY: 1,
    drive: 0,
    dt: 1 / 120,
  });
  assert.ok(step.nextSpeed < 0, `fakie auto-push restarted regular: ${step.nextSpeed}`);
});

test('forward hold remains non-propulsive compared with neutral input', () => {
  const base = {
    speed: 4,
    travelSign: 1,
    forwardY: 0,
    normalY: 1,
    dt: 1 / 120,
  };
  const neutral = resolveGroundPropulsion({ ...base, drive: 0 });
  const forward = resolveGroundPropulsion({ ...base, drive: 1 });
  assert.equal(forward.nextSpeed, neutral.nextSpeed);
  assert.equal(forward.autoPushActive, neutral.autoPushActive);
});

test('ground motor keeps auto-push off transition slopes', () => {
  assert.equal(automaticPushAcceleration({ speed: 2, normalY: 0.80 }), 0);
  assert.equal(automaticPushAcceleration({ speed: 2, normalY: 0.94 }), 0);
  assert.ok(automaticPushAcceleration({ speed: 2, normalY: 1 }) > 0);
});

test('braking removes substantially more speed than rolling resistance', () => {
  const coast = resolveGroundPropulsion({
    speed: 7,
    travelSign: 1,
    normalY: 1,
    forwardY: 0,
    dt: 0.25,
  });
  const brake = resolveGroundPropulsion({
    speed: 7,
    travelSign: 1,
    normalY: 1,
    forwardY: 0,
    brake: true,
    dt: 0.25,
  });
  assert.ok(brake.nextSpeed < coast.nextSpeed - 2.5);
});

test('transition gravity preserves validated uphill/downhill scaling', () => {
  assert.equal(transitionGravityScale({
    signedSpeed: 8,
    forwardY: 0.5,
    normalY: 0.8,
  }), GROUND_MOTOR.uphillGravityScale);
  assert.equal(transitionGravityScale({
    signedSpeed: -8,
    forwardY: 0.5,
    normalY: 0.8,
  }), GROUND_MOTOR.downhillGravityScale);
  assert.equal(transitionGravityScale({
    signedSpeed: 8,
    forwardY: 0.5,
    normalY: 1,
  }), 1);
});

test('ground steering owns the complete park carve curve', () => {
  const dt = 1 / 120;
  const low = Math.abs(groundSteeringDelta({ steer: 1, speed: 0, dt }));
  const park = Math.abs(groundSteeringDelta({ steer: 1, speed: 12, dt }));
  const expectedLow = GROUND_MOTOR.turnGainLowSpeed * GROUND_MOTOR.steerRateLowSpeed * dt;
  const expectedPark = arcadeTurnGain(12)
    * GROUND_MOTOR.steerRateHighSpeed * dt;
  assert.ok(low > park);
  assert.ok(Math.abs(low - expectedLow) < 1e-9);
  assert.ok(Math.abs(park - expectedPark) < 1e-9);
});

test('reentry steering lock is part of the same canonical motor decision', () => {
  const dt = 1 / 120;
  const locked = groundSteeringDelta({
    steer: 1,
    speed: 8,
    reentryRemaining: GROUND_MOTOR.rampReentrySteerLock - 0.03,
    dt,
  });
  const blended = groundSteeringDelta({
    steer: 1,
    speed: 8,
    reentryRemaining: GROUND_MOTOR.rampReentrySteerLock - 0.13,
    dt,
  });
  const free = groundSteeringDelta({ steer: 1, speed: 8, reentryRemaining: 0, dt });
  assert.equal(locked, 0);
  assert.ok(Math.abs(blended) > 0 && Math.abs(blended) < Math.abs(free));
  assert.equal(rampReentrySteerScale(0), 1);
});

test('rolling resistance stays at the validated low-drag values', () => {
  assert.ok(passiveRollingResistance(6) < 0.2);
  assert.ok(passiveRollingResistance(10) < 0.35);
});
