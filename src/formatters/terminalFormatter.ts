import chalk from 'chalk';
import Table from 'cli-table3';
import type { FundAnalysis, QuantMetrics, FundHoldings, BacktestResult, DeepFundScore, PeriodRiskBreakdown, PeriodRiskMetrics, FundPerformance } from '../types/fund.js';
import type { HoldingAnalysis } from '../analyzers/holdingAnalyzer.js';
import type { SIPResult, HoldingPeriodDist } from '../analyzers/backtester.js';
import { getScoreLevel, classifyFund } from '../scorers/fundScorer.js';

const CATEGORY_LABELS = { bond: '债券类', balanced: '平衡类', equity: '股票类' } as const;

function renderMorningstar(rating: number): string {
  if (rating <= 0) return '无评级';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function renderProgressBar(score: number, maxScore: number, width = 20): string {
  const ratio = Math.min(score / maxScore, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${score}/${maxScore}`;
}

function colorScore(score: number): string {
  if (score >= 70) return chalk.green.bold(`${score}`);
  if (score >= 55) return chalk.yellow.bold(`${score}`);
  return chalk.red.bold(`${score}`);
}

export function formatFundAnalysis(analysis: FundAnalysis): void {
  const { data, score } = analysis;
  const { basic, performance, meta } = data;

  // 基本信息
  console.log('');
  console.log(chalk.cyan.bold(`═══ ${basic.name} (${basic.code}) ═══`));
  const cat = classifyFund(basic.type);
  const catLabel = CATEGORY_LABELS[cat];
  const stars = renderMorningstar(meta.morningstarRating);
  console.log(chalk.gray(`类型: ${basic.type || '未知'} [${catLabel}]  成立日期: ${basic.establishDate || '未知'}  晨星: ${stars}`));
  console.log('');

  // 评分详情表格
  const table = new Table({
    head: [chalk.white.bold('评分项'), chalk.white.bold('得分'), chalk.white.bold('进度')],
    colWidths: [14, 10, 30],
  });

  for (const d of score.details) {
    table.push([d.item, `${d.score}/${d.maxScore}`, renderProgressBar(d.score, d.maxScore)]);
  }

  console.log(table.toString());

  // 总分和评级
  const level = getScoreLevel(score.totalScore);
  console.log('');
  console.log(`  收益能力: ${score.returnScore}/40  风险控制: ${score.riskScore}/30  综合评价: ${score.overallScore}/30`);
  console.log(`  总分: ${colorScore(score.totalScore)}/100  评级: ${level}`);

  // 关键指标摘要
  console.log('');
  console.log(chalk.gray('关键指标:'));
  console.log(chalk.gray(`  近1年收益 ${performance.returnYear1}%  近3年收益 ${performance.returnYear3}%  规模 ${meta.fundSize}亿`));

  // 分时段风险指标
  console.log('');
  console.log(chalk.cyan.bold('─── 风险指标（分时段）───'));
  formatRiskByPeriod(performance.riskByPeriod);

  // 买入建议
  console.log(chalk.cyan.bold('─── 买入建议 ───'));
  formatBuyAdvice(performance);
}

function fmtRiskVal(val: number, isPercent: boolean): string {
  return isPercent ? `${val.toFixed(2)}%` : val.toFixed(1);
}

function formatRiskByPeriod(rbp: PeriodRiskBreakdown): void {
  const headers = ['风险指标', '近1年', '近3年', '全历史'];
  const periodTable = new Table({
    head: headers.map(h => chalk.white.bold(h)),
    colWidths: [14, 12, 12, 12],
  });

  const rows: { label: string; key: keyof PeriodRiskMetrics; isPercent: boolean }[] = [
    { label: '最大回撤', key: 'maxDrawdown', isPercent: true },
    { label: '年化波动率', key: 'volatility', isPercent: true },
    { label: '夏普比率', key: 'sharpeRatio', isPercent: false },
    { label: '索提诺比率', key: 'sortinoRatio', isPercent: false },
  ];

  for (const { label, key, isPercent } of rows) {
    periodTable.push([
      label,
      rbp.year1 ? fmtRiskVal(rbp.year1[key], isPercent) : chalk.gray('—'),
      rbp.year3 ? fmtRiskVal(rbp.year3[key], isPercent) : chalk.gray('—'),
      fmtRiskVal(rbp.all[key], isPercent),
    ]);
  }

  console.log(periodTable.toString());
  console.log('');
}

function formatBuyAdvice(perf: FundPerformance): void {
  const rbp = perf.riskByPeriod;

  // 当前回撤位置（用全历史最大回撤作为参考）
  const currentDrawdown = rbp.year1?.maxDrawdown ?? rbp.all.maxDrawdown;
  const historyDrawdown = rbp.all.maxDrawdown;
  const drawdownRatio = historyDrawdown > 0 ? (currentDrawdown / historyDrawdown) * 100 : 0;

  console.log(chalk.gray(`  当前回撤: ${currentDrawdown.toFixed(2)}%  历史最大: ${historyDrawdown.toFixed(2)}%  (当前为历史的 ${drawdownRatio.toFixed(0)}%)`));

  // 近期趋势判断
  if (rbp.year1 && rbp.year3) {
    const volTrend = rbp.year1.volatility - rbp.year3.volatility;
    const ddTrend = rbp.year1.maxDrawdown - rbp.year3.maxDrawdown;
    const riskConverging = volTrend < 0 && ddTrend < 0;
    const riskExpanding = volTrend > 0 && ddTrend > 0;

    if (riskConverging) {
      console.log(chalk.green('  趋势: 近期风险收敛（近1年波动率和回撤均低于近3年）'));
    } else if (riskExpanding) {
      console.log(chalk.red('  趋势: 近期风险扩大（近1年波动率和回撤均高于近3年）'));
    } else {
      console.log(chalk.yellow('  趋势: 风险表现分化，需结合市场环境综合判断'));
    }
  }

  // 文字建议
  const advices: string[] = [];
  if (currentDrawdown < 5 && drawdownRatio < 30) {
    advices.push('近期风险可控，回撤处于低位');
  }
  if (historyDrawdown > 20) {
    advices.push(`注意：历史曾有 ${historyDrawdown.toFixed(1)}% 的较大回撤`);
  }
  if (rbp.year1 && rbp.year1.sharpeRatio > 1.5) {
    advices.push('近1年风险收益比优秀');
  }
  if (advices.length === 0) {
    advices.push('风险水平中等，建议分批买入');
  }

  for (const advice of advices) {
    console.log(chalk.gray(`  · ${advice}`));
  }
  console.log('');
}

export function formatCompareTable(analysis1: FundAnalysis, analysis2: FundAnalysis): void {
  const d1 = analysis1.data;
  const d2 = analysis2.data;
  const s1 = analysis1.score;
  const s2 = analysis2.score;

  console.log('');
  console.log(chalk.cyan.bold(`═══ 基金对比 ═══`));
  console.log('');

  const table = new Table({
    head: ['', chalk.white.bold(d1.basic.name), chalk.white.bold(d2.basic.name)],
    colWidths: [14, 24, 24],
  });

  // 优先显示近1年风险指标，不可用时用全历史
  const r1 = d1.performance.riskByPeriod.year1 ?? d1.performance.riskByPeriod.all;
  const r2 = d2.performance.riskByPeriod.year1 ?? d2.performance.riskByPeriod.all;

  const rows: [string, number | string, number | string][] = [
    ['近1年收益%', d1.performance.returnYear1, d2.performance.returnYear1],
    ['近3年收益%', d1.performance.returnYear3, d2.performance.returnYear3],
    ['夏普(近1年)', r1.sharpeRatio, r2.sharpeRatio],
    ['回撤(近1年)%', r1.maxDrawdown, r2.maxDrawdown],
    ['波动(近1年)%', r1.volatility, r2.volatility],
    ['夏普(全历史)', d1.performance.sharpeRatio, d2.performance.sharpeRatio],
    ['回撤(全历史)%', d1.performance.maxDrawdown, d2.performance.maxDrawdown],
    ['基金规模(亿)', d1.meta.fundSize, d2.meta.fundSize],
    ['经理年限', d1.meta.managerYears, d2.meta.managerYears],
    ['费率%', d1.meta.totalFeeRate, d2.meta.totalFeeRate],
    ['总分', s1.totalScore, s2.totalScore],
  ];

  for (const [label, v1, v2] of rows) {
    // 最大回撤和波动率、费率越低越好
    const lowerBetter = label.includes('回撤') || label.includes('波动') || label.includes('费率');
    const n1 = typeof v1 === 'number' ? v1 : 0;
    const n2 = typeof v2 === 'number' ? v2 : 0;
    const win1 = lowerBetter ? n1 < n2 : n1 > n2;
    const win2 = lowerBetter ? n2 < n1 : n2 > n1;
    table.push([
      label,
      win1 ? chalk.green(`${v1}`) : `${v1}`,
      win2 ? chalk.green(`${v2}`) : `${v2}`,
    ]);
  }

  console.log(table.toString());

  // 评级对比
  console.log('');
  console.log(`  ${d1.basic.name}: ${colorScore(s1.totalScore)}/100 ${getScoreLevel(s1.totalScore)}`);
  console.log(`  ${d2.basic.name}: ${colorScore(s2.totalScore)}/100 ${getScoreLevel(s2.totalScore)}`);
  console.log('');
}

export function formatBatchSummary(analyses: FundAnalysis[]): void {
  const sorted = [...analyses].sort((a, b) => b.score.totalScore - a.score.totalScore);

  console.log('');
  console.log(chalk.cyan.bold(`═══ 批量分析结果（共 ${sorted.length} 只）═══`));
  console.log('');

  const table = new Table({
    head: [
      chalk.white.bold('排名'),
      chalk.white.bold('基金名称'),
      chalk.white.bold('代码'),
      chalk.white.bold('类型'),
      chalk.white.bold('总分'),
      chalk.white.bold('评级'),
    ],
    colWidths: [6, 24, 10, 8, 8, 16],
  });

  sorted.forEach((a, i) => {
    const cat = classifyFund(a.data.basic.type);
    table.push([
      `${i + 1}`,
      a.data.basic.name,
      a.data.basic.code,
      CATEGORY_LABELS[cat],
      colorScore(a.score.totalScore),
      getScoreLevel(a.score.totalScore),
    ]);
  });

  console.log(table.toString());
  console.log('');
}

// ====== 深度分析报告 ======

function fmtPct(n: number, decimals = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

function fmtNum(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function colorPct(n: number): string {
  const s = fmtPct(n);
  return n >= 0 ? chalk.green(s) : chalk.red(s);
}

function colorMetric(value: number, good: number, bad: number, higherBetter = true): string {
  const s = fmtNum(value);
  if (higherBetter) {
    if (value >= good) return chalk.green(s);
    if (value <= bad) return chalk.red(s);
  } else {
    if (value <= good) return chalk.green(s);
    if (value >= bad) return chalk.red(s);
  }
  return chalk.yellow(s);
}

/** 详细量化报告 — 分区域展示 */
export function formatDetailReport(
  analysis: FundAnalysis,
  quant: QuantMetrics,
  holdings: FundHoldings | undefined,
  holdingAnalysis: HoldingAnalysis | undefined,
  backtest: BacktestResult | undefined,
  deepScore: DeepFundScore
): void {
  const { data } = analysis;
  const { basic, performance: p, meta } = data;
  const cat = classifyFund(basic.type);

  // ── 基本信息 ──
  console.log('');
  console.log(chalk.cyan.bold(`╔═══════════════════════════════════════════════════════╗`));
  console.log(chalk.cyan.bold(`║  ${basic.name} (${basic.code}) — 深度量化报告`));
  console.log(chalk.cyan.bold(`╚═══════════════════════════════════════════════════════╝`));
  console.log(chalk.gray(`  类型: ${basic.type || '未知'} [${CATEGORY_LABELS[cat]}]  成立: ${basic.establishDate || '未知'}  晨星: ${renderMorningstar(meta.morningstarRating)}`));
  console.log(chalk.gray(`  规模: ${meta.fundSize}亿  经理年限: ${meta.managerYears}年  费率: ${meta.totalFeeRate}%`));
  console.log('');

  // ── 收益分析 ──
  console.log(chalk.cyan.bold('─── 收益分析 ───'));
  const retTable = new Table({
    head: ['指标', '数值'].map(h => chalk.white.bold(h)),
    colWidths: [20, 18],
  });
  retTable.push(
    ['近1年收益', colorPct(p.returnYear1)],
    ['近3年收益', colorPct(p.returnYear3)],
    ['Alpha(年化)', colorPct(quant.alpha * 100)],
    ['CAGR(年化)', colorPct(quant.cagr * 100)],
    ['月度胜率', `${(quant.monthlyWinRate * 100).toFixed(1)}%`],
  );
  console.log(retTable.toString());

  // ── 风险分析 ──
  console.log(chalk.cyan.bold('─── 风险分析 ───'));
  const riskTable = new Table({
    head: ['指标', '数值'].map(h => chalk.white.bold(h)),
    colWidths: [20, 18],
  });
  riskTable.push(
    ['夏普比率', colorMetric(p.sharpeRatio, 1.5, 0.5)],
    ['最大回撤', chalk.red(fmtPct(-p.maxDrawdown))],
    ['波动率(年化)', `${p.volatility}%`],
    ['Beta', colorMetric(quant.beta, 0.9, 1.2, false)],
    ['VaR(95%日)', `${(quant.var95 * 100).toFixed(2)}%`],
    ['CVaR(95%日)', `${(quant.cvar95 * 100).toFixed(2)}%`],
    ['信息比率IR', colorMetric(quant.informationRatio, 0.7, 0)],
    ['Treynor比率', fmtNum(quant.treynorRatio)],
    ['下行捕获比', fmtNum(quant.downsideCaptureRatio)],
  );
  console.log(riskTable.toString());

  // 分时段风险指标
  console.log(chalk.cyan.bold('─── 风险指标（分时段）───'));
  formatRiskByPeriod(p.riskByPeriod);

  // ── 持仓分析 ──
  if (holdings && holdingAnalysis) {
    console.log(chalk.cyan.bold('─── 持仓分析 ───'));
    console.log(chalk.gray(`  报告期: ${holdings.reportDate}  集中度: ${holdingAnalysis.concentrationLevel}`));

    if (holdings.topStocks.length > 0) {
      const holdTable = new Table({
        head: ['序号', '股票名称', '代码', '占比%'].map(h => chalk.white.bold(h)),
        colWidths: [6, 16, 10, 10],
      });
      holdings.topStocks.forEach((s, i) => {
        holdTable.push([`${i + 1}`, s.name, s.code, fmtNum(s.percent)]);
      });
      console.log(holdTable.toString());
    }

    const hhiDisplay = holdingAnalysis.hhi < 0 ? 'N/A' : fmtNum(holdingAnalysis.hhi, 4);
    console.log(chalk.gray(`  前10大重仓占比: ${fmtNum(holdingAnalysis.topHoldingsRatio)}%  HHI: ${hhiDisplay}`));
    console.log('');
  }

  // ── 回测结果 ──
  if (backtest) {
    formatBacktestReport(backtest);
  }

  // ── 综合评分 ──
  console.log(chalk.cyan.bold('─── 综合评分 ───'));
  const scoreTable = new Table({
    head: ['评分项', '得分', '进度'].map(h => chalk.white.bold(h)),
    colWidths: [16, 10, 30],
  });
  for (const d of deepScore.details) {
    scoreTable.push([d.item, `${d.score}/${d.maxScore}`, renderProgressBar(d.score, d.maxScore)]);
  }
  console.log(scoreTable.toString());

  const level = getScoreLevel(deepScore.totalScore);
  console.log('');
  console.log(`  收益: ${deepScore.returnScore}/30  风险: ${deepScore.riskScore}/30  持仓: ${deepScore.holdingScore}/15  稳定: ${deepScore.stabilityScore}/10  综合: ${deepScore.overallScore}/15`);
  console.log(`  总分: ${colorScore(deepScore.totalScore)}/100  评级: ${level}`);
  console.log('');
}

/** 回测报告 */
export function formatBacktestReport(backtest: BacktestResult): void {
  console.log(chalk.cyan.bold('─── 回测结果 ───'));

  // 定投回测
  const sip = backtest.sipReturns;
  console.log(chalk.gray(`  定投回测: 总投入 ${sip.totalInvested.toFixed(0)}元  终值 ${sip.finalValue.toFixed(0)}元`));
  console.log(chalk.gray(`  总收益 ${colorPct(sip.totalReturn)}  年化 ${colorPct(sip.annualizedReturn)}`));

  // 持有期分布
  if (backtest.holdingPeriodDist.length > 0) {
    const hpTable = new Table({
      head: ['持有期', '正收益率', '平均收益', '中位数', '最小', '最大'].map(h => chalk.white.bold(h)),
      colWidths: [10, 12, 12, 12, 12, 12],
    });
    for (const hp of backtest.holdingPeriodDist) {
      hpTable.push([
        hp.period,
        `${(hp.positiveRatio * 100).toFixed(0)}%`,
        fmtPct(hp.avgReturn),
        fmtPct(hp.medianReturn),
        fmtPct(hp.minReturn),
        fmtPct(hp.maxReturn),
      ]);
    }
    console.log(hpTable.toString());
  }
  console.log('');
}

/** 持仓报告 */
export function formatHoldingsReport(
  holdings: FundHoldings,
  holdingAnalysis: HoldingAnalysis
): void {
  console.log('');
  console.log(chalk.cyan.bold(`─── 持仓分析报告 ───`));
  console.log(chalk.gray(`  报告期: ${holdings.reportDate}  集中度: ${holdingAnalysis.concentrationLevel}`));
  console.log('');

  // 重仓股表
  if (holdings.topStocks.length > 0) {
    const table = new Table({
      head: ['序号', '股票名称', '代码', '占净值比%'].map(h => chalk.white.bold(h)),
      colWidths: [6, 18, 12, 12],
    });
    holdings.topStocks.forEach((s, i) => {
      table.push([`${i + 1}`, s.name, s.code, fmtNum(s.percent)]);
    });
    console.log(table.toString());
  }

  // 行业分布
  if (holdings.industries.length > 0) {
    console.log('');
    console.log(chalk.gray('  行业分布:'));
    const indTable = new Table({
      head: ['行业', '占比%'].map(h => chalk.white.bold(h)),
      colWidths: [24, 12],
    });
    for (const ind of holdings.industries) {
      indTable.push([ind.industry, fmtNum(ind.percent)]);
    }
    console.log(indTable.toString());
  }

  console.log('');
  console.log(chalk.gray(`  前10大重仓占比: ${fmtNum(holdingAnalysis.topHoldingsRatio)}%`));
  const hhiStr = holdingAnalysis.hhi < 0 ? 'N/A (无行业数据)' : `${fmtNum(holdingAnalysis.hhi, 4)}  (0=完全分散, 1=完全集中)`;
  console.log(chalk.gray(`  行业HHI指数: ${hhiStr}`));
  console.log('');
}
