import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SAFE_COPING_EXIT,
  deckCanFitBoard,
  supportMatchesOriginalTransition,
} from '../src/game/SafeCopingExitSkillStreetPhysics.js';
import { PRODUCTION_BOARD_CONTACT_RIG } from '../src/game/SkateboardContactRig.js';

function airFrame() {
  return {
    frame: {
      lipPoint: new THREE.Vector3(0, 3, 0),
      deckOutward: new THREE.Vector3(0, 0, -1),
      rampInward: new THREE.Vector3(0, 0, 1),
      copingTangent: new THREE.Vector3(1, 0, 0),
    },
    transferring: true,
    exitControl: {
      geometryAware: true,
      abortToReturn: false,
    },
  };
}

test('latest video: 0.82m top deck cannot fit the real 1.05m board straight out', () => {
  assert.equal(PRODUCTION_BOARD_CONTACT_RIG.deckLength, 1.05);
  assert.equal(deckCanFitBoard({ found: true, usableWidth: 0.82 }), false);
  assert.ok(SAFE_COPING_EXIT.minSafeDeckWidth > 1.05,
    `safety width should exceed board length: ${SAFE_COPING_EXIT.minSafeDeckWidth}`);
});

test('wide bowl deck still permits contextual Up exit', () => {
  assert.equal(deckCanFitBoard({ found: true, usableWidth: 1.65 }), true);
  assert.equal(deckCanFitBoard({ found: true, usableWidth: 2.4 }), true);
});

test('missed transfer can reconnect to the original quarter transition', () => {
  const air = airFrame();
  const support = {
    position: new THREE.Vector3(0, 2.35, 0.52),
    normal: new THREE.Vector3(0, 0.72, 0.694).normalize(),
  };
  assert.equal(supportMatchesOriginalTransition(support, air), true);
});

test('flat deck behind coping is not mistaken for ramp recovery', () => {
  const air = airFrame();
  const support = {
    position: new THREE.Vector3(0, 3.01, -0.72),
    normal: new THREE.Vector3(0, 1, 0),
  };
  assert.equal(supportMatchesOriginalTransition(support, air), false);
});

test('lower floor under the structure cannot masquerade as original transition', () => {
  const air = airFrame();
  const support = {
    position: new THREE.Vector3(0, -1.6, 0.4),
    normal: new THREE.Vector3(0, 1, 0),
  };
  assert.equal(supportMatchesOriginalTransition(support, air), false);
});

test('wrong-facing sloped geometry cannot steal transfer recovery', () => {
  const air = airFrame();
  const support = {
    position: new THREE.Vector3(0, 2.4, 0.48),
    normal: new THREE.Vector3(0, 0.72, -0.694).normalize(),
  };
  assert.equal(supportMatchesOriginalTransition(support, air), false);
});
