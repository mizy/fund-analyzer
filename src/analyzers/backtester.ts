/**
 * 回测模块 — 定投回测、持有期分布、回撤买入策略
 */
import type { NavRecord } from '../types/fund.js';

export interface SIPResult {
  totalInvested: number;
  finalValue: number;
  totalReturn: number;       // 总收益率 %
  annualizedReturn: number;  // 年化收益率 %
  avgCost: number;           // 平均成本
  periods: number;           // 定投期数
}

export interface HoldingPeriodDist {
  period: number;        // 持有交易日数
  label: string;         // 如 "30天", "1年"
  positiveRatio: number; // 正收益概率
  avgReturn: number;
  medianReturn: number;
  minReturn: number;
  maxReturn: number;
  count: number;
}

export interface DrawdownBuyResult {
  buyCount: number;          // 买入次数
  avgBuyDrawdown: number;    // 平均买入时回撤幅度 %
  totalReturn: number;       // 总收益率 %
  annualizedReturn: number;  // 年化收益率 %
}

const PERIOD_LABELS: Record<number, string> = {
  30: '30天',
  90: '90天',
  180: '半年',
  365: '1年',
  730: '2年',
  1095: '3年',
};

/**
 * 定投回测：每月固定金额买入
 * 使用自然月作为定投周期（每月第一个交易日买入）
 */
export function sipBacktest(
  navs: NavRecord[],
  monthlyAmount: number = 1000
): SIPResult {
  if (navs.length < 2) {
    return { totalInvested: 0, finalValue: 0, totalReturn: 0, annualizedReturn: 0, avgCost: 0, periods: 0 };
  }

  let totalShares = 0;
  let totalInvested = 0;
  let periods = 0;
  let lastMonth = '';

  for (const nav of navs) {
    const month = nav.date.substring(0, 7); // YYYY-MM
    if (month !== lastMonth && nav.nav > 0) {
      // 每月第一个交易日买入
      totalShares += monthlyAmount / nav.nav;
      totalInvested += monthlyAmount;
      periods++;
      lastMonth = month;
    }
  }

  const finalNav = navs[navs.length - 1].nav;
  const finalValue = totalShares * finalNav;
  const totalReturn = totalInvested > 0
    ? (finalValue - totalInvested) / totalInvested * 100
    : 0;

  // 年化
  const startDate = new Date(navs[0].date);
  const endDate = new Date(navs[navs.length - 1].date);
  const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const annualizedReturn = years > 0
    ? (Math.pow(finalValue / totalInvested, 1 / years) - 1) * 100
    : 0;

  return {
    totalInvested,
    finalValue,
    totalReturn,
    annualizedReturn,
    avgCost: totalShares > 0 ? totalInvested / totalShares : 0,
    periods,
  };
}

/**
 * 不同持有期的收益分布
 * 滚动计算所有可能起点的持有期收益
 */
export function holdingPeriodDistribution(
  navs: NavRecord[],
  periods: number[] = [30, 90, 180, 365]
): HoldingPeriodDist[] {
  return periods.map(period => {
    const returns: number[] = [];

    for (let i = 0; i + period < navs.length; i++) {
      const startNav = navs[i].nav;
      const endNav = navs[i + period].nav;
      if (startNav > 0) {
        returns.push((endNav - startNav) / startNav * 100);
      }
    }

    if (returns.length === 0) {
      return {
        period,
        label: PERIOD_LABELS[period] ?? `${period}天`,
        positiveRatio: 0, avgReturn: 0, medianReturn: 0,
        minReturn: 0, maxReturn: 0, count: 0,
      };
    }

    const sorted = [...returns].sort((a, b) => a - b);

    return {
      period,
      label: PERIOD_LABELS[period] ?? `${period}天`,
      positiveRatio: returns.filter(r => r > 0).length / returns.length,
      avgReturn: returns.reduce((a, b) => a + b, 0) / returns.length,
      medianReturn: sorted[Math.floor(sorted.length / 2)],
      minReturn: sorted[0],
      maxReturn: sorted[sorted.length - 1],
      count: returns.length,
    };
  });
}

/**
 * 回撤买入策略：当从高点回撤超过阈值时买入
 * 每次买入固定金额，持有到最后一天
 */
export function drawdownBuyBacktest(
  navs: NavRecord[],
  drawdownThreshold: number = 20  // 默认 20% 回撤时买入
): DrawdownBuyResult {
  if (navs.length < 2) {
    return { buyCount: 0, avgBuyDrawdown: 0, totalReturn: 0, annualizedReturn: 0 };
  }

  const amount = 1000;
  let totalShares = 0;
  let totalInvested = 0;
  let peak = navs[0].nav;
  let lastBuyMonth = '';
  let totalDrawdownAtBuy = 0;

  for (const nav of navs) {
    if (nav.nav > peak) peak = nav.nav;
    const drawdown = (peak - nav.nav) / peak * 100;
    const month = nav.date.substring(0, 7);

    // 回撤超过阈值 + 同月不重复买入
    if (drawdown >= drawdownThreshold && month !== lastBuyMonth && nav.nav > 0) {
      totalShares += amount / nav.nav;
      totalInvested += amount;
      totalDrawdownAtBuy += drawdown;
      lastBuyMonth = month;
    }
  }

  if (totalInvested === 0) {
    return { buyCount: 0, avgBuyDrawdown: 0, totalReturn: 0, annualizedReturn: 0 };
  }

  const buyCount = totalInvested / amount;
  const finalValue = totalShares * navs[navs.length - 1].nav;
  const totalReturn = (finalValue - totalInvested) / totalInvested * 100;

  const startDate = new Date(navs[0].date);
  const endDate = new Date(navs[navs.length - 1].date);
  const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const annualizedReturn = years > 0
    ? (Math.pow(finalValue / totalInvested, 1 / years) - 1) * 100
    : 0;

  return {
    buyCount,
    avgBuyDrawdown: totalDrawdownAtBuy / buyCount,
    totalReturn,
    annualizedReturn,
  };
}
