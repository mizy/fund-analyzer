/**
 * 持仓分析模块 — 集中度、HHI、综合分析
 */
import type { FundHoldings } from '../types/fund.js';

export interface HoldingAnalysis {
  topHoldingsRatio: number;   // 前10大重仓占比 %
  hhi: number;                // 行业 HHI (0~1)
  stockCount: number;         // 重仓股数量
  topStock: string;           // 第一大重仓股名称
  concentrationLevel: string; // 集中度评级
}

/** 前10大重仓股占净值比例总和 */
export function calcConcentration(holdings: FundHoldings): number {
  return holdings.topStocks.reduce((sum, s) => sum + s.percent, 0);
}

/** 行业 HHI 指数 (Herfindahl-Hirschman Index)，归一化到 0~1 */
export function calcHHI(holdings: FundHoldings): number {
  const weights = holdings.industries.map(i => i.percent);
  if (weights.length === 0) return -1; // 无数据
  if (weights.length === 1) return 1;

  // HHI = Σ(wi/100)²
  const hhi = weights.reduce((sum, w) => sum + (w / 100) ** 2, 0);
  return hhi;
}

/** 综合持仓分析 */
export function analyzeHoldings(holdings: FundHoldings): HoldingAnalysis {
  const topHoldingsRatio = calcConcentration(holdings);
  const hhi = calcHHI(holdings);

  let concentrationLevel: string;
  if (topHoldingsRatio > 50) {
    concentrationLevel = '高度集中';
  } else if (topHoldingsRatio > 30) {
    concentrationLevel = '适度集中';
  } else {
    concentrationLevel = '高度分散';
  }

  return {
    topHoldingsRatio,
    hhi,
    stockCount: holdings.topStocks.length,
    topStock: holdings.topStocks[0]?.name ?? '-',
    concentrationLevel,
  };
}
