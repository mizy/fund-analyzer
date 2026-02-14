/**
 * 业绩分析模块 — 滚动收益、CAGR、月度统计、胜率
 */
import type { NavRecord } from '../types/fund.js';

export interface RollingReturn {
  window: number;       // 窗口期交易日数
  label: string;        // 如 "1月", "3月"
  mean: number;         // 平均收益率
  median: number;       // 中位数
  min: number;
  max: number;
  positiveRatio: number; // 正收益占比
  count: number;         // 样本数
}

export interface MonthlyStats {
  returns: number[];     // 各月收益率
  mean: number;
  median: number;
  best: number;
  worst: number;
  stdDev: number;
}

const WINDOW_LABELS: Record<number, string> = {
  21: '1月',
  63: '3月',
  126: '6月',
  252: '1年',
};

/** 计算不同窗口期的滚动收益统计 */
export function calcRollingReturns(
  navs: NavRecord[],
  windows: number[] = [21, 63, 126, 252]
): RollingReturn[] {
  return windows.map(window => {
    const returns: number[] = [];
    for (let i = window; i < navs.length; i++) {
      const startNav = navs[i - window].nav;
      const endNav = navs[i].nav;
      if (startNav > 0) {
        returns.push((endNav - startNav) / startNav);
      }
    }

    if (returns.length === 0) {
      return {
        window,
        label: WINDOW_LABELS[window] ?? `${window}日`,
        mean: 0, median: 0, min: 0, max: 0,
        positiveRatio: 0, count: 0,
      };
    }

    const sorted = [...returns].sort((a, b) => a - b);

    return {
      window,
      label: WINDOW_LABELS[window] ?? `${window}日`,
      mean: returns.reduce((a, b) => a + b, 0) / returns.length,
      median: sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      positiveRatio: returns.filter(r => r > 0).length / returns.length,
      count: returns.length,
    };
  });
}

/** 年化复合增长率 CAGR = (endNAV / startNAV)^(1/years) - 1 */
export function calcCAGR(navs: NavRecord[]): number {
  if (navs.length < 2) return 0;
  const startNav = navs[0].nav;
  const endNav = navs[navs.length - 1].nav;
  if (startNav <= 0) return 0;

  const startDate = new Date(navs[0].date);
  const endDate = new Date(navs[navs.length - 1].date);
  const days = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  const years = days / 365.25;
  if (years <= 0) return 0;

  return Math.pow(endNav / startNav, 1 / years) - 1;
}

/** 月度收益统计 */
export function calcMonthlyStats(navs: NavRecord[]): MonthlyStats {
  // 按月份分组，计算每月收益
  const monthlyReturns: number[] = [];
  let i = 0;
  while (i < navs.length) {
    const month = navs[i].date.substring(0, 7); // YYYY-MM
    let j = i + 1;
    while (j < navs.length && navs[j].date.substring(0, 7) === month) {
      j++;
    }
    // 月末 vs 月初
    const startNav = navs[i].nav;
    const endNav = navs[j - 1].nav;
    if (startNav > 0 && i !== j - 1) {
      monthlyReturns.push((endNav - startNav) / startNav);
    }
    i = j;
  }

  if (monthlyReturns.length === 0) {
    return { returns: [], mean: 0, median: 0, best: 0, worst: 0, stdDev: 0 };
  }

  const mean = monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length;
  const sorted = [...monthlyReturns].sort((a, b) => a - b);
  const variance = monthlyReturns.reduce((s, r) => s + (r - mean) ** 2, 0)
    / (monthlyReturns.length - 1 || 1);

  return {
    returns: monthlyReturns,
    mean,
    median: sorted[Math.floor(sorted.length / 2)],
    best: sorted[sorted.length - 1],
    worst: sorted[0],
    stdDev: Math.sqrt(variance),
  };
}

/** 月度胜率（正收益月份占比） */
export function calcWinRate(navs: NavRecord[]): number {
  const stats = calcMonthlyStats(navs);
  if (stats.returns.length === 0) return 0;
  return stats.returns.filter(r => r > 0).length / stats.returns.length;
}
