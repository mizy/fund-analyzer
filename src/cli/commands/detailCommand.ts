import type { Command } from 'commander';
import chalk from 'chalk';
import { fetchFundData, fetchFundHoldings } from '../../fetchers/ttjjFetcher.js';
import { fetchHistoryNav, fetchBenchmarkData } from '../../fetchers/fetchNavHistory.js';
import { scoreFund } from '../../scorers/fundScorer.js';
import { scoreFundDeep } from '../../scorers/fundScorerDeep.js';
import { formatDetailReport, formatBacktestReport, formatHoldingsReport } from '../../formatters/terminalFormatter.js';
import {
  calcAlphaBeta, calcInformationRatio, calcTreynorRatio,
  calcVaR, calcCVaR, calcDownsideCaptureRatio,
  calcCAGR, calcWinRate,
  analyzeHoldings,
  sipBacktest, holdingPeriodDistribution, drawdownBuyBacktest,
} from '../../analyzers/index.js';
import { handleError } from '../handleError.js';
import type { FundAnalysis, QuantMetrics, BacktestResult, NavRecord } from '../../types/fund.js';

/** 根据基金类型选择基准指数 */
function getBenchmarkCode(fundType: string): string {
  if (/债券|纯债|短债|中短债|长债|偏债/.test(fundType)) return '000012'; // 国债指数
  return '000300'; // 沪深300
}

/** 运行量化分析，返回 QuantMetrics */
async function runQuantAnalysis(code: string, fundType: string): Promise<{ quant: QuantMetrics; navs: NavRecord[] }> {
  const benchmarkCode = getBenchmarkCode(fundType);

  console.log(chalk.gray('  [1/3] 抓取历史净值 ...'));
  const navs = await fetchHistoryNav(code);

  console.log(chalk.gray('  [2/3] 抓取基准指数数据 ...'));
  const startDate = navs.length > 0 ? navs[0].date : undefined;
  const benchmark = await fetchBenchmarkData(benchmarkCode, startDate);

  console.log(chalk.gray('  [3/3] 计算量化指标 ...'));
  const { alpha, beta } = calcAlphaBeta(navs, benchmark);
  const informationRatio = calcInformationRatio(navs, benchmark);
  const treynorRatio = calcTreynorRatio(navs, benchmark);
  const var95 = calcVaR(navs);
  const cvar95 = calcCVaR(navs);
  const monthlyWinRate = calcWinRate(navs);
  const downsideCaptureRatio = calcDownsideCaptureRatio(navs, benchmark);
  const cagr = calcCAGR(navs);

  return {
    navs,
    quant: {
      alpha, beta, informationRatio, treynorRatio,
      var95, cvar95, monthlyWinRate, downsideCaptureRatio, cagr,
      hhi: 0, topHoldingsRatio: 0, // 由 holdings 填充
    },
  };
}

/** 运行回测分析 */
function runBacktest(navs: NavRecord[], monthlyAmount: number, drawdownThreshold: number): BacktestResult {
  const sip = sipBacktest(navs, monthlyAmount);
  const hpDist = holdingPeriodDistribution(navs);
  drawdownBuyBacktest(navs, drawdownThreshold);

  return {
    sipReturns: {
      totalInvested: sip.totalInvested,
      finalValue: sip.finalValue,
      totalReturn: sip.totalReturn,
      annualizedReturn: sip.annualizedReturn,
    },
    holdingPeriodDist: hpDist.map(hp => ({
      period: hp.label,
      positiveRatio: hp.positiveRatio,
      avgReturn: hp.avgReturn,
      medianReturn: hp.medianReturn,
      minReturn: hp.minReturn,
      maxReturn: hp.maxReturn,
    })),
  };
}

