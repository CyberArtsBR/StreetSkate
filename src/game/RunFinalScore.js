export const RUN_SCORE_RULES = Object.freeze({
  version: 'achievement-score-v1',
  pointsPerLandedCombo: 100,
  pointsPerLandedTrick: 25,
  percentPerUniqueTrick: 5,
  maxVarietyBonusPercent: 100,
  pointsPerBail: 250,
});

const positiveNumber = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const count = value => Math.floor(positiveNumber(value));

/** Converts accepted run achievements into a transparent, integer final score. */
export function calculateRunFinalScore({
  bankedScore = 0, landedCombos = 0, tricksLanded = 0, uniqueTricks = [], bails = 0,
} = {}) {
  bankedScore = Math.round(positiveNumber(bankedScore));
  landedCombos = count(landedCombos);
  tricksLanded = count(tricksLanded);
  bails = count(bails);
  const uniqueTrickCount = Array.isArray(uniqueTricks)
    ? new Set(uniqueTricks.filter(trick => typeof trick === 'string' && trick.trim())
      .map(trick => trick.trim())).size
    : count(uniqueTricks);
  const comboBonus = landedCombos * RUN_SCORE_RULES.pointsPerLandedCombo;
  const trickBonus = tricksLanded * RUN_SCORE_RULES.pointsPerLandedTrick;
  const subtotal = bankedScore + comboBonus + trickBonus;
  const varietyBonusPercent = Math.min(RUN_SCORE_RULES.maxVarietyBonusPercent,
    uniqueTrickCount * RUN_SCORE_RULES.percentPerUniqueTrick);
  const multiplierPercent = 100 + varietyBonusPercent;
  // Integer percentage arithmetic avoids exposing floating-point multiplier noise.
  const weightedScore = Math.round(subtotal * multiplierPercent / 100);
  const bailPenalty = bails * RUN_SCORE_RULES.pointsPerBail;
  const finalScore = Math.max(0, weightedScore - bailPenalty);
  return {
    ruleVersion: RUN_SCORE_RULES.version,
    bankedScore, landedCombos, tricksLanded, uniqueTrickCount, bails,
    comboBonus, trickBonus, subtotal, varietyBonusPercent, multiplierPercent,
    multiplier: multiplierPercent / 100, weightedScore, bailPenalty, finalScore,
  };
}
