import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { TransitionController } from '../src/game/transitions/TransitionController.js';

const manifest = JSON.parse(fs.readFileSync(
  new URL('../public/assets/park/park-manifest.json', import.meta.url),
  'utf8',
));

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
    .addScaledVector(new THREE.Vector3(0, 1, 0), 0.82).normalize();
  const velocity = deckOutward.clone().multiplyScalar(6.2)
    .add(new THREE.Vector3(0, 4.4, 0));
  return { position, normal, velocity };
}

test('canonical detection finds every authored vert transition with canonical identity', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const vertTransitions = controller.transitions.filter(t => t.supportsVert);
  assert.equal(vertTransitions.length, 5);

  for (const transition of vertTransitions) {
    const sample = sampleForTransition(transition);
    const approach = controller.approachAt(sample.position, sample.normal, sample.velocity);
    const launch = controller.launchAt(sample.position, sample.normal, sample.velocity);
    assert.ok(approach, `${transition.id} approach was not detected`);
    assert.ok(launch, `${transition.id} launch was not detected`);
    assert.equal(launch.transitionId, transition.id);
    assert.equal(launch.transitionType, transition.type);
    assert.equal(launch.supportsVert, true);
  }
});

test('canonical detection rejects flat, descending and wrong-way candidates', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const transition = controller.get('eastern-quarter');
  const sample = sampleForTransition(transition);

  assert.equal(controller.launchAt(
    sample.position, new THREE.Vector3(0, 1, 0), sample.velocity,
  ), null);

  const descending = sample.velocity.clone(); descending.y = -1;
  assert.equal(controller.launchAt(sample.position, sample.normal, descending), null);

  const wrongWay = sample.velocity.clone().setY(0).negate(); wrongWay.y = 4;
  assert.equal(controller.launchAt(sample.position, sample.normal, wrongWay), null);
});

test('non-vert semantic anchors never become vert launch candidates', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  for (const id of ['central-hip', 'south-spine', 'east-bank']) {
    const transition = controller.get(id);
    assert.ok(transition);
    assert.equal(transition.supportsVert, false);
    assert.equal(controller.edges.some(edge => edge.transitionId === id), false);
  }
});
