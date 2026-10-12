import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRunFinalScore, RUN_SCORE_RULES } from '../src/game/RunFinalScore.js';

test('empty runs and runs with only bails finish at zero', () => {
  const empty = calculateRunFinalScore();
  assert.equal(empty.finalScore, 0);
  assert.equal(empty.subtotal, 0);
  assert.equal(empty.multiplierPercent, 100);
  assert.equal(empty.bailPenalty, 0);
  const onlyBails = calculateRunFinalScore({ bails: 3 });
  assert.equal(onlyBails.bailPenalty, 750);
  assert.equal(onlyBails.finalScore, 0);
});

test('landed combos and tricks add points before unique trick variety multiplies them', () => {
  const result = calculateRunFinalScore({ bankedScore: 1000, landedCombos: 2,
    tricksLanded: 6, uniqueTricks: ['Kickflip', 'Heelflip', 'Kickflip', 'Manual'], bails: 1 });
  assert.equal(result.bankedScore, 1000);
  assert.equal(result.comboBonus, 200);
  assert.equal(result.trickBonus, 150);
  assert.equal(result.subtotal, 1350);
  assert.equal(result.uniqueTrickCount, 3);
  assert.equal(result.varietyBonusPercent, 15);
  assert.equal(result.multiplierPercent, 115);
  assert.equal(result.multiplier, 1.15);
  assert.equal(result.weightedScore, 1553);
  assert.equal(result.bailPenalty, 250);
  assert.equal(result.finalScore, 1303);
  assert.equal(result.ruleVersion, RUN_SCORE_RULES.version);
});

test('each achievement improves an otherwise identical accepted run', () => {
  const baseline = { bankedScore: 1000, landedCombos: 1, tricksLanded: 1, uniqueTricks: 1 };
  const score = calculateRunFinalScore(baseline).finalScore;
  assert.ok(calculateRunFinalScore({ ...baseline, landedCombos: 2 }).finalScore > score);
  assert.ok(calculateRunFinalScore({ ...baseline, tricksLanded: 2 }).finalScore > score);
  assert.ok(calculateRunFinalScore({ ...baseline, uniqueTricks: 2 }).finalScore > score);
  assert.equal(calculateRunFinalScore({ ...baseline, bails: 1 }).finalScore, score - 250);
});

test('bail penalties are deducted after multiplying achievements and never make scores negative', () => {
  const run = { bankedScore: 1000, uniqueTricks: 20 };
  assert.equal(calculateRunFinalScore(run).finalScore, 2000);
  assert.equal(calculateRunFinalScore({ ...run, bails: 1 }).finalScore, 1750);
  assert.equal(calculateRunFinalScore({ ...run, bails: 8 }).finalScore, 0);
  assert.equal(calculateRunFinalScore({ ...run, bails: 9 }).finalScore, 0);
});

test('variety tops out at a 2.00 multiplier and rounds the weighted total once', () => {
  assert.equal(calculateRunFinalScore({ uniqueTricks: 19 }).multiplierPercent, 195);
  assert.equal(calculateRunFinalScore({ uniqueTricks: 20 }).multiplierPercent, 200);
  assert.equal(calculateRunFinalScore({ uniqueTricks: 100 }).multiplierPercent, 200);
  assert.equal(calculateRunFinalScore({ bankedScore: 10, uniqueTricks: 1 }).weightedScore, 11);
  assert.equal(calculateRunFinalScore({ bankedScore: 11, uniqueTricks: 1 }).weightedScore, 12);
});

test('malformed counts cannot invent bonuses or bail credits', () => {
  const result = calculateRunFinalScore({ bankedScore: NaN, landedCombos: -2,
    tricksLanded: Infinity, uniqueTricks: '20', bails: -1 });
  assert.equal(result.finalScore, 0);
  assert.equal(result.comboBonus, 0);
  assert.equal(result.trickBonus, 0);
  assert.equal(result.uniqueTrickCount, 0);
  assert.equal(result.bailPenalty, 0);
  const fractional = calculateRunFinalScore({ bankedScore: 10.6, landedCombos: 1.9,
    tricksLanded: 2.8, uniqueTricks: ['Kickflip', '', null, ' Kickflip '], bails: 1.9 });
  assert.equal(fractional.bankedScore, 11);
  assert.equal(fractional.landedCombos, 1);
  assert.equal(fractional.tricksLanded, 2);
  assert.equal(fractional.uniqueTrickCount, 1);
  assert.equal(fractional.bails, 1);
});

test('calculation leaves accepted run facts unchanged and has reproducible results', () => {
  const facts = Object.freeze({ bankedScore: 800, landedCombos: 2, tricksLanded: 4,
    uniqueTricks: Object.freeze(['Kickflip', 'Manual']), bails: 1 });
  const result = calculateRunFinalScore(facts);
  assert.deepEqual(calculateRunFinalScore(facts), result);
  assert.deepEqual(facts.uniqueTricks, ['Kickflip', 'Manual']);
  assert.ok(Object.isFrozen(RUN_SCORE_RULES));
});
