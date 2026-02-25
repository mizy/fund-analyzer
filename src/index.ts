/** @entry fund-analyzer public API */

// Types
export type {
  FundCategory, FundBasicInfo, FundPerformance, FundMeta, FundData,
  FundScore, DeepFundScore, FundScoreDetail, FundAnalysis,
  QuantMetrics, BacktestResult, FundHoldings, NavRecord, BenchmarkRecord,
  PeriodRiskMetrics, PeriodRiskBreakdown,
} from './types/index.js';

// Scoring
export { classifyFund, scoreFund, scoreFundDeep, getScoreLevel } from './scorers/index.js';

// Data fetching
export { fetchFundData, fetchHistoryNav, fetchBenchmarkData, fetchFundHoldings } from './fetchers/index.js';

// Analyzers
export {
  calcAlphaBeta, calcInformationRatio, calcTreynorRatio,
  calcVaR, calcCVaR, calcDownsideCaptureRatio,
  calcCAGR, calcWinRate, calcRollingReturns,
  analyzeHoldings,
  sipBacktest, holdingPeriodDistribution, drawdownBuyBacktest,
} from './analyzers/index.js';

// Formatters
export {
  formatFundAnalysis, formatCompareTable, formatBatchSummary,
  formatDetailReport, formatBacktestReport, formatHoldingsReport,
} from './formatters/index.js';
