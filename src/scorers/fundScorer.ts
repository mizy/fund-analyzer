import type { FundData, FundScore, FundScoreDetail, FundCategory, DeepFundScore, QuantMetrics, FundHoldings, PeriodRiskMetrics } from '../types/fund.js';

// --- 基金类型识别 ---

export function classifyFund(type: string): FundCategory {
  if (/债券|纯债|短债|中短债|长债|偏债/.test(type)) return 'bond';
  if (/股票|偏股|指数/.test(type)) return 'equity';
  return 'balanced'; // 混合型-平衡/灵活配置/FOF/QDII/其他
}

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

// --- 通用评分函数 ---

type Benchmark = { full: number; high: number; mid: number; low: number };

/** 越高越好的指标（收益、夏普、索提诺） */
function scoreHigherBetter(value: number, b: Benchmark, maxScore: number): number {
  if (value >= b.full) return maxScore;
  if (value >= b.high) return maxScore * 0.8;
  if (value >= b.mid) return maxScore * 0.6;
  if (value >= b.low) return maxScore * 0.33;
  return Math.max(0, maxScore * 0.2 * (value / (b.low || 1)));
}

/** 越低越好的指标（回撤、波动率） */
function scoreLowerBetter(value: number, b: Benchmark, maxScore: number): number {
  if (value <= b.full) return maxScore;
  if (value <= b.high) return maxScore * 0.8;
  if (value <= b.mid) return maxScore * 0.53;
  if (value <= b.low) return maxScore * 0.33;
  return Math.max(maxScore * 0.13, maxScore * 0.33 * (b.low / (value || 1)));
}

// --- 不受基金类型影响的评分 ---

function scoreMorningstar(rating: number): number {
  // 5星=15, 4星=12, 3星=9, 2星=6, 1星=3, 0=0
  return Math.min(15, Math.max(0, rating * 3));
}

