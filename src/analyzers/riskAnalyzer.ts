/**
 * 风险分析模块 — Alpha/Beta、IR、Treynor、VaR/CVaR、下行捕获
 */
import type { NavRecord, BenchmarkRecord } from '../types/fund.js';

const DEFAULT_RISK_FREE_RATE = 0.025; // 年化 2.5%

// ---- 辅助函数 ----

/** 对齐基金净值和基准数据（按日期取交集） */
function alignReturns(
  fundNavs: NavRecord[],
  benchmarkData: BenchmarkRecord[]
): { fundReturns: number[]; benchReturns: number[] } {
  const benchMap = new Map(benchmarkData.map(b => [b.date, b.dailyReturn]));
  const fundReturns: number[] = [];
  const benchReturns: number[] = [];

  for (const nav of fundNavs) {
    const benchReturn = benchMap.get(nav.date);
    if (benchReturn !== undefined) {
      fundReturns.push(nav.dailyReturn / 100);  // NavRecord.dailyReturn 是百分比
      benchReturns.push(benchReturn / 100);
    }
  }

  return { fundReturns, benchReturns };
}

/** 简单线性回归 y = alpha + beta * x，返回 { alpha, beta } */
function linearRegression(x: number[], y: number[]): { alpha: number; beta: number } {
  const n = x.length;
  if (n < 2) return { alpha: 0, beta: 0 };

  const avgX = x.reduce((a, b) => a + b, 0) / n;
  const avgY = y.reduce((a, b) => a + b, 0) / n;

  let covXY = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - avgX;
    const dy = y[i] - avgY;
    covXY += dx * dy;
    varX += dx * dx;
  }

  if (varX === 0) return { alpha: avgY, beta: 0 };

  const beta = covXY / varX;
  const alpha = avgY - beta * avgX;
  return { alpha, beta };
}

// ---- 导出函数 ----

/** 计算 Alpha 和 Beta（基于日收益率的线性回归） */
export function calcAlphaBeta(
  fundNavs: NavRecord[],
  benchmarkData: BenchmarkRecord[]
): { alpha: number; beta: number } {
  const { fundReturns, benchReturns } = alignReturns(fundNavs, benchmarkData);
  if (fundReturns.length < 30) return { alpha: 0, beta: 0 };

  // 日收益率回归: Rf_excess = alpha_daily + beta * Rm_excess
  const dailyRf = DEFAULT_RISK_FREE_RATE / 252;
  const excessFund = fundReturns.map(r => r - dailyRf);
  const excessBench = benchReturns.map(r => r - dailyRf);

  const reg = linearRegression(excessBench, excessFund);

  // 年化 alpha: alpha_annual ≈ alpha_daily * 252
  return {
    alpha: reg.alpha * 252,
    beta: reg.beta,
  };
}

/** 信息比率 IR = mean(超额收益) / std(超额收益)，年化 */
export function calcInformationRatio(
  fundNavs: NavRecord[],
  benchmarkData: BenchmarkRecord[]
): number {
  const { fundReturns, benchReturns } = alignReturns(fundNavs, benchmarkData);
  if (fundReturns.length < 30) return 0;

  const activeReturns = fundReturns.map((r, i) => r - benchReturns[i]);
  const mean = activeReturns.reduce((a, b) => a + b, 0) / activeReturns.length;
  const variance = activeReturns.reduce((s, r) => s + (r - mean) ** 2, 0)
    / (activeReturns.length - 1);
  const te = Math.sqrt(variance);

  if (te === 0) return 0;

  // 年化: IR_annual = (mean_daily / te_daily) * sqrt(252)
  return (mean / te) * Math.sqrt(252);
}

/** 特雷诺比率 Treynor = (Rp_annual - Rf) / Beta */
export function calcTreynorRatio(
  fundNavs: NavRecord[],
  benchmarkData: BenchmarkRecord[],
  riskFreeRate: number = DEFAULT_RISK_FREE_RATE
): number {
  const { alpha, beta } = calcAlphaBeta(fundNavs, benchmarkData);
  if (beta === 0) return 0;

  // 用 alpha 反推年化基金超额收益 Rp - Rf = alpha + beta * (Rm - Rf)
  // 简化：直接从日收益率计算年化收益
  const { fundReturns } = alignReturns(fundNavs, benchmarkData);
  const dailyMean = fundReturns.reduce((a, b) => a + b, 0) / fundReturns.length;
  const annualReturn = dailyMean * 252;

  return (annualReturn - riskFreeRate) / beta;
}

/** 历史模拟法 VaR (95% 置信度)，返回正值表示损失幅度 */
export function calcVaR(navs: NavRecord[], confidence: number = 0.95): number {
  const returns = navs
    .filter(n => n.dailyReturn !== 0 || navs.indexOf(n) > 0)
    .map(n => n.dailyReturn / 100);

  if (returns.length < 30) return 0;

  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  return -sorted[index];
}

/** 条件 VaR (CVaR / Expected Shortfall)，返回正值 */
export function calcCVaR(navs: NavRecord[], confidence: number = 0.95): number {
  const returns = navs
    .filter(n => n.dailyReturn !== 0 || navs.indexOf(n) > 0)
    .map(n => n.dailyReturn / 100);

  if (returns.length < 30) return 0;

  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.floor((1 - confidence) * sorted.length);
  if (cutoff === 0) return -sorted[0];

  const tail = sorted.slice(0, cutoff);
  return -tail.reduce((s, r) => s + r, 0) / tail.length;
}

/** 下行捕获比率：市场下跌时基金跌幅 / 基准跌幅 */
export function calcDownsideCaptureRatio(
  fundNavs: NavRecord[],
  benchmarkData: BenchmarkRecord[]
): number {
  const { fundReturns, benchReturns } = alignReturns(fundNavs, benchmarkData);
  if (fundReturns.length < 30) return 0;

  // 筛选基准下跌的交易日
  const downIndices = benchReturns
    .map((r, i) => r < 0 ? i : -1)
    .filter(i => i >= 0);

  if (downIndices.length === 0) return 0;

  const fundDownAvg = downIndices.reduce((s, i) => s + fundReturns[i], 0) / downIndices.length;
  const benchDownAvg = downIndices.reduce((s, i) => s + benchReturns[i], 0) / downIndices.length;

  if (benchDownAvg === 0) return 0;

  return fundDownAvg / benchDownAvg;
}
