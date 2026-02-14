import chalk from 'chalk';
import Table from 'cli-table3';
import type { FundAnalysis } from '../types/fund.js';
import { getScoreLevel } from '../scorers/fundScorer.js';

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
  console.log(chalk.gray(`类型: ${basic.type || '未知'}  成立日期: ${basic.establishDate || '未知'}`));
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
  console.log(chalk.gray(`  近1年收益 ${performance.returnYear1}%  近3年收益 ${performance.returnYear3}%  夏普比率 ${performance.sharpeRatio}`));
  console.log(chalk.gray(`  最大回撤 ${performance.maxDrawdown}%  波动率 ${performance.volatility}%  规模 ${meta.fundSize}亿`));
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

  const rows: [string, number | string, number | string][] = [
    ['近1年收益%', d1.performance.returnYear1, d2.performance.returnYear1],
    ['近3年收益%', d1.performance.returnYear3, d2.performance.returnYear3],
    ['夏普比率', d1.performance.sharpeRatio, d2.performance.sharpeRatio],
    ['最大回撤%', d1.performance.maxDrawdown, d2.performance.maxDrawdown],
    ['波动率%', d1.performance.volatility, d2.performance.volatility],
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
      chalk.white.bold('总分'),
      chalk.white.bold('评级'),
    ],
    colWidths: [6, 24, 10, 8, 16],
  });

  sorted.forEach((a, i) => {
    table.push([
      `${i + 1}`,
      a.data.basic.name,
      a.data.basic.code,
      colorScore(a.score.totalScore),
      getScoreLevel(a.score.totalScore),
    ]);
  });

  console.log(table.toString());
  console.log('');
}
