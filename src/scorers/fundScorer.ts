import type { FundData, FundScore } from '../types/fund.js';

function scoreReturnYear1(rate: number): number {
  if (rate >= 30) return 15;
  if (rate >= 20) return 12;
  if (rate >= 10) return 9;
  if (rate >= 0) return 5;
  return Math.max(0, 3 + rate / 10); // -30% -> 0
}

function scoreReturnYear3(rate: number): number {
  if (rate >= 80) return 15;
  if (rate >= 50) return 12;
  if (rate >= 30) return 9;
  if (rate >= 0) return 5;
  return Math.max(0, 3 + rate / 20); // -60% -> 0
}

function scoreSharpe(ratio: number): number {
  if (ratio >= 2.0) return 10;
  if (ratio >= 1.5) return 8;
  if (ratio >= 1.0) return 6;
  if (ratio >= 0.5) return 4;
  return Math.max(0, ratio / 0.5 * 3); // 0 -> 0, 0.5 -> 3
}

function scoreMaxDrawdown(dd: number): number {
  if (dd <= 10) return 15;
  if (dd <= 20) return 12;
  if (dd <= 30) return 8;
  if (dd <= 40) return 5;
  return 2;
}

function scoreSortino(ratio: number): number {
  if (ratio >= 2.5) return 10;
  if (ratio >= 2.0) return 8;
  if (ratio >= 1.5) return 6;
  if (ratio >= 1.0) return 4;
  return Math.max(0, ratio / 1.0 * 3); // 0 -> 0, 1.0 -> 3
}

function scoreVolatility(vol: number): number {
  if (vol <= 10) return 5;
  if (vol <= 15) return 4;
  if (vol <= 20) return 3;
  if (vol <= 25) return 2;
  return 1;
}

function scoreMorningstar(rating: number): number {
  return Math.min(15, Math.max(0, rating * 3));
}

function scoreFundSize(size: number): number {
  if (size >= 2 && size <= 100) return 5;
  if (size > 100 && size <= 300) return 4;
  if (size >= 1 && size < 2) return 3;
  if (size > 300) return 2;
  return 1; // < 1亿
}

function scoreManagerYears(years: number): number {
  if (years >= 7) return 5;
  if (years >= 5) return 4;
  if (years >= 3) return 3;
  if (years >= 1) return 2;
  return 1;
}

function scoreFeeRate(rate: number): number {
  if (rate <= 0.8) return 5;
  if (rate <= 1.2) return 4;
  if (rate <= 1.5) return 3;
  if (rate <= 2.0) return 2;
  return 1;
}

export function scoreFund(data: FundData): FundScore {
  const { performance: p, meta: m } = data;

  const details: FundScore['details'] = [
    { item: '近1年收益', score: scoreReturnYear1(p.returnYear1), maxScore: 15 },
    { item: '近3年收益', score: scoreReturnYear3(p.returnYear3), maxScore: 15 },
    { item: '夏普比率', score: scoreSharpe(p.sharpeRatio), maxScore: 10 },
    { item: '最大回撤', score: scoreMaxDrawdown(p.maxDrawdown), maxScore: 15 },
    { item: '索提诺比率', score: scoreSortino(p.sortinoRatio), maxScore: 10 },
    { item: '波动率', score: scoreVolatility(p.volatility), maxScore: 5 },
    { item: '晨星评级', score: scoreMorningstar(m.morningstarRating), maxScore: 15 },
    { item: '基金规模', score: scoreFundSize(m.fundSize), maxScore: 5 },
    { item: '经理年限', score: scoreManagerYears(m.managerYears), maxScore: 5 },
    { item: '费率', score: scoreFeeRate(m.totalFeeRate), maxScore: 5 },
  ];

  // 四舍五入所有分数
  for (const d of details) {
    d.score = Math.round(d.score * 10) / 10;
  }

  const returnScore = details[0].score + details[1].score + details[2].score;
  const riskScore = details[3].score + details[4].score + details[5].score;
  const overallScore = details[6].score + details[7].score + details[8].score + details[9].score;

  return {
    returnScore,
    riskScore,
    overallScore,
    totalScore: returnScore + riskScore + overallScore,
    details,
  };
}

export function getScoreLevel(totalScore: number): string {
  if (totalScore >= 85) return '优秀 ★★★★★';
  if (totalScore >= 70) return '良好 ★★★★';
  if (totalScore >= 55) return '中等 ★★★';
  if (totalScore >= 40) return '较差 ★★';
  return '差 ★';
}
