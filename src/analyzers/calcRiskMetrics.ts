import type { PeriodRiskMetrics, PeriodRiskBreakdown } from "../types/fund.js";

/** Calculate max drawdown from nav array [[timestamp, nav], ...] */
export function calcMaxDrawdown(navData: number[][] | null): number {
  if (!navData || navData.length < 2) return 0;
  let peak = navData[0][1];
  let maxDd = 0;
  for (const [, nav] of navData) {
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return Math.round(maxDd * 10000) / 100;
}

/** Calculate annualized volatility from nav array */
export function calcVolatility(navData: number[][] | null): number {
  if (!navData || navData.length < 10) return 0;
  const returns: number[] = [];
  for (let i = 1; i < navData.length; i++) {
    returns.push((navData[i][1] - navData[i - 1][1]) / navData[i - 1][1]);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.round(Math.sqrt(variance) * Math.sqrt(252) * 10000) / 100;
}

/** Calculate annualized Sharpe ratio from nav array */
export function calcSharpeRatio(navData: number[][] | null): number {
  if (!navData || navData.length < 30) return 0;
  const returns: number[] = [];
  for (let i = 1; i < navData.length; i++) {
    returns.push((navData[i][1] - navData[i - 1][1]) / navData[i - 1][1]);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  const riskFreeDaily = 0.02 / 252;
  return Math.round(((mean - riskFreeDaily) / stdDev) * Math.sqrt(252) * 100) / 100;
}

/** Calculate Sortino ratio */
export function calcSortinoRatio(navData: number[][] | null, returnYear1: number): number {
  if (!navData || navData.length < 10) return 0;
  const returns: number[] = [];
  for (let i = 1; i < navData.length; i++) {
    returns.push((navData[i][1] - navData[i - 1][1]) / navData[i - 1][1]);
  }
  const riskFreeDaily = 0.02 / 252;
  const downsideReturns = returns
    .filter((r) => r < riskFreeDaily)
    .map((r) => (r - riskFreeDaily) ** 2);
  if (downsideReturns.length === 0) return 3;
  const downsideDeviation = Math.sqrt(
    downsideReturns.reduce((s, r) => s + r, 0) / downsideReturns.length,
  );
  const annualizedDownside = downsideDeviation * Math.sqrt(252);
  if (annualizedDownside === 0) return 3;
  return Math.round(((returnYear1 / 100 - 0.02) / annualizedDownside) * 100) / 100;
}

/** @entry Calmar Ratio = annualized return / |max drawdown| */
export function calcCalmarRatio(annualReturn: number, maxDrawdown: number): number {
  if (!Number.isFinite(annualReturn) || !Number.isFinite(maxDrawdown)) return 0;
  if (maxDrawdown === 0) return 0;
  return Math.round((annualReturn / Math.abs(maxDrawdown)) * 100) / 100;
}

/** Slice navData to a time window (in years) */
export function sliceNavData(navData: number[][], windowYears: number): number[][] | null {
  if (navData.length === 0) return null;
  const latestTs = navData[navData.length - 1][0];
  const cutoffTs = latestTs - windowYears * 365.25 * 24 * 3600 * 1000;
  let startIdx = 0;
  for (let i = 0; i < navData.length; i++) {
    if (navData[i][0] >= cutoffTs) { startIdx = i; break; }
  }
  const sliced = navData.slice(startIdx);
  const actualSpanMs = sliced[sliced.length - 1][0] - sliced[0][0];
  const requiredSpanMs = windowYears * 365.25 * 24 * 3600 * 1000 * 0.8;
  if (actualSpanMs < requiredSpanMs) return null;
  return sliced;
}

function calcAnnualizedReturn(navData: number[][]): number {
  if (navData.length < 2) return 0;
  const startNav = navData[0][1];
  const endNav = navData[navData.length - 1][1];
  if (startNav <= 0) return 0;
  const years = (navData[navData.length - 1][0] - navData[0][0]) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0) return 0;
  return (Math.pow(endNav / startNav, 1 / years) - 1) * 100;
}

function calcPeriodRiskMetrics(navData: number[][] | null, returnYear1: number): PeriodRiskMetrics | null {
  if (!navData || navData.length < 10) return null;
  const maxDrawdown = calcMaxDrawdown(navData);
  const annualizedReturn = calcAnnualizedReturn(navData);
  return {
    maxDrawdown,
    volatility: calcVolatility(navData),
    sharpeRatio: calcSharpeRatio(navData),
    sortinoRatio: calcSortinoRatio(navData, returnYear1),
    calmarRatio: calcCalmarRatio(annualizedReturn, maxDrawdown),
  };
}

/** Calculate risk metrics for 1y, 3y, and all-time periods */
export function calcMultiPeriodRiskMetrics(navData: number[][] | null, returnYear1: number): PeriodRiskBreakdown {
  const maxDrawdownAll = calcMaxDrawdown(navData);
  const annualizedReturnAll = navData ? calcAnnualizedReturn(navData) : 0;
  const allMetrics: PeriodRiskMetrics = {
    maxDrawdown: maxDrawdownAll,
    volatility: calcVolatility(navData),
    sharpeRatio: calcSharpeRatio(navData),
    sortinoRatio: calcSortinoRatio(navData, returnYear1),
    calmarRatio: calcCalmarRatio(annualizedReturnAll, maxDrawdownAll),
  };

  const nav1y = navData ? sliceNavData(navData, 1) : null;
  const nav3y = navData ? sliceNavData(navData, 3) : null;

  return {
    year1: calcPeriodRiskMetrics(nav1y, returnYear1),
    year3: calcPeriodRiskMetrics(nav3y, returnYear1),
    all: allMetrics,
  };
}