function scoreFundSize(size: number): number {
  if (size >= 2 && size <= 100) return 5;
  if (size > 100 && size <= 300) return 4;
  if (size >= 1 && size < 2) return 3;
  if (size > 300) return 2;
  return 1;
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

export function scoreFund(data: FundData): FundScore {
  const { performance: p, meta: m, basic } = data;
  const cat = classifyFund(basic.type);
  const rbp = p.riskByPeriod;

  const hasMorningstar = m.morningstarRating > 0;

  // 当晨星评级无数据时，将 15 分按比例重新分配到其他评分项
  // 原始满分: 收益40 + 风险30 + 综合30 = 100
  // 无晨星时: 收益47 + 风险35 + 综合18 = 100（按比例放大）
  const scale = hasMorningstar ? 1 : 100 / 85;

  // 分时段权重：近1年 40%，近3年 30%，全历史 30%
  const periodWeights = [
    { metrics: rbp.year1, weight: 0.4 },
    { metrics: rbp.year3, weight: 0.3 },
    { metrics: rbp.all,   weight: 0.3 },
  ];

  // 风险指标使用分时段加权评分
  const sharpeScoreVal = weightedPeriodScore(periodWeights,
    m => scoreHigherBetter(m.sharpeRatio, SHARPE_BENCHMARKS[cat], 10 * scale));
  const drawdownScoreVal = weightedPeriodScore(periodWeights,
    m => scoreLowerBetter(m.maxDrawdown, DRAWDOWN_BENCHMARKS[cat], 15 * scale));
  const sortinoScoreVal = weightedPeriodScore(periodWeights,
    m => scoreHigherBetter(m.sortinoRatio, SORTINO_BENCHMARKS[cat], 10 * scale));
  const volScoreVal = weightedPeriodScore(periodWeights,
    m => scoreLowerBetter(m.volatility, VOLATILITY_BENCHMARKS[cat], 5 * scale));

  const details: FundScore['details'] = [
    { item: '近1年收益', score: scoreHigherBetter(p.returnYear1, RETURN_YEAR1_BENCHMARKS[cat], 15 * scale), maxScore: Math.round(15 * scale * 10) / 10 },
    { item: '近3年收益', score: scoreHigherBetter(p.returnYear3, RETURN_YEAR3_BENCHMARKS[cat], 15 * scale), maxScore: Math.round(15 * scale * 10) / 10 },
    { item: '夏普比率', score: sharpeScoreVal, maxScore: Math.round(10 * scale * 10) / 10 },
    { item: '最大回撤', score: drawdownScoreVal, maxScore: Math.round(15 * scale * 10) / 10 },
    { item: '索提诺比率', score: sortinoScoreVal, maxScore: Math.round(10 * scale * 10) / 10 },
    { item: '波动率', score: volScoreVal, maxScore: Math.round(5 * scale * 10) / 10 },
    ...(hasMorningstar
      ? [{ item: '晨星评级', score: scoreMorningstar(m.morningstarRating), maxScore: 15 }]
      : []),
    { item: '基金规模', score: scoreFundSize(m.fundSize), maxScore: 5 },
    { item: '经理年限', score: scoreManagerYears(m.managerYears), maxScore: 5 },
    { item: '费率', score: scoreFeeRate(m.totalFeeRate), maxScore: 5 },
  ];

  // 四舍五入所有分数
  for (const d of details) {
    d.score = Math.round(d.score * 10) / 10;
  }

  // 计算分项得分（索引取决于是否有晨星评级）
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const returnScore = round1(details[0].score + details[1].score + details[2].score);
  const riskScore = round1(details[3].score + details[4].score + details[5].score);
  const morningstarIdx = hasMorningstar ? 6 : -1;
  const metaStart = hasMorningstar ? 7 : 6;
  const morningstarScore = morningstarIdx >= 0 ? details[morningstarIdx].score : 0;
  const overallScore = round1(morningstarScore + details[metaStart].score + details[metaStart + 1].score + details[metaStart + 2].score);

  return {
    returnScore,
    riskScore,
    overallScore,
    totalScore: round1(returnScore + riskScore + overallScore),
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

// ====== 深度评分模型 ======
// 收益能力(30) + 风险控制(30) + 持仓质量(15) + 稳定性(10) + 综合因素(15) = 100

// --- Alpha 基准 ---
const ALPHA_BENCHMARKS = {
  bond:     { full: 0.05, high: 0.03, mid: 0.01, low: -0.02 },
  balanced: { full: 0.10, high: 0.05, mid: 0.02, low: -0.03 },
  equity:   { full: 0.15, high: 0.08, mid: 0.03, low: -0.05 },
} as const;

// --- Beta 基准（越接近 0.8 越好，<1 优先） ---
function scoreBeta(beta: number, maxScore: number): number {
  // 理想 beta: 0.6~0.9，>=1 风险高
  if (beta >= 0.6 && beta <= 0.9) return maxScore;
  if (beta >= 0.4 && beta < 0.6) return maxScore * 0.8;
  if (beta > 0.9 && beta <= 1.0) return maxScore * 0.8;
  if (beta > 1.0 && beta <= 1.2) return maxScore * 0.5;
  if (beta > 1.2) return maxScore * 0.3;
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

/** 前10大重仓占比评分：20~50% 最佳（适度集中） */
function scoreTopHoldings(ratio: number, maxScore: number): number {
  if (ratio >= 20 && ratio <= 50) return maxScore;
  if (ratio > 50 && ratio <= 65) return maxScore * 0.7;
  if (ratio > 65) return maxScore * 0.4;
  if (ratio >= 10 && ratio < 20) return maxScore * 0.8;
  return maxScore * 0.5; // < 10% 过于分散
}

/** HHI 评分：0.05~0.15 最佳（适度集中），-1 表示无数据给中间分 */
function scoreHHI(hhi: number, maxScore: number): number {
  if (hhi < 0) return maxScore * 0.5; // 无数据
  if (hhi >= 0.05 && hhi <= 0.15) return maxScore;
  if (hhi > 0.15 && hhi <= 0.25) return maxScore * 0.7;
  if (hhi > 0.25) return maxScore * 0.4;
  if (hhi < 0.05) return maxScore * 0.8; // 超分散
  return maxScore * 0.5;
}

/** 滚动收益一致性：用252日窗口正收益比例 */
function scoreRollingConsistency(positiveRatio: number, maxScore: number): number {
  if (positiveRatio >= 0.85) return maxScore;
  if (positiveRatio >= 0.75) return maxScore * 0.8;
  if (positiveRatio >= 0.60) return maxScore * 0.6;
  if (positiveRatio >= 0.45) return maxScore * 0.4;
  return maxScore * 0.2;
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
  // 近1/3年收益 (15分)
  const retYear1 = scoreHigherBetter(p.returnYear1, RETURN_YEAR1_BENCHMARKS[cat], 8);
  details.push({ item: '近1年收益', score: retYear1, maxScore: 8 });
  const retYear3 = scoreHigherBetter(p.returnYear3, RETURN_YEAR3_BENCHMARKS[cat], 7);
  details.push({ item: '近3年收益', score: retYear3, maxScore: 7 });

  // Alpha (10分)
  const alphaScore = quant
    ? scoreHigherBetter(quant.alpha, ALPHA_BENCHMARKS[cat], 10)
    : 5; // 中间分
  details.push({ item: 'Alpha超额收益', score: alphaScore, maxScore: 10 });

  // 月度胜率 (5分)
  const winRateScore = quant
    ? scoreHigherBetter(quant.monthlyWinRate, WIN_RATE_BENCHMARKS[cat], 5)
    : 2.5;
  details.push({ item: '月度胜率', score: winRateScore, maxScore: 5 });

  const returnScore = round1(retYear1 + retYear3 + alphaScore + winRateScore);

  // ===== 风险控制 (30分) =====
  // 分时段权重：近1年 40%，近3年 30%，全历史 30%
  const deepPeriodWeights = [
    { metrics: p.riskByPeriod.year1, weight: 0.4 },
    { metrics: p.riskByPeriod.year3, weight: 0.3 },
    { metrics: p.riskByPeriod.all,   weight: 0.3 },
  ];

  // 夏普 (10分)
  const sharpeScore = weightedPeriodScore(deepPeriodWeights,
    m => scoreHigherBetter(m.sharpeRatio, SHARPE_BENCHMARKS[cat], 10));
  details.push({ item: '夏普比率', score: sharpeScore, maxScore: 10 });

  // 最大回撤 (8分)
  const drawdownScore = weightedPeriodScore(deepPeriodWeights,
    m => scoreLowerBetter(m.maxDrawdown, DRAWDOWN_BENCHMARKS[cat], 8));
  details.push({ item: '最大回撤', score: drawdownScore, maxScore: 8 });

  // Beta (5分)
  const betaScore = quant ? scoreBeta(quant.beta, 5) : 2.5;
  details.push({ item: 'Beta系数', score: betaScore, maxScore: 5 });

  // VaR (4分)
  const varScore = quant
    ? scoreLowerBetter(quant.var95, VAR_BENCHMARKS[cat], 4)
    : 2;
  details.push({ item: 'VaR(95%)', score: varScore, maxScore: 4 });

  // 波动率 (3分)
  const volScore = weightedPeriodScore(deepPeriodWeights,
    m => scoreLowerBetter(m.volatility, VOLATILITY_BENCHMARKS[cat], 3));
  details.push({ item: '波动率', score: volScore, maxScore: 3 });

  const riskScore = round1(sharpeScore + drawdownScore + betaScore + varScore + volScore);

  // ===== 持仓质量 (15分) =====
  // HHI (8分)
  const hhiScore = holdings ? scoreHHI(quant?.hhi ?? 0, 8) : 4;
  details.push({ item: '行业集中度HHI', score: hhiScore, maxScore: 8 });

  // 前10大重仓占比 (7分)
  const topHoldScore = holdings
    ? scoreTopHoldings(quant?.topHoldingsRatio ?? 0, 7)
    : 3.5;
  details.push({ item: '重仓占比', score: topHoldScore, maxScore: 7 });

  const holdingScore = round1(hhiScore + topHoldScore);

  // ===== 稳定性 (10分) =====
  // IR (5分)
  const irScore = quant
    ? scoreHigherBetter(quant.informationRatio, IR_BENCHMARKS[cat], 5)
    : 2.5;
  details.push({ item: '信息比率IR', score: irScore, maxScore: 5 });

  // 滚动收益一致性 (5分) — 用 CAGR>0 作为代理指标
  // 如果有 quant.cagr，使用 cagr > 0 判断；无数据给中间分
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

  const msScore = m.morningstarRating > 0 ? scoreMorningstar(m.morningstarRating) / 3 : 2.5;
  details.push({ item: '晨星评级', score: msScore, maxScore: 5 });

  const overallScore = round1(sizeScore + mgrScore + msScore);

  // 四舍五入所有 detail 分数
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
