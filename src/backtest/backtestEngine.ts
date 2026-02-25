/**
 * 回测引擎 — 评分预测回测
 * 在历史时点T用评分模型打分，再看T之后的实际表现，验证评分的预测力
 */
import { scoreFund } from '../scorers/fundScorer.js';
import { fetchFundData, fetchHistoryNav } from '../fetchers/index.js';
import { calcMetricsAtDate, buildFundDataAtDate, calcForwardReturns } from './calcHistoricalMetrics.js';
import type { ScoringBacktestResult, ScoringBacktestReport, CorrelationResult } from './types.js';

/** 从 pingzhongdata 获取累计净值原始数据 */
export async function fetchAccNavData(code: string): Promise<{
  accNavData: number[][];
  fundName: string;
  fundType: string;
  establishDate: string;
  fundSize: number;
  managerYears: number;
  totalFeeRate: number;
}> {

  const [fundData, navRecords] = await Promise.all([
    fetchFundData(code),
    fetchHistoryNav(code),
  ]);

  // 将 NavRecord[] 转为 [[timestamp_ms, accNav], ...]
  const accNavData: number[][] = navRecords.map(r => [
    new Date(r.date).getTime(),
    r.accNav,
  ]);

  return {
    accNavData,
    fundName: fundData.basic.name,
    fundType: fundData.basic.type,
    establishDate: fundData.basic.establishDate,
    fundSize: fundData.meta.fundSize,
    managerYears: fundData.meta.managerYears,
    totalFeeRate: fundData.meta.totalFeeRate,
  };
}

/**
 * 单基金单时点回测
 */
export function backtestAtDate(
  accNavData: number[][],
  evalDate: Date,
  forwardYears: number[],
  meta: { fundCode: string; fundName: string; fundType: string; establishDate: string;
    fundSize: number; managerYears: number; totalFeeRate: number },
): ScoringBacktestResult | null {
  // 计算历史指标
  const metrics = calcMetricsAtDate(accNavData, evalDate);

  // 构建 FundData 并评分
  const fundData = buildFundDataAtDate(metrics, accNavData, evalDate, meta);
  const score = scoreFund(fundData);

  // 计算前瞻收益
  const forwardReturns = calcForwardReturns(accNavData, evalDate, forwardYears);

  // 过滤掉没有有效前瞻收益的（数据不足）
  const validForwards = forwardReturns.filter(f => !isNaN(f.return));
  if (validForwards.length === 0) return null;

  return {
    fundCode: meta.fundCode,
    fundName: meta.fundName,
    fundType: meta.fundType,
    evalDate: evalDate.toISOString().slice(0, 10),
    score: score.totalScore,
    scoreDetails: score.details,
    metrics,
    forwardReturns: validForwards,
  };
}

/**
 * 单基金多时点回测
 * @param code 基金代码
 * @param startDate 回测起始日期
 * @param endDate 回测结束日期
 * @param stepMonths 采样间隔（月）
 * @param forwardYears 前瞻期（年）
 */
export async function backtestFund(
  code: string,
  startDate: string,
  endDate: string,
  stepMonths: number = 3,
  forwardYears: number[] = [1],
): Promise<ScoringBacktestResult[]> {
  const { accNavData, ...meta } = await fetchAccNavData(code);
  const metaWithCode = { fundCode: code, ...meta };

  const results: ScoringBacktestResult[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  // 需要至少1年历史数据才能评分，所以评估起点 = max(数据起点+1年, startDate)
  const dataStartTs = accNavData[0]?.[0] ?? 0;
  const minEvalTs = dataStartTs + 365.25 * 24 * 3600 * 1000;
  const effectiveStart = new Date(Math.max(start.getTime(), minEvalTs));

  const current = new Date(effectiveStart);
  while (current <= end) {
    const result = backtestAtDate(accNavData, current, forwardYears, metaWithCode);
    if (result) results.push(result);
    current.setMonth(current.getMonth() + stepMonths);
  }

  return results;
}

// --- 统计分析 ---

/** Pearson 相关系数 */
function calcPearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const avgX = x.reduce((a, b) => a + b, 0) / n;
  const avgY = y.reduce((a, b) => a + b, 0) / n;
  let covXY = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - avgX;
    const dy = y[i] - avgY;
    covXY += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? 0 : Math.round(covXY / denom * 10000) / 10000;
}