export function registerDetailCommand(program: Command): void {
  program
    .command('detail <code>')
    .description('详细量化分析报告')
    .action(async (code: string) => {
      try {
        console.log(chalk.gray(`正在生成 ${code} 的详细量化报告 ...`));

        console.log(chalk.gray('  抓取基础数据 ...'));
        const data = await fetchFundData(code);
        const score = scoreFund(data);
        const analysis: FundAnalysis = { data, score };

        const { quant, navs } = await runQuantAnalysis(code, data.basic.type);

        console.log(chalk.gray('  抓取持仓数据 ...'));
        let holdings;
        let holdingAnalysis;
        try {
          holdings = await fetchFundHoldings(code);
          if (holdings.topStocks.length > 0) {
            holdingAnalysis = analyzeHoldings(holdings);
            quant.hhi = holdingAnalysis.hhi;
            quant.topHoldingsRatio = holdingAnalysis.topHoldingsRatio;
          }
        } catch {
          console.log(chalk.yellow('  持仓数据获取失败，跳过'));
        }

        const backtest = runBacktest(navs, 1000, 20);
        const deepScore = scoreFundDeep(data, quant, holdings);

        formatDetailReport(analysis, quant, holdings, holdingAnalysis, backtest, deepScore);
      } catch (err) {
        handleError(err, code);
      }
    });
}

export function registerBacktestCommand(program: Command): void {
  program
    .command('backtest <code>')
    .description('回测分析')
    .option('--monthly-amount <number>', '定投金额', '1000')
    .option('--drawdown <number>', '回撤买入阈值%', '20')
    .action(async (code: string, opts: { monthlyAmount: string; drawdown: string }) => {
      try {
        const monthlyAmount = parseInt(opts.monthlyAmount) || 1000;
        const drawdownThreshold = parseInt(opts.drawdown) || 20;

        console.log(chalk.gray(`正在回测 ${code} ...`));
        console.log(chalk.gray(`  定投金额: ${monthlyAmount}元/月  回撤阈值: ${drawdownThreshold}%`));

        console.log(chalk.gray('  抓取基础数据 ...'));
        const data = await fetchFundData(code);

        console.log(chalk.gray('  抓取历史净值 ...'));
        const navs = await fetchHistoryNav(code);

        if (navs.length < 30) {
          console.log(chalk.red('历史净值数据不足，无法进行回测'));
          process.exitCode = 1;
          return;
        }

        console.log(chalk.gray(`  共 ${navs.length} 条净值记录，开始回测 ...`));

        const backtest = runBacktest(navs, monthlyAmount, drawdownThreshold);
        const drawdownResult = drawdownBuyBacktest(navs, drawdownThreshold);

        console.log('');
        console.log(chalk.cyan.bold(`═══ ${data.basic.name} (${code}) — 回测报告 ═══`));
        formatBacktestReport(backtest);

        if (drawdownResult.buyCount > 0) {
          console.log(chalk.cyan.bold('─── 回撤买入策略 ───'));
          console.log(chalk.gray(`  触发条件: 回撤 ≥${drawdownThreshold}%`));
          console.log(chalk.gray(`  买入次数: ${drawdownResult.buyCount}`));
          console.log(chalk.gray(`  平均买入回撤: ${drawdownResult.avgBuyDrawdown.toFixed(1)}%`));
          console.log(chalk.gray(`  总收益: ${drawdownResult.totalReturn >= 0 ? '+' : ''}${drawdownResult.totalReturn.toFixed(2)}%`));
          console.log(chalk.gray(`  年化收益: ${drawdownResult.annualizedReturn >= 0 ? '+' : ''}${drawdownResult.annualizedReturn.toFixed(2)}%`));
          console.log('');
        } else {
          console.log(chalk.yellow(`  回测期内未出现 ≥${drawdownThreshold}% 的回撤`));
          console.log('');
        }
      } catch (err) {
        handleError(err, code);
      }
    });
}

export function registerHoldingsCommand(program: Command): void {
  program
    .command('holdings <code>')
    .description('持仓分析')
    .action(async (code: string) => {
      try {
        console.log(chalk.gray(`正在获取 ${code} 的持仓数据 ...`));

        const data = await fetchFundData(code);
        const holdings = await fetchFundHoldings(code);

        if (holdings.topStocks.length === 0) {
          console.log(chalk.yellow(`${data.basic.name} 无重仓股数据（可能是债券/货币基金）`));
          return;
        }

        const holdingAnalysis = analyzeHoldings(holdings);

        console.log(chalk.cyan.bold(`═══ ${data.basic.name} (${code}) ═══`));
        formatHoldingsReport(holdings, holdingAnalysis);
      } catch (err) {
        handleError(err, code);
      }
    });
}
