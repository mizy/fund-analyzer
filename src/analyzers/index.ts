/** @entry analyzers barrel export */
export {
  calcRollingReturns,
  calcCAGR,
  calcMonthlyStats,
  calcWinRate,
} from './performanceAnalyzer.js';
export type { RollingReturn, MonthlyStats } from './performanceAnalyzer.js';

export {
  calcAlphaBeta,
  calcInformationRatio,
  calcTreynorRatio,
  calcVaR,
  calcCVaR,
  calcDownsideCaptureRatio,
} from './riskAnalyzer.js';

export {
  calcConcentration,
  calcHHI,
  analyzeHoldings,
} from './holdingAnalyzer.js';
export type { HoldingAnalysis } from './holdingAnalyzer.js';

export {
  sipBacktest,
  holdingPeriodDistribution,
  drawdownBuyBacktest,
} from './backtester.js';
export type { SIPResult, HoldingPeriodDist, DrawdownBuyResult } from './backtester.js';
