/** @entry indexScorer - 指数基金时机评分模型（估值50 + 技术面50 = 100） */
import type {
  IndexValuation,
  TechnicalSignal,
  TimingRating,
  TimingDimensionDetail,
  IndexTimingResult,
} from '../types/indexFund.js';

// --- 估值评分 (0-50) ---

export function scoreValuation(v: IndexValuation): {
  score: number;
  details: TimingDimensionDetail[];
} {
  // PE 分位数评分 (0-30)：分位数越低 → 越低估 → 分越高
  const peScore = scorePercentile(v.pePercentile, 30);
  const peReason = `PE分位 ${v.pePercentile.toFixed(1)}%` +
    (v.pePercentile < 20 ? '，极度低估' : v.pePercentile < 40 ? '，偏低估' :
     v.pePercentile > 80 ? '，极度高估' : v.pePercentile > 60 ? '，偏高估' : '，中性');

  // PB 分位数评分 (0-20)
  const pbScore = scorePercentile(v.pbPercentile, 20);
  const pbReason = `PB分位 ${v.pbPercentile.toFixed(1)}%` +
    (v.pbPercentile < 20 ? '，极度低估' : v.pbPercentile < 40 ? '，偏低估' :
     v.pbPercentile > 80 ? '，极度高估' : v.pbPercentile > 60 ? '，偏高估' : '，中性');

  const score = round1(peScore + pbScore);
  return {
    score: Math.min(50, score),
    details: [
      { name: 'PE分位数', score: round1(peScore), maxScore: 30, reason: peReason },
      { name: 'PB分位数', score: round1(pbScore), maxScore: 20, reason: pbReason },
    ],
  };
}

/** 分位数 → 得分：分位数越低分越高 */
function scorePercentile(percentile: number, maxScore: number): number {
  const p = clamp(percentile, 0, 100);
  if (p < 10) return maxScore;               // 极度低估
  if (p < 20) return maxScore * 0.9;          // 低估
  if (p < 30) return maxScore * 0.75;
  if (p < 40) return maxScore * 0.6;
  if (p < 50) return maxScore * 0.5;          // 中性
  if (p < 60) return maxScore * 0.4;
  if (p < 70) return maxScore * 0.3;
  if (p < 80) return maxScore * 0.2;
  if (p < 90) return maxScore * 0.1;          // 高估
  return 0;                                    // 极度高估
}

// --- 技术面评分 (0-50) ---

export function scoreTechnical(signal: TechnicalSignal): {
  score: number;
  details: TimingDimensionDetail[];
} {
  const details: TimingDimensionDetail[] = [];

  // 1. 趋势评分 (0-30)：方向 + 均线排列
  let trendScore = 0;
  let trendReason: string;
  if (signal.direction === 'bullish') {
    trendScore = 30;
    trendReason = '多头趋势';
  } else if (signal.direction === 'neutral') {
    trendScore = 15;
    trendReason = '趋势中性';
  } else {
    trendScore = 5;
    trendReason = '空头趋势';
  }
  details.push({ name: '趋势方向', score: trendScore, maxScore: 30, reason: trendReason });

  // 2. RSI 评分 (0-20)：超卖加分，超买减分
  const rsi = clamp(signal.rsi, 0, 100);
  let rsiScore: number;
  let rsiReason: string;
  if (rsi < 20) {
    rsiScore = 20;
    rsiReason = `RSI=${rsi.toFixed(1)}，极度超卖，买入信号强`;
  } else if (rsi < 30) {
    rsiScore = 17;
    rsiReason = `RSI=${rsi.toFixed(1)}，超卖区间`;
  } else if (rsi < 45) {
    rsiScore = 13;
    rsiReason = `RSI=${rsi.toFixed(1)}，偏弱`;
  } else if (rsi <= 55) {
    rsiScore = 10;
    rsiReason = `RSI=${rsi.toFixed(1)}，中性`;
  } else if (rsi <= 70) {
    rsiScore = 7;
    rsiReason = `RSI=${rsi.toFixed(1)}，偏强`;
  } else if (rsi <= 80) {
    rsiScore = 3;
    rsiReason = `RSI=${rsi.toFixed(1)}，超买区间`;
  } else {
    rsiScore = 0;
    rsiReason = `RSI=${rsi.toFixed(1)}，极度超买，卖出信号强`;
  }
  details.push({ name: 'RSI指标', score: rsiScore, maxScore: 20, reason: rsiReason });

  const score = round1(trendScore + rsiScore);
  return { score: Math.min(50, score), details };
}

// --- 综合评级 ---

export function calcIndexTimingRating(params: {
  indexCode: string;
  indexName: string;
  valuation: IndexValuation;
  technical: TechnicalSignal;
}): IndexTimingResult {
  const { indexCode, indexName, valuation, technical } = params;

  const valResult = scoreValuation(valuation);
  const techResult = scoreTechnical(technical);

  const totalScore = round1(valResult.score + techResult.score);
  const rating: TimingRating =
    totalScore >= 70 ? 'buy' :
    totalScore >= 40 ? 'hold' :
    'sell';

  return {
    indexCode,
    indexName,
    valuationScore: valResult.score,
    technicalScore: techResult.score,
    totalScore,
    rating,
    valuation,
    technical,
    details: [...valResult.details, ...techResult.details],
  };
}

// --- utils ---

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
