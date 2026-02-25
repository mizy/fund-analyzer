/** @entry deepScorer - 深度评分模型（含量化指标+持仓分析） */
import type { FundData, FundScoreDetail, DeepFundScore, QuantMetrics, FundHoldings, PeriodRiskMetrics } from '../types/fund.js';
import { classifyFund } from './fundScorer.js';

// ====== 深度评分模型 ======
// 收益能力(30) + 风险控制(30) + 持仓质量(15) + 稳定性(10) + 综合因素(15) = 100

// --- 通用评分函数 ---

type Benchmark = { full: number; high: number; mid: number; low: number };

function safeNum(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function scoreHigherBetter(value: number, b: Benchmark, maxScore: number): number {
  const v = safeNum(value);
  if (v >= b.full) return maxScore;
  if (v >= b.high) return maxScore * 0.8;
  if (v >= b.mid) return maxScore * 0.6;
  if (v >= b.low) return maxScore * 0.33;
  return Math.max(0, maxScore * 0.2 * (v / (b.low || 1)));
}

function scoreLowerBetter(value: number, b: Benchmark, maxScore: number): number {
  const v = safeNum(value);
  if (v <= b.full) return maxScore;
  if (v <= b.high) return maxScore * 0.8;
  if (v <= b.mid) return maxScore * 0.53;
  if (v <= b.low) return maxScore * 0.33;
  return Math.max(maxScore * 0.13, maxScore * 0.33 * (b.low / (v || 1)));
}

// --- 各类型基准值 ---

const RETURN_YEAR1_BENCHMARKS = {
  bond:     { full: 8,  high: 5,  mid: 3,  low: 0 },
  balanced: { full: 20, high: 12, mid: 6,  low: 0 },
  equity:   { full: 30, high: 20, mid: 10, low: 0 },
} as const;

const RETURN_YEAR3_BENCHMARKS = {
  bond:     { full: 20, high: 12, mid: 6,  low: 0 },
  balanced: { full: 50, high: 30, mid: 15, low: 0 },
  equity:   { full: 80, high: 50, mid: 30, low: 0 },
} as const;

const SHARPE_BENCHMARKS = {
  bond:     { full: 1.5, high: 1.0, mid: 0.7, low: 0.3 },
  balanced: { full: 2.0, high: 1.5, mid: 1.0, low: 0.5 },
  equity:   { full: 2.0, high: 1.5, mid: 1.0, low: 0.5 },
} as const;

const DRAWDOWN_BENCHMARKS = {
  bond:     { full: 3,  high: 5,  mid: 10, low: 15 },
  balanced: { full: 10, high: 20, mid: 30, low: 40 },
  equity:   { full: 15, high: 25, mid: 35, low: 45 },
} as const;

const VOLATILITY_BENCHMARKS = {
  bond:     { full: 3,  high: 5,  mid: 8,  low: 12 },
  balanced: { full: 10, high: 15, mid: 20, low: 25 },
  equity:   { full: 15, high: 20, mid: 25, low: 30 },
} as const;

// --- Alpha 基准 ---
const ALPHA_BENCHMARKS = {
  bond:     { full: 0.05, high: 0.03, mid: 0.01, low: -0.02 },
  balanced: { full: 0.10, high: 0.05, mid: 0.02, low: -0.03 },
  equity:   { full: 0.15, high: 0.08, mid: 0.03, low: -0.05 },
} as const;

// --- Beta 基准（越接近 0.8 越好，<1 优先） ---
function scoreBeta(beta: number, maxScore: number): number {
  const b = safeNum(beta, 1);
  if (b >= 0.6 && b <= 0.9) return maxScore;
  if (b >= 0.4 && b < 0.6) return maxScore * 0.8;
  if (b > 0.9 && b <= 1.0) return maxScore * 0.8;
  if (b > 1.0 && b <= 1.2) return maxScore * 0.5;
  if (b > 1.2) return maxScore * 0.3;
  return maxScore * 0.6; // beta < 0.4
}

// --- VaR 基准（日 VaR，越低越好） ---
const VAR_BENCHMARKS = {
  bond:     { full: 0.003, high: 0.005, mid: 0.008, low: 0.012 },
  balanced: { full: 0.010, high: 0.015, mid: 0.020, low: 0.030 },
  equity:   { full: 0.015, high: 0.020, mid: 0.030, low: 0.040 },
} as const;

// --- 月度胜率基准 ---
const WIN_RATE_BENCHMARKS = {
  bond:     { full: 0.75, high: 0.65, mid: 0.55, low: 0.45 },
  balanced: { full: 0.65, high: 0.58, mid: 0.50, low: 0.42 },
  equity:   { full: 0.60, high: 0.55, mid: 0.48, low: 0.40 },
} as const;

// --- IR 基准 ---
const IR_BENCHMARKS = {
  bond:     { full: 1.5, high: 1.0, mid: 0.5, low: 0.0 },
  balanced: { full: 1.0, high: 0.7, mid: 0.3, low: 0.0 },
  equity:   { full: 1.0, high: 0.7, mid: 0.3, low: 0.0 },
} as const;

// --- 持仓评分辅助 ---

function scoreTopHoldings(ratio: number, maxScore: number): number {
  if (ratio >= 20 && ratio <= 50) return maxScore;
  if (ratio > 50 && ratio <= 65) return maxScore * 0.7;
  if (ratio > 65) return maxScore * 0.4;
  if (ratio >= 10 && ratio < 20) return maxScore * 0.8;
  return maxScore * 0.5;
}

function scoreHHI(hhi: number, maxScore: number): number {
  if (hhi < 0) return maxScore * 0.5;
  if (hhi >= 0.05 && hhi <= 0.15) return maxScore;
  if (hhi > 0.15 && hhi <= 0.25) return maxScore * 0.7;
  if (hhi > 0.25) return maxScore * 0.4;
  if (hhi < 0.05) return maxScore * 0.8;
  return maxScore * 0.5;
}

function scoreRollingConsistency(positiveRatio: number, maxScore: number): number {
  if (positiveRatio >= 0.85) return maxScore;
  if (positiveRatio >= 0.75) return maxScore * 0.8;
  if (positiveRatio >= 0.60) return maxScore * 0.6;
  if (positiveRatio >= 0.45) return maxScore * 0.4;
  return maxScore * 0.2;
}

function scoreMorningstar(rating: number, maxScore: number): number {
  return Math.min(maxScore, Math.max(0, rating * (maxScore / 5)));
}

function scoreFundSize(size: number, maxScore: number = 5): number {
  if (size >= 2 && size <= 100) return maxScore;
  if (size > 100 && size <= 300) return maxScore * 0.8;
  if (size >= 1 && size < 2) return maxScore * 0.6;
  if (size > 300) return maxScore * 0.4;
  return maxScore * 0.2;
}

function scoreManagerYears(years: number, maxScore: number = 5): number {
  if (years >= 7) return maxScore;
  if (years >= 5) return maxScore * 0.8;
  if (years >= 3) return maxScore * 0.6;
  if (years >= 1) return maxScore * 0.4;
  return maxScore * 0.2;
}

function weightedPeriodScore(
  periods: { metrics: PeriodRiskMetrics | null; weight: number }[],
  scoreFn: (m: PeriodRiskMetrics) => number,
): number {
  let totalWeight = 0;
  let totalScore = 0;
  for (const { metrics, weight } of periods) {
    if (!metrics) continue;
    totalWeight += weight;
    totalScore += scoreFn(metrics) * weight;
  }
  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

/**
 * 深度评分：纳入量化指标和持仓分析
 * 当量化数据不可用时，对应指标给中间分(50%)
 */
export function scoreFundDeep(
  data: FundData,
  quant?: QuantMetrics,
  holdings?: FundHoldings
): DeepFundScore {
  const { performance: p, meta: m, basic } = data;
  const cat = classifyFund(basic.type);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const details: FundScoreDetail[] = [];

  // ===== 收益能力 (30分) =====
  const retYear1 = scoreHigherBetter(p.returnYear1, RETURN_YEAR1_BENCHMARKS[cat], 8);
  details.push({ item: '近1年收益', score: retYear1, maxScore: 8 });
  const retYear3 = scoreHigherBetter(p.returnYear3, RETURN_YEAR3_BENCHMARKS[cat], 7);
  details.push({ item: '近3年收益', score: retYear3, maxScore: 7 });

  const alphaScore = quant
    ? scoreHigherBetter(quant.alpha, ALPHA_BENCHMARKS[cat], 10)
    : 5;
  details.push({ item: 'Alpha超额收益', score: alphaScore, maxScore: 10 });

  const winRateScore = quant
    ? scoreHigherBetter(quant.monthlyWinRate, WIN_RATE_BENCHMARKS[cat], 5)
    : 2.5;
  details.push({ item: '月度胜率', score: winRateScore, maxScore: 5 });

  const returnScore = round1(retYear1 + retYear3 + alphaScore + winRateScore);

  // ===== 风险控制 (30分) =====
  const deepPeriodWeights = [
    { metrics: p.riskByPeriod.year1, weight: 0.4 },
    { metrics: p.riskByPeriod.year3, weight: 0.3 },
    { metrics: p.riskByPeriod.all,   weight: 0.3 },
  ];

  const sharpeScore = weightedPeriodScore(deepPeriodWeights,
    m => scoreHigherBetter(m.sharpeRatio, SHARPE_BENCHMARKS[cat], 10));
  details.push({ item: '夏普比率', score: sharpeScore, maxScore: 10 });

  const drawdownScore = weightedPeriodScore(deepPeriodWeights,
    m => scoreLowerBetter(m.maxDrawdown, DRAWDOWN_BENCHMARKS[cat], 8));
  details.push({ item: '最大回撤', score: drawdownScore, maxScore: 8 });

  const betaScore = quant ? scoreBeta(quant.beta, 5) : 2.5;
  details.push({ item: 'Beta系数', score: betaScore, maxScore: 5 });

  const varScore = quant
    ? scoreLowerBetter(quant.var95, VAR_BENCHMARKS[cat], 4)
    : 2;
  details.push({ item: 'VaR(95%)', score: varScore, maxScore: 4 });

  const volScore = weightedPeriodScore(deepPeriodWeights,
    m => scoreLowerBetter(m.volatility, VOLATILITY_BENCHMARKS[cat], 3));
  details.push({ item: '波动率', score: volScore, maxScore: 3 });

  const riskScore = round1(sharpeScore + drawdownScore + betaScore + varScore + volScore);

  // ===== 持仓质量 (15分) =====
  const hhiScore = holdings
    ? (quant ? scoreHHI(quant.hhi, 8) : 4)
    : 4;
  details.push({ item: '行业集中度HHI', score: hhiScore, maxScore: 8 });

  const topHoldScore = holdings
    ? (quant ? scoreTopHoldings(quant.topHoldingsRatio, 7) : 3.5)
    : 3.5;
  details.push({ item: '重仓占比', score: topHoldScore, maxScore: 7 });

  const holdingScore = round1(hhiScore + topHoldScore);

  // ===== 稳定性 (10分) =====
  const irScore = quant
    ? scoreHigherBetter(quant.informationRatio, IR_BENCHMARKS[cat], 5)
    : 2.5;
  details.push({ item: '信息比率IR', score: irScore, maxScore: 5 });

  const consistencyScore = quant
    ? scoreRollingConsistency(quant.cagr > 0 ? 0.7 : 0.4, 5)
    : 2.5;
  details.push({ item: '收益一致性', score: consistencyScore, maxScore: 5 });

  const stabilityScore = round1(irScore + consistencyScore);

  // ===== 综合因素 (15分) =====
  const sizeScore = scoreFundSize(m.fundSize);
  details.push({ item: '基金规模', score: sizeScore, maxScore: 5 });

  const mgrScore = scoreManagerYears(m.managerYears);
  details.push({ item: '经理年限', score: mgrScore, maxScore: 5 });

  const msScore = m.morningstarRating > 0 ? scoreMorningstar(m.morningstarRating, 5) : 2.5;
  details.push({ item: '晨星评级', score: msScore, maxScore: 5 });

  const overallScore = round1(sizeScore + mgrScore + msScore);

  for (const d of details) {
    d.score = round1(d.score);
  }

  const totalScore = round1(returnScore + riskScore + holdingScore + stabilityScore + overallScore);

  return {
    returnScore,
    riskScore,
    holdingScore,
    stabilityScore,
    overallScore,
    totalScore,
    details,
  };
}
