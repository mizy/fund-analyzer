import { describe, it, expect } from 'vitest';
import { estimateRatingFromRank } from '../fetchFundDetail.js';

describe('estimateRatingFromRank', () => {
  it('returns 0 for percentile <= 0', () => {
    expect(estimateRatingFromRank(0)).toBe(0);
    expect(estimateRatingFromRank(-5)).toBe(0);
  });

  it('returns 5 for top 10%', () => {
    expect(estimateRatingFromRank(1)).toBe(5);
    expect(estimateRatingFromRank(5)).toBe(5);
    expect(estimateRatingFromRank(10)).toBe(5);
  });

  it('returns 4 for top 10-32.5%', () => {
    expect(estimateRatingFromRank(10.1)).toBe(4);
    expect(estimateRatingFromRank(20)).toBe(4);
    expect(estimateRatingFromRank(32.5)).toBe(4);
  });

  it('returns 3 for mid range 32.5-67.5%', () => {
    expect(estimateRatingFromRank(33)).toBe(3);
    expect(estimateRatingFromRank(50)).toBe(3);
    expect(estimateRatingFromRank(67.5)).toBe(3);
  });

  it('returns 2 for 67.5-90%', () => {
    expect(estimateRatingFromRank(68)).toBe(2);
    expect(estimateRatingFromRank(80)).toBe(2);
    expect(estimateRatingFromRank(90)).toBe(2);
  });

  it('returns 1 for bottom 10% (> 90%)', () => {
    expect(estimateRatingFromRank(91)).toBe(1);
    expect(estimateRatingFromRank(100)).toBe(1);
  });
});
