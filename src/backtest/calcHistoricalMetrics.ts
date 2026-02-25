/**
 * 历史时点指标计算器
 * 给定累计净值序列和时点T，截取T往前的数据计算各项指标
 * 使用累计净值（ACWorthTrend）计算，不用单位净值
 */
import type { HistoricalMetrics } from './types.js';
import type { FundData, PeriodRiskMetrics, PeriodRiskBreakdown } from '../types/fund.js';

// navData 格式: [[timestamp_ms, accNav], ...]

/** 从累计净值序列计算日收益率 */
function calcDailyReturns(navData: number[][]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < navData.length; i++) {
    const prev = navData[i - 1][1];
    if (prev > 0) {
      returns.push((navData[i][1] - prev) / prev);
    }
  }
  return returns;
}

/** 计算最大回撤 %（从净值数组） */
function calcMaxDrawdown(navData: number[][]): number {
  if (navData.length < 2) return 0;
  let peak = navData[0][1];
  let maxDd = 0;
  for (const [, nav] of navData) {
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return Math.round(maxDd * 10000) / 100;
}

/** 计算年化波动率 % */
function calcVolatility(navData: number[][]): number {
  if (navData.length < 10) return 0;
  const returns = calcDailyReturns(navData);
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.round(Math.sqrt(variance) * Math.sqrt(252) * 10000) / 100;
}

/** 计算年化夏普比率 */
function calcSharpeRatio(navData: number[][]): number {
  if (navData.length < 30) return 0;
  const returns = calcDailyReturns(navData);
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  const riskFreeDaily = 0.02 / 252;
  return Math.round(((mean - riskFreeDaily) / stdDev) * Math.sqrt(252) * 100) / 100;
}

/** 计算索提诺比率 */
function calcSortinoRatio(navData: number[][], annualReturn: number): number {
  if (navData.length < 10) return 0;
  const returns = calcDailyReturns(navData);
  const riskFreeDaily = 0.02 / 252;
  const downsideReturns = returns
    .filter(r => r < riskFreeDaily)
    .map(r => (r - riskFreeDaily) ** 2);
  if (downsideReturns.length === 0) return 3;
  const downsideDeviation = Math.sqrt(
    downsideReturns.reduce((s, r) => s + r, 0) / downsideReturns.length
  );
  const annualizedDownside = downsideDeviation * Math.sqrt(252);
  if (annualizedDownside === 0) return 3;
  return Math.round(((annualReturn / 100 - 0.02) / annualizedDownside) * 100) / 100;
}

/** 从 navData 截取指定窗口年数的数据 */
function sliceNavWindow(navData: number[][], endTs: number, windowYears: number): number[][] | null {
  const startTs = endTs - windowYears * 365.25 * 24 * 3600 * 1000;
  const sliced = navData.filter(([ts]) => ts >= startTs && ts <= endTs);
  // 数据不足（实际时间跨度 < 窗口的 80%）
  if (sliced.length < 10) return null;
  const actualSpanMs = sliced[sliced.length - 1][0] - sliced[0][0];
  const requiredSpanMs = windowYears * 365.25 * 24 * 3600 * 1000 * 0.8;
  if (actualSpanMs < requiredSpanMs) return null;
  return sliced;
}

/** 计算收益率: (endNav - startNav) / startNav * 100 */
function calcReturn(navData: number[][]): number {
  if (navData.length < 2) return 0;
  const start = navData[0][1];
  const end = navData[navData.length - 1][1];
  if (start <= 0) return 0;
  return Math.round((end - start) / start * 10000) / 100;
}

/** 计算年化收益率 */
function calcAnnualizedReturn(navData: number[][]): number {
  if (navData.length < 2) return 0;
  const startNav = navData[0][1];
  const endNav = navData[navData.length - 1][1];
  if (startNav <= 0) return 0;
  const years = (navData[navData.length - 1][0] - navData[0][0]) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0) return 0;
  return (Math.pow(endNav / startNav, 1 / years) - 1) * 100;
}

/** Calmar Ratio = annualized return / |max drawdown| */
function calcCalmarRatio(annualReturn: number, maxDrawdown: number): number {
  if (!Number.isFinite(annualReturn) || !Number.isFinite(maxDrawdown)) return 0;
  if (maxDrawdown === 0) return 0;
  return Math.round((annualReturn / Math.abs(maxDrawdown)) * 100) / 100;
}

/** 计算单时段风险指标 */
function calcPeriodRisk(navData: number[][] | null, annualReturn: number): PeriodRiskMetrics | null {
  if (!navData || navData.length < 10) return null;
  const maxDrawdown = calcMaxDrawdown(navData);
  const annualizedReturn = calcAnnualizedReturn(navData);
  return {
    sharpeRatio: calcSharpeRatio(navData),
    maxDrawdown,
    volatility: calcVolatility(navData),
    sortinoRatio: calcSortinoRatio(navData, annualReturn),
    calmarRatio: calcCalmarRatio(annualizedReturn, maxDrawdown),
  };
}

/**
 * 计算指定时点T的历史指标
 * @param accNavData 完整累计净值序列 [[timestamp_ms, accNav], ...]
 * @param evalDate 评估日期 (Date 对象或 timestamp)
 */