/** Spearman 等级相关系数 */
function calcSpearman(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  // 转为排名
  const rankOf = (arr: number[]) => {
    const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  return calcPearson(rankOf(x), rankOf(y));
}

/** 按评分五分位分组分析 */
function calcQuintileReturns(
  results: ScoringBacktestResult[],
  period: string,
): { label: string; avgScore: number; avgReturn: number; count: number }[] {
  // 过滤出有该 period 收益的样本
  const samples = results
    .map(r => {
      const fwd = r.forwardReturns.find(f => f.period === period);
      return fwd ? { score: r.score, ret: fwd.return } : null;
    })
    .filter((s): s is { score: number; ret: number } => s !== null);

  if (samples.length < 5) return [];

  // 按分数降序排列，分5组
  samples.sort((a, b) => b.score - a.score);
  const quintileSize = Math.ceil(samples.length / 5);
  const labels = ['Q1(最高分)', 'Q2', 'Q3', 'Q4', 'Q5(最低分)'];

  return labels.map((label, qi) => {
    const start = qi * quintileSize;
    const end = Math.min(start + quintileSize, samples.length);
    const group = samples.slice(start, end);
    if (group.length === 0) return { label, avgScore: 0, avgReturn: 0, count: 0 };
    return {
      label,
      avgScore: Math.round(group.reduce((s, g) => s + g.score, 0) / group.length * 10) / 10,
      avgReturn: Math.round(group.reduce((s, g) => s + g.ret, 0) / group.length * 100) / 100,
      count: group.length,
    };
  });
}

/**
 * 批量回测：多基金多时点
 */
export async function backtestBatch(
  codes: string[],
  startDate: string,
  endDate: string,
  stepMonths: number = 3,
  forwardYears: number[] = [1],
  onProgress?: (msg: string) => void,
): Promise<ScoringBacktestReport> {
  const allResults: ScoringBacktestResult[] = [];

  for (const code of codes) {
    onProgress?.(`回测 ${code} ...`);
    try {
      const results = await backtestFund(code, startDate, endDate, stepMonths, forwardYears);
      allResults.push(...results);
      onProgress?.(`  ${code}: ${results.length} 个采样点`);
    } catch (err) {
      onProgress?.(`  ${code}: 失败 - ${err instanceof Error ? err.message : '未知错误'}`);
    }
  }

  // 按 forward period 计算相关性
  const periods = forwardYears.map(y => `${y}y`);
  const correlation: Record<string, CorrelationResult> = {};

  for (const period of periods) {
    const pairs = allResults
      .map(r => {
        const fwd = r.forwardReturns.find(f => f.period === period);
        return fwd ? { score: r.score, ret: fwd.return } : null;
      })
      .filter((p): p is { score: number; ret: number } => p !== null);

    const scores = pairs.map(p => p.score);
    const returns = pairs.map(p => p.ret);

    correlation[period] = {
      pearson: calcPearson(scores, returns),
      spearman: calcSpearman(scores, returns),
      sampleSize: pairs.length,
    };
  }

  // 五分位分析
  const scoreQuintileReturns = periods.map(period => ({
    period,
    quintiles: calcQuintileReturns(allResults, period),
  }));

  // 日期范围
  const dates = allResults.map(r => r.evalDate).sort();
  const dateRange = dates.length > 0 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '';
  const fundCodes = new Set(allResults.map(r => r.fundCode));

  return {
    results: allResults,
    correlation,
    scoreQuintileReturns,
    summary: {
      totalSamples: allResults.length,
      dateRange,
      fundCount: fundCodes.size,
    },
  };
}
