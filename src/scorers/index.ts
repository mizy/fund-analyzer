/** @entry scorers barrel export */
export {
  classifyFund,
  classifyRiskTier,
  scoreFund,
  getScoreLevel,
} from './fundScorer.js';
export { scoreFundDeep } from './fundScorerDeep.js';
export { scoreValuation, scoreTechnical, calcIndexTimingRating } from './fundScorerIndex.js';
