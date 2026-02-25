/** @entry scorer - 基金评分模型 */
import { RiskTier } from '../types/fund.js';
import type { FundData, FundScore, FundScoreDetail, FundCategory, PeriodRiskMetrics, TierBenchmark } from '../types/fund.js';

// --- 基金类型识别 ---

export function classifyFund(type: string): FundCategory {
  if (/债券|纯债|短债|中短债|长债|偏债/.test(type)) return 'bond';
  if (/股票|偏股|指数/.test(type)) return 'equity';
  return 'balanced'; // 混合型-平衡/灵活配置/FOF/QDII/其他
}

// --- 风险层级分类 ---

/** @entry 根据基金类型和波动率分类风险层级，冲突时取较高风险 */
export function classifyRiskTier(fundType: string, volatility: number): RiskTier {
  // 1. 基于类型的初步分类
  let typeTier: RiskTier;
  if (/货币|超短债/.test(fundType)) {
    typeTier = RiskTier.VERY_LOW;
  } else if (/纯债|短债|中短债|长债/.test(fundType) || /债券.*一级/.test(fundType)) {
    typeTier = RiskTier.LOW;
  } else if (/偏债|债券|FOF/.test(fundType)) {
    typeTier = RiskTier.MEDIUM;
  } else if (/偏股混合|平衡|灵活配置/.test(fundType)) {
    typeTier = RiskTier.MEDIUM_HIGH;
  } else if (/股票|指数|偏股/.test(fundType)) {
    typeTier = RiskTier.HIGH;
  } else {
    typeTier = RiskTier.MEDIUM; // 默认中等
  }

  // 2. 基于波动率的分类
  let volTier: RiskTier;
  const vol = Number.isFinite(volatility) ? volatility : 0;
  if (vol < 0.5) {
    volTier = RiskTier.VERY_LOW;
  } else if (vol < 3) {
    volTier = RiskTier.LOW;
  } else if (vol < 10) {
    volTier = RiskTier.MEDIUM;
  } else if (vol < 20) {
    volTier = RiskTier.MEDIUM_HIGH;
  } else {
    volTier = RiskTier.HIGH;
  }

  // 3. 冲突时取较高风险层级
  const tierOrder = [RiskTier.VERY_LOW, RiskTier.LOW, RiskTier.MEDIUM, RiskTier.MEDIUM_HIGH, RiskTier.HIGH];
  const typeIdx = tierOrder.indexOf(typeTier);
  const volIdx = tierOrder.indexOf(volTier);
  return tierOrder[Math.max(typeIdx, volIdx)];
}

// --- 分层评分基准 ---

const TIER_BENCHMARKS: Record<RiskTier, TierBenchmark> = {
  [RiskTier.VERY_LOW]: { sharpeBenchmark: 1.0, returnBenchmark: 2.5, drawdownBenchmark: 0.1 },
  [RiskTier.LOW]:      { sharpeBenchmark: 2.0, returnBenchmark: 6,   drawdownBenchmark: 1 },
  [RiskTier.MEDIUM]:   { sharpeBenchmark: 1.5, returnBenchmark: 15,  drawdownBenchmark: 5 },
  [RiskTier.MEDIUM_HIGH]: { sharpeBenchmark: 1.2, returnBenchmark: 25, drawdownBenchmark: 15 },
  [RiskTier.HIGH]:     { sharpeBenchmark: 1.0, returnBenchmark: 35,  drawdownBenchmark: 20 },
};

// --- 各类型基准值配置 ---

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

const SORTINO_BENCHMARKS = {
  bond:     { full: 2.0, high: 1.5, mid: 1.0, low: 0.5 },
  balanced: { full: 2.5, high: 2.0, mid: 1.5, low: 1.0 },
  equity:   { full: 2.5, high: 2.0, mid: 1.5, low: 1.0 },
} as const;

const VOLATILITY_BENCHMARKS = {
  bond:     { full: 3,  high: 5,  mid: 8,  low: 12 },
  balanced: { full: 10, high: 15, mid: 20, low: 25 },
  equity:   { full: 15, high: 20, mid: 25, low: 30 },
} as const;

const CALMAR_BENCHMARKS = {
  bond:     { full: 2.0, high: 1.5, mid: 1.0, low: 0.5 },
  balanced: { full: 3.0, high: 2.0, mid: 1.0, low: 0.5 },
  equity:   { full: 3.0, high: 2.0, mid: 1.0, low: 0.5 },
} as const;

// --- 通用评分函数 ---

type Benchmark = { full: number; high: number; mid: number; low: number };

