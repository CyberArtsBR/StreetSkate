import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { TransitionController } from '../src/game/transitions/TransitionController.js';

const manifest = JSON.parse(fs.readFileSync(
  new URL('../public/assets/park/park-manifest.json', import.meta.url),
  'utf8',
));
const DT = 1 / 120;
const GRAVITY = 20;

function finiteVector(v) {
  return v && v.toArray().every(Number.isFinite);
}

function sampleForTransition(transition) {
  const a = transition.lipPath[0], b = transition.lipPath[1];
  const tangent = b.clone().sub(a).setY(0).normalize();
  const rampInward = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const deckOutward = rampInward.clone().negate();
  const lip = a.clone().lerp(b, 0.5);
  const position = lip.clone().addScaledVector(rampInward, 0.18);
  position.y -= 0.10;
  const normal = rampInward.clone().multiplyScalar(0.57)
    .addScaledVector(new THREE.Vector3(0, 1, 0), 0.82).normalize();
  const velocity = deckOutward.clone().multiplyScalar(6.2)
    .addScaledVector(tangent, 0.65).add(new THREE.Vector3(0, 4.4, 0));
  return { position, normal, velocity };
}

function begin(controller, transition, boost = 3.2) {
  const sample = sampleForTransition(transition);
  const edge = controller.launchAt(sample.position, sample.normal, sample.velocity);
  assert.ok(edge);
  const position = sample.position.clone();
  const velocity = sample.velocity.clone();
  const boardForward = sample.velocity.clone().setY(0).normalize();
  const air = controller.begin(position, velocity, edge, { boardForward, launchBoost: boost });
  return { position, velocity, air };
}

function simulate(controller, transition, inputForFrame = () => ({}), frames = 120) {
  const sim = begin(controller, transition);
  for (let frame = 0; frame < frames; frame++) {
    sim.velocity.y -= GRAVITY * DT;
    controller.advance(sim.air, sim.position, sim.velocity, inputForFrame(frame, sim), DT);
    sim.position.addScaledVector(sim.velocity, DT);
    assert.ok(finiteVector(sim.position), `non-finite position at ${frame}`);
    assert.ok(finiteVector(sim.velocity), `non-finite velocity at ${frame}`);
    assert.ok(Number.isFinite(sim.air.returnError));
  }
  return sim;
}

test('canonical begin is deterministic and carries identity for every vert transition', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  for (const transition of controller.transitions.filter(t => t.supportsVert)) {
    const a = begin(controller, transition), b = begin(controller, transition);
    assert.ok(a.velocity.distanceTo(b.velocity) < 1e-12);
    assert.equal(a.air.transitionId, transition.id);
    assert.equal(a.air.transitionType, transition.type);
    assert.ok(a.air.launchVertical >= 2.5 && a.air.launchVertical <= 15.5);
    assert.ok(finiteVector(a.air.launchHorizontal));
  }
});

test('neutral vert return is deterministic and never silently becomes a transfer', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const transition = controller.get('eastern-quarter');
  const a = simulate(controller, transition, () => ({}), 110);
  const b = simulate(controller, transition, () => ({}), 110);
  assert.ok(a.position.distanceTo(b.position) < 1e-12);
  assert.ok(a.velocity.distanceTo(b.velocity) < 1e-12);
  assert.equal(a.air.transferring, false);
  assert.equal(a.air.mode, 'return');
  assert.equal(a.air.apexPassed, true);
});

test('explicit vert-exit command produces deterministic outward transfer', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const transition = controller.get('eastern-quarter');
  const sim = simulate(controller, transition,
    (frame) => frame >= 12 ? { vertExit: true } : {}, 60);
  assert.equal(sim.air.transferring, true);
  assert.equal(sim.air.mode, 'transfer');
  const outward = sim.velocity.clone().setY(0).dot(sim.air.frame.deckOutward);
  assert.ok(outward > 0.1, `transfer did not move outward: ${outward}`);
});

test('post-apex Up tap can request transfer without treating held forward as transfer', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const transition = controller.get('eastern-quarter');
  const held = simulate(controller, transition, () => ({ drive: 1 }), 100);
  assert.equal(held.air.transferring, false);

  let tapped = false;
  const tap = simulate(controller, transition, (_frame, sim) => {
    if (!tapped && sim.air.apexPassed) {
      tapped = true;
      return { directionTaps: ['up'] };
    }
    return {};
  }, 100);
  assert.equal(tap.air.transferring, true);
});

test('presentation normal remains finite throughout launch/apex/descent', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const sim = begin(controller, controller.get('eastern-quarter'));
  for (const vy of [sim.air.launchVertical, 6, 2, 0, -2, -6]) {
    const normal = controller.presentationNormal(sim.air, vy);
    assert.ok(finiteVector(normal));
    assert.ok(Math.abs(normal.length() - 1) < 1e-9);
  }
});
