import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { TransitionGuide } from '../src/game/TransitionGuide.js';
import { TransitionController } from '../src/game/transitions/TransitionController.js';

const manifest = JSON.parse(fs.readFileSync(
  new URL('../public/assets/park/park-manifest.json', import.meta.url),
  'utf8',
));

const DT = 1 / 120;
const GRAVITY = 20;
const EPS = 1e-10;

function assertNumber(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < EPS, `${label}: ${actual} vs ${expected}`);
}

function assertVector(actual, expected, label) {
  assert.ok(actual && expected, `${label} missing vector`);
  assert.ok(actual.distanceTo(expected) < EPS,
    `${label}: ${actual.toArray()} vs ${expected.toArray()}`);
}

function assertAirTrajectory(actual, expected, label) {
  assert.equal(actual.mode, expected.mode, `${label}.mode`);
  assertNumber(actual.launchVertical, expected.launchVertical, `${label}.launchVertical`);
  assertVector(actual.launchHorizontal, expected.launchHorizontal, `${label}.launchHorizontal`);
  assertNumber(actual.lateralVelocity, expected.lateralVelocity, `${label}.lateralVelocity`);
  assert.equal(actual.apexPassed, expected.apexPassed, `${label}.apexPassed`);
  assert.equal(actual.exitRequested, expected.exitRequested, `${label}.exitRequested`);
  assert.equal(actual.transferring, expected.transferring, `${label}.transferring`);
  assertNumber(actual.age, expected.age, `${label}.age`);
  assert.equal(actual.copingName, expected.copingName, `${label}.copingName`);
  assertNumber(actual.returnError, expected.returnError, `${label}.returnError`);

  assertVector(actual.frame.lipPoint, expected.frame.lipPoint, `${label}.frame.lipPoint`);
  assertVector(actual.frame.copingTangent, expected.frame.copingTangent, `${label}.frame.copingTangent`);
  assertVector(actual.frame.rampInward, expected.frame.rampInward, `${label}.frame.rampInward`);
  assertVector(actual.frame.deckOutward, expected.frame.deckOutward, `${label}.frame.deckOutward`);
  assertVector(actual.frame.surfaceNormal, expected.frame.surfaceNormal, `${label}.frame.surfaceNormal`);
  assertVector(actual.frame.boardForward, expected.frame.boardForward, `${label}.frame.boardForward`);
  assertVector(actual.frame.incomingTangentVelocity, expected.frame.incomingTangentVelocity,
    `${label}.frame.incomingTangentVelocity`);
  assertVector(actual.frame.returnTarget, expected.frame.returnTarget, `${label}.frame.returnTarget`);
  assertNumber(actual.frame.incomingSpeed, expected.frame.incomingSpeed, `${label}.frame.incomingSpeed`);
  assertNumber(actual.frame.launchBoost, expected.frame.launchBoost, `${label}.frame.launchBoost`);
}

function sampleForTransition(transition) {
  const a = transition.lipPath[0];
  const b = transition.lipPath[1];
  const tangent = b.clone().sub(a).setY(0).normalize();
  const rampInward = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const deckOutward = rampInward.clone().negate();
  const lip = a.clone().lerp(b, 0.5);
  const position = lip.clone().addScaledVector(rampInward, 0.18);
  position.y -= 0.10;
  const normal = rampInward.clone().multiplyScalar(0.57)
    .addScaledVector(new THREE.Vector3(0, 1, 0), 0.82)
    .normalize();
  const velocity = deckOutward.clone().multiplyScalar(6.2)
    .addScaledVector(tangent, 0.65)
    .add(new THREE.Vector3(0, 4.4, 0));
  return { position, normal, velocity };
}

function beginPair(controller, legacy, transition, { launchBoost = 3.2 } = {}) {
  const sample = sampleForTransition(transition);
  const edge = controller.launchAt(sample.position, sample.normal, sample.velocity);
  assert.ok(edge, `${transition.id} missing canonical launch candidate`);

  const canonicalVelocity = sample.velocity.clone();
  const legacyVelocity = sample.velocity.clone();
  const boardForward = sample.velocity.clone().setY(0).normalize();
  const canonicalAir = controller.begin(sample.position, canonicalVelocity, edge, {
    boardForward,
    launchBoost,
  });
  const legacyAir = legacy.begin(sample.position, legacyVelocity, edge, {
    boardForward,
    launchBoost,
  });
  return {
    edge,
    canonicalAir,
    legacyAir,
    canonicalVelocity,
    legacyVelocity,
    canonicalPosition: sample.position.clone(),
    legacyPosition: sample.position.clone(),
  };
}

