import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  TRANSITION_TYPE,
  compileTransitionMetadata,
  transitionMetadataCoverage,
} from '../src/game/transitions/TransitionMetadata.js';
import {
  TransitionController,
  authoredTransitionIdentity,
} from '../src/game/transitions/TransitionController.js';

const manifest = JSON.parse(fs.readFileSync(
  new URL('../public/assets/park/park-manifest.json', import.meta.url),
  'utf8',
));

test('current production park has explicit metadata for every authored coping transition', () => {
  const coverage = transitionMetadataCoverage(manifest.rails);
  assert.equal(coverage.complete, true, JSON.stringify(coverage));
  assert.equal(coverage.authoredCount, 5);
  assert.equal(coverage.presentAuthoredCount, 5);
  assert.deepEqual(coverage.missingAuthoredRails, []);
  assert.deepEqual(coverage.unclassifiedCopingRails, []);
});

test('production transition metadata classifies bowl vert minis and quarter explicitly', () => {
  const transitions = compileTransitionMetadata(manifest.rails);
  const byId = new Map(transitions.map(transition => [transition.id, transition]));

  assert.equal(transitions.length, 5);
  assert.equal(byId.get('bowl-main')?.type, TRANSITION_TYPE.BOWL);
  assert.equal(byId.get('western-vert')?.type, TRANSITION_TYPE.VERT);
  assert.equal(byId.get('rear-mini-north')?.type, TRANSITION_TYPE.MINI);
  assert.equal(byId.get('rear-mini-south')?.type, TRANSITION_TYPE.MINI);
  assert.equal(byId.get('eastern-quarter')?.type, TRANSITION_TYPE.QUARTER);
});

test('grind rails are not silently promoted into transitions', () => {
  const transitions = compileTransitionMetadata(manifest.rails);
  const sources = new Set(transitions.map(transition => transition.sourceRail));
  assert.equal(sources.has('05 / hip rail'), false);
  assert.equal(sources.has('07 / angled rail'), false);
  assert.equal(sources.has('08 / downrail'), false);
  assert.equal(sources.has('10 / spine handrail'), false);
  assert.equal(sources.has('11 / bank handrail'), false);
  assert.equal(sources.has('13 / flat bar'), false);
});

test('compiled metadata includes deterministic lip bounds center and axis semantics', () => {
  const transitions = compileTransitionMetadata(manifest.rails);
  const western = transitions.find(transition => transition.id === 'western-vert');
  const bowl = transitions.find(transition => transition.id === 'bowl-main');

  assert.ok(western.transitionAxis?.length() > 0.999);
  assert.equal(bowl.transitionAxis, null);
  assert.ok(western.bounds.min.x <= western.bounds.max.x);
  assert.ok(western.bounds.min.y <= western.bounds.max.y);
  assert.ok(western.bounds.min.z <= western.bounds.max.z);
  assert.ok(Number.isFinite(western.center.x));
  assert.ok(Number.isFinite(western.lipHeight));
});

test('shadow controller finds the nearest explicit transition lip without mutating physics', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  const western = controller.get('western-vert');
  assert.ok(western);

  const sample = western.lipPath[0].clone().add(new THREE.Vector3(0.18, 0.12, 0.08));
  const nearest = controller.nearestLip(sample, 1);
  assert.equal(nearest?.transition.id, 'western-vert');
  assert.ok(nearest.gap < 0.25);
  assert.ok(Number.isFinite(nearest.verticalDelta));
});

test('legacy coping candidate maps to canonical transition id by exact authored source name', () => {
  const controller = new TransitionController({ rails: manifest.rails });
  assert.deepEqual(controller.inspectLegacyCandidate({ name: '04 / eastern quarter coping' }), {
    sourceName: '04 / eastern quarter coping',
    transitionId: 'eastern-quarter',
    type: TRANSITION_TYPE.QUARTER,
    supportsVert: true,
    supportsTransfer: true,
    supportsPump: true,
    mapped: true,
  });
  assert.equal(controller.inspectLegacyCandidate({ name: '07 / angled rail' }).mapped, false);
});

test('semantic bridge classifies legacy transitionAir without requiring geometry mutation', () => {
  assert.deepEqual(authoredTransitionIdentity({ copingName: '02 / western vert wall coping' }), {
    sourceName: '02 / western vert wall coping',
    transitionId: 'western-vert',
    type: TRANSITION_TYPE.VERT,
    supportsVert: true,
    supportsTransfer: true,
    supportsPump: true,
    mapped: true,
  });
  assert.equal(authoredTransitionIdentity({ copingName: 'anything coping' }).mapped, false);
});