export function calcMetricsAtDate(
  accNavData: number[][],
  evalDate: Date,
): HistoricalMetrics {
  const evalTs = evalDate.getTime();

  // 截取 evalDate 之前的所有数据
  const dataBeforeT = accNavData.filter(([ts]) => ts <= evalTs);
  if (dataBeforeT.length < 10) {
    return { returnYear1: 0, returnYear3: 0, sharpeRatio: 0, maxDrawdown: 0, volatility: 0, sortinoRatio: 0 };
  }

  // 近1年/近3年收益率
  const nav1y = sliceNavWindow(dataBeforeT, evalTs, 1);
  const nav3y = sliceNavWindow(dataBeforeT, evalTs, 3);
  const returnYear1 = nav1y ? calcReturn(nav1y) : 0;
  const returnYear3 = nav3y ? calcReturn(nav3y) : 0;

  // 全量风险指标
  const sharpeRatio = calcSharpeRatio(dataBeforeT);
  const maxDrawdown = calcMaxDrawdown(dataBeforeT);
  const volatility = calcVolatility(dataBeforeT);
  const sortinoRatio = calcSortinoRatio(dataBeforeT, returnYear1);

  return { returnYear1, returnYear3, sharpeRatio, maxDrawdown, volatility, sortinoRatio };
}

/**
 * 从历史指标构建 FundData，用于调用现有评分函数
 * 对不可用指标（晨星评级、规模等）给中间默认值
 */
export function buildFundDataAtDate(
  metrics: HistoricalMetrics,
  accNavData: number[][],
  evalDate: Date,
  currentMeta: { fundCode: string; fundName: string; fundType: string; establishDate: string;
    fundSize: number; managerYears: number; totalFeeRate: number },
): FundData {
  const evalTs = evalDate.getTime();
  const dataBeforeT = accNavData.filter(([ts]) => ts <= evalTs);

  // 计算分时段风险指标（评分函数需要 riskByPeriod）
  const nav1y = sliceNavWindow(dataBeforeT, evalTs, 1);
  const nav3y = sliceNavWindow(dataBeforeT, evalTs, 3);

  const riskByPeriod: PeriodRiskBreakdown = {
    year1: calcPeriodRisk(nav1y, metrics.returnYear1),
    year3: calcPeriodRisk(nav3y, metrics.returnYear3),
    all: {
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown,
      volatility: metrics.volatility,
      sortinoRatio: metrics.sortinoRatio,
      calmarRatio: calcCalmarRatio(calcAnnualizedReturn(dataBeforeT), metrics.maxDrawdown),
    },
  };

  // 经理年限：从成立日期推算到评估日期
  const establishTs = new Date(currentMeta.establishDate).getTime();
  const yearsFromEstablish = isNaN(establishTs)
    ? currentMeta.managerYears
    : (evalTs - establishTs) / (365.25 * 24 * 3600 * 1000);

  return {
    basic: {
      code: currentMeta.fundCode,
      name: currentMeta.fundName,
      type: currentMeta.fundType,
      establishDate: currentMeta.establishDate,
    },
    performance: {
      returnYear1: metrics.returnYear1,
      returnYear3: metrics.returnYear3,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown,
      sortinoRatio: metrics.sortinoRatio,
      volatility: metrics.volatility,
      riskByPeriod,
    },
    meta: {
      morningstarRating: 0,  // 无历史数据，评分函数会自动 rescale
      categoryRankPercent: 0,
      fundSize: currentMeta.fundSize,  // 使用当前值
      managerYears: Math.round(Math.max(0, yearsFromEstablish) * 10) / 10,
      totalFeeRate: currentMeta.totalFeeRate,
    },
  };
}

/**
 * 计算评估日之后的实际收益
 * @param accNavData 完整累计净值序列
 * @param evalDate 评估日期
 * @param forwardYears 向前看的年数列表，如 [1, 2]
 */
export function calcForwardReturns(
  accNavData: number[][],
  evalDate: Date,
  forwardYears: number[],
): { period: string; return: number; annualized: number }[] {
  const evalTs = evalDate.getTime();

  // 找到最接近 evalDate 的净值点
  let evalIdx = -1;
  for (let i = 0; i < accNavData.length; i++) {
    if (accNavData[i][0] >= evalTs) { evalIdx = i; break; }
  }
  if (evalIdx < 0) return [];

  const evalNav = accNavData[evalIdx][1];
  if (evalNav <= 0) return [];

  return forwardYears.map(years => {
    const targetTs = evalTs + years * 365.25 * 24 * 3600 * 1000;
    // 找到最接近 targetTs 的净值点
    let targetIdx = -1;
    for (let i = evalIdx; i < accNavData.length; i++) {
      if (accNavData[i][0] >= targetTs) { targetIdx = i; break; }
    }
    // 如果没找到精确的，用最后一个数据点（数据可能不足）
    if (targetIdx < 0) {
      const lastIdx = accNavData.length - 1;
      const lastTs = accNavData[lastIdx][0];
      // 如果最后数据点距离目标不到目标时间跨度的80%，认为数据不足
      const actualSpan = lastTs - evalTs;
      const requiredSpan = years * 365.25 * 24 * 3600 * 1000 * 0.8;
      if (actualSpan < requiredSpan) {
        return { period: `${years}y`, return: NaN, annualized: NaN };
      }
      targetIdx = lastIdx;
    }

    const targetNav = accNavData[targetIdx][1];
    const totalReturn = (targetNav - evalNav) / evalNav * 100;
    const actualYears = (accNavData[targetIdx][0] - evalTs) / (365.25 * 24 * 3600 * 1000);
    const annualized = actualYears > 0
      ? (Math.pow(targetNav / evalNav, 1 / actualYears) - 1) * 100
      : 0;

    return {
      period: `${years}y`,
      return: Math.round(totalReturn * 100) / 100,
      annualized: Math.round(annualized * 100) / 100,
    };
  });
}