test('begin trajectory matches legacy guide on every authored production transition', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const legacy = new TransitionGuide(controller.rails);

  for (const transition of controller.transitions) {
    const pair = beginPair(controller, legacy, transition);
    assertVector(pair.canonicalVelocity, pair.legacyVelocity, `${transition.id}.velocity`);
    assertAirTrajectory(pair.canonicalAir, pair.legacyAir, transition.id);
    assert.equal(pair.canonicalAir.transitionId, transition.id);
    assert.equal(pair.canonicalAir.transitionType, transition.type);
  }
});

test('return-air advance stays frame-identical to legacy through apex and descent', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const legacy = new TransitionGuide(controller.rails);
  const transition = controller.get('eastern-quarter');
  const pair = beginPair(controller, legacy, transition);

  for (let frame = 0; frame < 96; frame++) {
    pair.canonicalVelocity.y -= GRAVITY * DT;
    pair.legacyVelocity.y -= GRAVITY * DT;
    controller.advance(pair.canonicalAir, pair.canonicalPosition, pair.canonicalVelocity, {}, DT);
    legacy.advance(pair.legacyAir, pair.legacyPosition, pair.legacyVelocity, {}, DT);
    pair.canonicalPosition.addScaledVector(pair.canonicalVelocity, DT);
    pair.legacyPosition.addScaledVector(pair.legacyVelocity, DT);

    assertVector(pair.canonicalVelocity, pair.legacyVelocity, `return.${frame}.velocity`);
    assertVector(pair.canonicalPosition, pair.legacyPosition, `return.${frame}.position`);
    assertAirTrajectory(pair.canonicalAir, pair.legacyAir, `return.${frame}.air`);
  }

  assert.equal(pair.canonicalAir.apexPassed, true);
  assert.equal(pair.canonicalAir.transferring, false);
});

test('contextual Up transfer stays frame-identical to legacy', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const legacy = new TransitionGuide(controller.rails);
  const transition = controller.get('eastern-quarter');
  const pair = beginPair(controller, legacy, transition, { launchBoost: 2.4 });

  for (let frame = 0; frame < 48; frame++) {
    const input = frame >= 10 ? { drive: 1 } : {};
    pair.canonicalVelocity.y -= GRAVITY * DT;
    pair.legacyVelocity.y -= GRAVITY * DT;
    controller.advance(pair.canonicalAir, pair.canonicalPosition, pair.canonicalVelocity, input, DT);
    legacy.advance(pair.legacyAir, pair.legacyPosition, pair.legacyVelocity, input, DT);
    pair.canonicalPosition.addScaledVector(pair.canonicalVelocity, DT);
    pair.legacyPosition.addScaledVector(pair.legacyVelocity, DT);

    assertVector(pair.canonicalVelocity, pair.legacyVelocity, `transfer.${frame}.velocity`);
    assertVector(pair.canonicalPosition, pair.legacyPosition, `transfer.${frame}.position`);
    assertAirTrajectory(pair.canonicalAir, pair.legacyAir, `transfer.${frame}.air`);
  }

  assert.equal(pair.canonicalAir.transferring, true);
  assert.equal(pair.canonicalAir.mode, 'transfer');
});

test('presentation normal matches legacy trajectory presentation exactly', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const legacy = new TransitionGuide(controller.rails);
  const transition = controller.get('eastern-quarter');
  const pair = beginPair(controller, legacy, transition);

  for (const verticalSpeed of [pair.canonicalAir.launchVertical, 6, 2, 0, -2, -6]) {
    assertVector(
      controller.presentationNormal(pair.canonicalAir, verticalSpeed),
      legacy.presentationNormal(pair.legacyAir, verticalSpeed),
      `presentation.${verticalSpeed}`,
    );
  }
});
