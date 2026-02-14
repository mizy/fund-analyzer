#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchFundData, fetchHistoryNav, fetchBenchmarkData, fetchFundHoldings } from '../fetchers/ttjjFetcher.js';
import { scoreFund, scoreFundDeep, classifyFund } from '../scorers/fundScorer.js';
import {
  formatFundAnalysis, formatCompareTable, formatBatchSummary,
  formatDetailReport, formatBacktestReport, formatHoldingsReport,
} from '../formatters/terminalFormatter.js';
import { sendLarkNotification, getLarkWebhookUrl } from '../notifiers/sendLarkNotification.js';
import { formatLarkFundAnalysis, formatLarkBatchSummary } from '../notifiers/larkFormatter.js';
import {
  calcAlphaBeta, calcInformationRatio, calcTreynorRatio,
  calcVaR, calcCVaR, calcDownsideCaptureRatio,
  calcCAGR, calcWinRate,
  analyzeHoldings,
  sipBacktest, holdingPeriodDistribution, drawdownBuyBacktest,
} from '../analyzers/index.js';
import type { FundAnalysis, QuantMetrics, BacktestResult } from '../types/fund.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string };

const program = new Command();

program
  .name('fund-analyzer')
  .description('基金分析工具 - 评分、对比、批量分析')
  .version(pkg.version);

program
  .command('analyze <code>')
  .description('分析单只基金')
  .option('--json', '输出 JSON 格式')
  .option('--lark [url]', '发送结果到飞书（可指定 Webhook URL，默认读取 LARK_WEBHOOK_URL 环境变量）')
  .action(async (code: string, opts: { json?: boolean; lark?: string | true }) => {
    try {
      console.log(chalk.gray(`正在分析基金 ${code} ...`));
      const data = await fetchFundData(code);
      const score = scoreFund(data);
      const analysis: FundAnalysis = { data, score };

      if (opts.json) {
        console.log(JSON.stringify(analysis, null, 2));
      } else {
        formatFundAnalysis(analysis);
      }

      if (opts.lark !== undefined) {
        await sendToLark(opts.lark, formatLarkFundAnalysis(analysis));
      }
    } catch (err) {
      handleError(err, code);
    }
  });

program
  .command('batch <codes>')
  .description('批量分析（逗号分隔，如 110011,000001,519694）')
  .option('--sort <field>', '排序字段 (score|return|risk)', 'score')
  .option('--json', '输出 JSON 格式')
  .option('--lark [url]', '发送结果到飞书')
  .action(async (codesStr: string, opts: { sort: string; json?: boolean; lark?: string | true }) => {
    const codes = codesStr.split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length === 0) {
      console.log(chalk.red('请提供至少一个基金代码'));
      return;
    }

    console.log(chalk.gray(`正在分析 ${codes.length} 只基金 ...`));

    const results: FundAnalysis[] = [];
    const errors: string[] = [];

    await Promise.all(
      codes.map(async (code) => {
        try {
          const data = await fetchFundData(code);
          const score = scoreFund(data);
          results.push({ data, score });
          console.log(chalk.gray(`  ✓ ${code} ${data.basic.name}`));
        } catch {
          errors.push(code);
          console.log(chalk.red(`  ✗ ${code} 获取失败`));
        }
      })
    );

    if (errors.length > 0) {
      console.log(chalk.yellow(`\n${errors.length} 只基金获取失败: ${errors.join(', ')}`));
    }

    if (results.length === 0) return;

    // 排序
    if (opts.sort === 'return') {
      results.sort((a, b) => b.score.returnScore - a.score.returnScore);
    } else if (opts.sort === 'risk') {
      results.sort((a, b) => b.score.riskScore - a.score.riskScore);
    }
    // score 排序在 formatBatchSummary 内部处理

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      formatBatchSummary(results);
    }

    if (opts.lark !== undefined) {
      await sendToLark(opts.lark, formatLarkBatchSummary(results));
    }
  });

program
  .command('compare <code1> <code2>')
  .description('对比两只基金')
  .action(async (code1: string, code2: string) => {
    try {
      console.log(chalk.gray(`正在获取 ${code1} 和 ${code2} 的数据 ...`));
      const [data1, data2] = await Promise.all([
        fetchFundData(code1),
        fetchFundData(code2),
      ]);
      const analysis1: FundAnalysis = { data: data1, score: scoreFund(data1) };
      const analysis2: FundAnalysis = { data: data2, score: scoreFund(data2) };
      formatCompareTable(analysis1, analysis2);
    } catch (err) {
      handleError(err, `${code1}/${code2}`);
    }
  });