/** 安全数值：NaN/Infinity 返回给定 fallback（默认 0） */
function safeNum(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** 越高越好的指标（收益、夏普、索提诺） */
function scoreHigherBetter(value: number, b: Benchmark, maxScore: number): number {
  const v = safeNum(value);
  if (v >= b.full) return maxScore;
  if (v >= b.high) return maxScore * SCORE_TIER.HIGH;
  if (v >= b.mid) return maxScore * SCORE_TIER.MID_HIGHER;
  if (v >= b.low) return maxScore * SCORE_TIER.LOW;
  return Math.max(0, maxScore * SCORE_TIER.MIN * (v / (b.low || 1)));
}

/** 越低越好的指标（回撤、波动率） */
function scoreLowerBetter(value: number, b: Benchmark, maxScore: number): number {
  const v = safeNum(value);
  if (v <= b.full) return maxScore;
  if (v <= b.high) return maxScore * SCORE_TIER.HIGH;
  if (v <= b.mid) return maxScore * SCORE_TIER.MID_LOWER;
  if (v <= b.low) return maxScore * SCORE_TIER.LOW;
  return Math.max(maxScore * SCORE_TIER.FLOOR, maxScore * SCORE_TIER.LOW * (b.low / (v || 1)));
}

// --- 不受基金类型影响的评分 ---

function scoreMorningstar(rating: number, maxScore: number = 7): number {
  // 按满分比例：5星=满分, 4星=0.8x, 3星=0.6x, 2星=0.4x, 1星=0.2x, 0=0
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

function scoreFeeRate(rate: number, maxScore: number = 3): number {
  if (rate <= 0.8) return maxScore;
  if (rate <= 1.2) return maxScore * 0.83;
  if (rate <= 1.5) return maxScore * 0.67;
  if (rate <= 2.0) return maxScore * 0.33;
  return maxScore * 0.17;
}

// --- 评分权重常量 ---

// 基础评分权重：收益能力(35) + 风险控制(35) + 综合评价(30) = 100
const SCORE_WEIGHT = {
  // 收益能力 35分
  SHARPE: 12,
  SORTINO: 5,
  RETURN_YEAR1: 8,
  RETURN_YEAR3: 10,
  // 风险控制 35分
  CALMAR: 10,
  MAX_DRAWDOWN: 18,
  VOLATILITY: 7,
  // 综合评价 30分
  MORNINGSTAR: 8,
  FUND_SIZE: 8,
  MANAGER_YEARS: 8,
  FEE_RATE: 6,
} as const;

// 动量反转惩罚阈值
const MOMENTUM_PENALTY = { HIGH: { threshold: 50, penalty: 5 }, MID: { threshold: 30, penalty: 3 } } as const;

// 分时段权重
const PERIOD_WEIGHT = { YEAR1: 0.4, YEAR3: 0.3, ALL: 0.3 } as const;

// 评分等级比例
const SCORE_TIER = { FULL: 1, HIGH: 0.8, MID_HIGHER: 0.6, MID_LOWER: 0.53, LOW: 0.33, MIN: 0.2, FLOOR: 0.13 } as const;

// --- 主评分函数 ---

/** 分时段加权评分：对同一指标，按多个时段的得分加权合并 */
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

/** 同类评分：使用分层基准对基金进行同类评分 */
function scoreFundByTier(
  data: FundData,
  tier: RiskTier,
): { tierScore: number; tierDetails: FundScoreDetail[] } {
  const { performance: p, meta: m } = data;
  const rbp = p.riskByPeriod;
  const tb = TIER_BENCHMARKS[tier];
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const periodWeights = [
    { metrics: rbp.year1, weight: PERIOD_WEIGHT.YEAR1 },
    { metrics: rbp.year3, weight: PERIOD_WEIGHT.YEAR3 },
    { metrics: rbp.all,   weight: PERIOD_WEIGHT.ALL },
  ];

  // 分层基准转 Benchmark 格式
  const sharpeBm: Benchmark = {
    full: tb.sharpeBenchmark,
    high: tb.sharpeBenchmark * 0.7,
    mid: tb.sharpeBenchmark * 0.4,
    low: tb.sharpeBenchmark * 0.15,
  };
  const returnBm: Benchmark = {
    full: tb.returnBenchmark,
    high: tb.returnBenchmark * 0.7,
    mid: tb.returnBenchmark * 0.4,
    low: 0,
  };
  const drawdownBm: Benchmark = {
    full: tb.drawdownBenchmark,
    high: tb.drawdownBenchmark * 2,
    mid: tb.drawdownBenchmark * 4,
    low: tb.drawdownBenchmark * 6,
  };

  const W = SCORE_WEIGHT;

  // 收益能力 35分
  const sharpeVal = weightedPeriodScore(periodWeights,
    m => scoreHigherBetter(m.sharpeRatio, sharpeBm, W.SHARPE));
  const sortinoVal = weightedPeriodScore(periodWeights,
    m => scoreHigherBetter(m.sortinoRatio, sharpeBm, W.SORTINO));
  const y1Val = scoreHigherBetter(p.returnYear1, returnBm, W.RETURN_YEAR1);
  const y3Val = scoreHigherBetter(p.returnYear3,
    { full: returnBm.full * 3, high: returnBm.high * 3, mid: returnBm.mid * 3, low: 0 }, W.RETURN_YEAR3);

  // 风险控制 35分
  const calmarVal = weightedPeriodScore(periodWeights,
    m => scoreHigherBetter(m.calmarRatio, sharpeBm, W.CALMAR));
  const ddVal = weightedPeriodScore(periodWeights,
    m => scoreLowerBetter(m.maxDrawdown, drawdownBm, W.MAX_DRAWDOWN));
  const volVal = weightedPeriodScore(periodWeights,
    m => scoreLowerBetter(m.volatility, drawdownBm, W.VOLATILITY));

  // 综合评价 30分
  const hasMorningstar = m.morningstarRating > 0;
  const totalWithoutMs = 100 - W.MORNINGSTAR;
  const scale = hasMorningstar ? 1 : 100 / totalWithoutMs;

  const msVal = hasMorningstar ? scoreMorningstar(m.morningstarRating, W.MORNINGSTAR) : 0;
  const sizeVal = scoreFundSize(m.fundSize, W.FUND_SIZE * scale);
  const mgrVal = scoreManagerYears(m.managerYears, W.MANAGER_YEARS * scale);
  const feeVal = scoreFeeRate(m.totalFeeRate, W.FEE_RATE * scale);

  const scaledMax = (base: number) => Math.round(base * scale * 10) / 10;
  const tierDetails: FundScoreDetail[] = [
    { item: '夏普比率', score: sharpeVal, maxScore: W.SHARPE },
    { item: '索提诺比率', score: sortinoVal, maxScore: W.SORTINO },
    { item: '近1年收益', score: y1Val, maxScore: W.RETURN_YEAR1 },
    { item: '近3年收益', score: y3Val, maxScore: W.RETURN_YEAR3 },
    { item: '卡玛比率', score: calmarVal, maxScore: W.CALMAR },
    { item: '最大回撤', score: ddVal, maxScore: W.MAX_DRAWDOWN },
    { item: '波动率', score: volVal, maxScore: W.VOLATILITY },
    ...(hasMorningstar
      ? [{ item: '晨星评级', score: msVal, maxScore: W.MORNINGSTAR }]
      : []),
    { item: '基金规模', score: sizeVal, maxScore: scaledMax(W.FUND_SIZE) },
    { item: '经理年限', score: mgrVal, maxScore: scaledMax(W.MANAGER_YEARS) },
    { item: '费率', score: feeVal, maxScore: scaledMax(W.FEE_RATE) },
  ];

  for (const d of tierDetails) {
    d.score = round1(d.score);
  }

  const tierScore = round1(tierDetails.reduce((sum, d) => sum + d.score, 0));
  return { tierScore: Math.min(100, tierScore), tierDetails };
}

export function scoreFund(data: FundData): FundScore {
  const { performance: p, meta: m, basic } = data;
  const cat = classifyFund(basic.type);
  const rbp = p.riskByPeriod;

  const hasMorningstar = m.morningstarRating > 0;

  // 当晨星评级无数据时，将晨星分数按比例重新分配到其他评分项
  const totalWithoutMs = 100 - SCORE_WEIGHT.MORNINGSTAR; // 95
  const scale = hasMorningstar ? 1 : 100 / totalWithoutMs;

  const periodWeights = [
    { metrics: rbp.year1, weight: PERIOD_WEIGHT.YEAR1 },
    { metrics: rbp.year3, weight: PERIOD_WEIGHT.YEAR3 },
    { metrics: rbp.all,   weight: PERIOD_WEIGHT.ALL },
  ];

  const W = SCORE_WEIGHT;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  // 收益能力 35分
  const sharpeScoreVal = weightedPeriodScore(periodWeights,
    m => scoreHigherBetter(m.sharpeRatio, SHARPE_BENCHMARKS[cat], W.SHARPE * scale));
  const sortinoScoreVal = weightedPeriodScore(periodWeights,
    m => scoreHigherBetter(m.sortinoRatio, SORTINO_BENCHMARKS[cat], W.SORTINO * scale));
  const year1Score = scoreHigherBetter(p.returnYear1, RETURN_YEAR1_BENCHMARKS[cat], W.RETURN_YEAR1 * scale);
  const year3Score = scoreHigherBetter(p.returnYear3, RETURN_YEAR3_BENCHMARKS[cat], W.RETURN_YEAR3 * scale);

  // 风险控制 35分
  const calmarScoreVal = weightedPeriodScore(periodWeights,
    m => scoreHigherBetter(m.calmarRatio, CALMAR_BENCHMARKS[cat], W.CALMAR * scale));
  const drawdownScoreVal = weightedPeriodScore(periodWeights,
    m => scoreLowerBetter(m.maxDrawdown, DRAWDOWN_BENCHMARKS[cat], W.MAX_DRAWDOWN * scale));
  const volScoreVal = weightedPeriodScore(periodWeights,
    m => scoreLowerBetter(m.volatility, VOLATILITY_BENCHMARKS[cat], W.VOLATILITY * scale));

  // 综合评价 30分
  const morningstarScoreVal = hasMorningstar ? scoreMorningstar(m.morningstarRating, W.MORNINGSTAR) : 0;
  const sizeScoreVal = scoreFundSize(m.fundSize, W.FUND_SIZE * scale);
  const mgrScoreVal = scoreManagerYears(m.managerYears, W.MANAGER_YEARS * scale);
  const feeScoreVal = scoreFeeRate(m.totalFeeRate, W.FEE_RATE * scale);

  const scaledMax = (base: number) => Math.round(base * scale * 10) / 10;
  const details: FundScore['details'] = [
    { item: '夏普比率', score: sharpeScoreVal, maxScore: scaledMax(W.SHARPE) },
    { item: '索提诺比率', score: sortinoScoreVal, maxScore: scaledMax(W.SORTINO) },
    { item: '近1年收益', score: year1Score, maxScore: scaledMax(W.RETURN_YEAR1) },
    { item: '近3年收益', score: year3Score, maxScore: scaledMax(W.RETURN_YEAR3) },
    { item: '卡玛比率', score: calmarScoreVal, maxScore: scaledMax(W.CALMAR) },
    { item: '最大回撤', score: drawdownScoreVal, maxScore: scaledMax(W.MAX_DRAWDOWN) },
    { item: '波动率', score: volScoreVal, maxScore: scaledMax(W.VOLATILITY) },
    ...(hasMorningstar
      ? [{ item: '晨星评级', score: morningstarScoreVal, maxScore: W.MORNINGSTAR }]
      : []),
    { item: '基金规模', score: sizeScoreVal, maxScore: scaledMax(W.FUND_SIZE) },
    { item: '经理年限', score: mgrScoreVal, maxScore: scaledMax(W.MANAGER_YEARS) },
    { item: '费率', score: feeScoreVal, maxScore: scaledMax(W.FEE_RATE) },
  ];

  // 四舍五入所有分数
  for (const d of details) {
    d.score = round1(d.score);
  }

  // 收益能力 = 夏普 + 索提诺 + 近1年 + 近3年
  const returnScore = round1(
    round1(sharpeScoreVal) + round1(sortinoScoreVal) +
    round1(year1Score) + round1(year3Score)
  );
  // 风险控制 = 卡玛 + 最大回撤 + 波动率
  const riskScore = round1(round1(calmarScoreVal) + round1(drawdownScoreVal) + round1(volScoreVal));
  // 综合评价
  const overallScore = round1(
    round1(morningstarScoreVal) + round1(sizeScoreVal) + round1(mgrScoreVal) + round1(feeScoreVal)
  );

  let marketScore = round1(returnScore + riskScore + overallScore);

  // 动量反转惩罚：近1年涨幅过高时主动降分
  const y1Return = safeNum(p.returnYear1);
  let momentumPenalty = 0;
  if (y1Return > MOMENTUM_PENALTY.HIGH.threshold) {
    momentumPenalty = MOMENTUM_PENALTY.HIGH.penalty;
  } else if (y1Return > MOMENTUM_PENALTY.MID.threshold) {
    momentumPenalty = MOMENTUM_PENALTY.MID.penalty;
  }
  marketScore = round1(Math.max(0, marketScore - momentumPenalty));

  // 分层评分
  const vol = rbp.all.volatility;
  const riskTier = classifyRiskTier(basic.type, vol);
  const { tierScore, tierDetails } = scoreFundByTier(data, riskTier);

  return {
    returnScore,
    riskScore,
    overallScore,
    totalScore: marketScore,
    momentumPenalty,
    details,
    riskTier,
    tierScore,
    marketScore,
    tierDetails,
  };
}

export function getScoreLevel(totalScore: number): string {
  if (totalScore >= 85) return '优秀 ★★★★★';
  if (totalScore >= 70) return '良好 ★★★★';
  if (totalScore >= 55) return '中等 ★★★';
  if (totalScore >= 40) return '较差 ★★';
  return '差 ★';
}

