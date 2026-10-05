import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCADE_PARK_MOBILITY,
  arcadeGrindEligibility,
  arcadeRampAirBoost,
  arcadeTurnGain,
} from '../src/game/ArcadeParkMobilitySkillStreetPhysics.js';
import { grindProfile } from '../src/game/SkateSystems.js';

test('THPS rail magnet catches an ascending rider below a handrail', () => {
  const eligible = arcadeGrindEligibility({
    surfaceDistance: 0.38,
    verticalDelta: -0.30,
    velocityY: 2.6,
    tangentAlignment: 0.78,
    tangentSpeed: 6.2,
    profile: grindProfile('50-50'),
  });
  assert.equal(eligible, true);
  assert.ok(ARCADE_PARK_MOBILITY.railCaptureDistance >= 0.5);
  assert.ok(ARCADE_PARK_MOBILITY.railCaptureBelow >= 0.4);
});

test('rail magnet still rejects rails that are clearly out of reach', () => {
  assert.equal(arcadeGrindEligibility({
    surfaceDistance: 0.68,
    verticalDelta: -0.25,
    velocityY: 1.5,
    tangentAlignment: 0.8,
    tangentSpeed: 5,
    profile: grindProfile('50-50'),
  }), false);
});

test('ramp boost adds real airtime on a small rising ramp', () => {
  const boost = arcadeRampAirBoost({ speed: 9.5, normalY: 0.86, verticalSpeed: 2.1 });
  assert.ok(boost >= 2.0, `expected useful small-ramp boost, got ${boost}`);
});

test('steep fast ramp gets more airtime than a shallow slower ramp', () => {
  const shallow = arcadeRampAirBoost({ speed: 7, normalY: 0.91, verticalSpeed: 1.2 });
  const steep = arcadeRampAirBoost({ speed: 12.5, normalY: 0.42, verticalSpeed: 5.5 });
  assert.ok(steep > shallow, `steep ${steep} should exceed shallow ${shallow}`);
  assert.ok(steep <= ARCADE_PARK_MOBILITY.rampBoostMax + 1e-9);
});

test('flat ground and descending ramps do not receive ramp launch boost', () => {
  assert.equal(arcadeRampAirBoost({ speed: 12, normalY: 1, verticalSpeed: 0 }), 0);
  assert.equal(arcadeRampAirBoost({ speed: 12, normalY: 0.6, verticalSpeed: -1 }), 0);
});

test('park-speed steering gain produces a much tighter carve', () => {
  const low = arcadeTurnGain(2);
  const park = arcadeTurnGain(12.5);
  assert.ok(low >= 1.5);
  assert.ok(park >= 1.7, `park-speed gain too weak: ${park}`);
  assert.ok(park > low);
});