program
  .command('notify-test')
  .description('测试飞书通知联通性')
  .option('--url <url>', '指定 Webhook URL（默认读取 LARK_WEBHOOK_URL 环境变量）')
  .action(async (opts: { url?: string }) => {
    const webhookUrl = getLarkWebhookUrl(opts.url);
    if (!webhookUrl) {
      console.log(chalk.red('未配置飞书 Webhook URL'));
      console.log(chalk.gray('请设置环境变量 LARK_WEBHOOK_URL 或使用 --url 参数'));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.gray('正在发送测试消息到飞书 ...'));
    const result = await sendLarkNotification(webhookUrl, {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: '🔔 fund-analyzer 通知测试' },
          template: 'blue',
        },
        elements: [
          {
            tag: 'div',
            text: { tag: 'lark_md', content: `飞书通知已联通！\n\n**时间:** ${new Date().toLocaleString('zh-CN')}` },
          },
          {
            tag: 'note',
            elements: [{ tag: 'plain_text', content: 'fund-analyzer notify-test' }],
          },
        ],
      },
    });

    if (result.success) {
      console.log(chalk.green('✓ 飞书通知发送成功！'));
    } else {
      console.log(chalk.red(`✗ 飞书通知发送失败: ${result.error}`));
      process.exitCode = 1;
    }
  });

// ====== 深度分析辅助 ======

/** 根据基金类型选择基准指数 */
function getBenchmarkCode(fundType: string): string {
  if (/债券|纯债|短债|中短债|长债|偏债/.test(fundType)) return '000012'; // 国债指数
  return '000300'; // 沪深300
}

/** 运行量化分析，返回 QuantMetrics */
async function runQuantAnalysis(code: string, fundType: string): Promise<{ quant: QuantMetrics; navs: import('../types/fund.js').NavRecord[] }> {
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
function runBacktest(
  navs: import('../types/fund.js').NavRecord[],
  monthlyAmount: number,
  drawdownThreshold: number,
): BacktestResult {
  const sip = sipBacktest(navs, monthlyAmount);
  const hpDist = holdingPeriodDistribution(navs);
  drawdownBuyBacktest(navs, drawdownThreshold); // 计算但暂不展示

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

// ====== 新命令：detail ======

program
  .command('detail <code>')
  .description('详细量化分析报告')
  .action(async (code: string) => {
    try {
      console.log(chalk.gray(`正在生成 ${code} 的详细量化报告 ...`));

      // 基础数据
      console.log(chalk.gray('  抓取基础数据 ...'));
      const data = await fetchFundData(code);
      const score = scoreFund(data);
      const analysis: FundAnalysis = { data, score };

      // 量化分析
      const { quant, navs } = await runQuantAnalysis(code, data.basic.type);

      // 持仓数据
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

      // 回测
      const backtest = runBacktest(navs, 1000, 20);

      // 深度评分
      const deepScore = scoreFundDeep(data, quant, holdings);

      // 输出
      formatDetailReport(analysis, quant, holdings, holdingAnalysis, backtest, deepScore);
    } catch (err) {
      handleError(err, code);
    }
  });

// ====== 新命令：backtest ======

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

      // 回撤买入策略
      const drawdownResult = drawdownBuyBacktest(navs, drawdownThreshold);

      console.log('');
      console.log(chalk.cyan.bold(`═══ ${data.basic.name} (${code}) — 回测报告 ═══`));
      formatBacktestReport(backtest);

      // 回撤买入策略结果
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

// ====== 新命令：holdings ======

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

async function sendToLark(larkOpt: string | true, message: ReturnType<typeof formatLarkFundAnalysis>): Promise<void> {
  const url = getLarkWebhookUrl(typeof larkOpt === 'string' ? larkOpt : undefined);
  if (!url) {
    console.log(chalk.yellow('未配置飞书 Webhook URL，跳过通知'));
    return;
  }
  console.log(chalk.gray('正在发送飞书通知 ...'));
  const result = await sendLarkNotification(url, message);
  if (result.success) {
    console.log(chalk.green('✓ 飞书通知已发送'));
  } else {
    console.log(chalk.red(`✗ 飞书通知失败: ${result.error}`));
  }
}

function handleError(err: unknown, code: string): void {
  if (err instanceof Error) {
    if (err.message.includes('timeout') || err.message.includes('ECONNREFUSED')) {
      console.log(chalk.red(`网络请求超时，请检查网络连接后重试`));
    } else if (err.message.includes('404') || err.message.includes('Request failed')) {
      console.log(chalk.red(`基金代码 ${code} 无效或未找到`));
    } else {
      console.log(chalk.red(`错误: ${err.message}`));
    }
  } else {
    console.log(chalk.red(`未知错误`));
  }
  process.exitCode = 1;
}

program.parse();
