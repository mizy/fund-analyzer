/** @entry backtest module - 评分预测回测系统 */
export { calcMetricsAtDate, buildFundDataAtDate, calcForwardReturns } from './calcHistoricalMetrics.js';
export { backtestFund, backtestBatch, backtestAtDate, fetchAccNavData } from './backtestEngine.js';
export { generateBacktestHTML } from './generateReport.js';
export type { HistoricalMetrics, ScoringBacktestResult, ScoringBacktestReport, CorrelationResult } from './types.js';
