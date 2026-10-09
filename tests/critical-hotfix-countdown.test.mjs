import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionWarning } from '../src/game/SessionCountdown.js';
test('session countdown thresholds are deterministic', () => {
  for (const t of [Infinity,90,15,10.001]) assert.equal(sessionWarning(t),'none');
  for (const t of [10,9.9,5.001]) assert.equal(sessionWarning(t),'warning');
  for (const t of [5,4.9,0]) assert.equal(sessionWarning(t),'critical');
  for (const t of [0,5,10]) assert.equal(sessionWarning(t,true),'none');
});
