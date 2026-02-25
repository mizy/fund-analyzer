/** @entry indexFormatter - 指数时机分析终端格式化输出 */
import chalk from 'chalk';
import type { IndexTimingResult, TimingRating } from '../types/indexFund.js';

const RATING_LABELS: Record<TimingRating, string> = {
  buy: '买入',
  hold: '持有',
  sell: '卖出',
};

function colorRating(rating: TimingRating): string {
  const label = RATING_LABELS[rating];
  if (rating === 'buy') return chalk.green.bold(label);
  if (rating === 'sell') return chalk.red.bold(label);
  return chalk.yellow.bold(label);
}

function colorScore(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.7) return chalk.green.bold(`${score}`);
  if (ratio >= 0.4) return chalk.yellow.bold(`${score}`);
  return chalk.red.bold(`${score}`);
}

function renderBar(score: number, max: number, width = 20): string {
  const ratio = Math.min(score / max, 1);
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function formatIndexTiming(result: IndexTimingResult): void {
  const { valuation: v, technical: t } = result;

  console.log('');
  console.log(chalk.cyan.bold(`═══ ${result.indexName} (${result.indexCode}) 时机分析 ═══`));
  console.log(chalk.gray(`  估值日期: ${v.date}`));
  console.log('');

  // 估值信号区块
  console.log(chalk.cyan.bold('─── 估值信号 ───'));
  console.log(`  PE: ${v.pe.toFixed(2)}  分位: ${v.pePercentile.toFixed(1)}%`);
  console.log(`  PB: ${v.pb.toFixed(2)}  分位: ${v.pbPercentile.toFixed(1)}%`);
  const valDetails = result.details.filter(d => d.name.includes('PE') || d.name.includes('PB'));
  for (const d of valDetails) {
    console.log(chalk.gray(`  ${d.name}: ${renderBar(d.score, d.maxScore)} ${d.score}/${d.maxScore}  ${d.reason}`));
  }
  console.log(`  估值得分: ${colorScore(result.valuationScore, 50)}/50`);
  console.log('');

  // 技术面信号区块
  console.log(chalk.cyan.bold('─── 技术面信号 ───'));
  console.log(`  MA5: ${t.ma5}  MA20: ${t.ma20}  MA60: ${t.ma60}`);
  console.log(`  RSI(14): ${t.rsi}  方向: ${t.direction === 'bullish' ? chalk.green('多头') : t.direction === 'bearish' ? chalk.red('空头') : chalk.yellow('中性')}`);
  const techDetails = result.details.filter(d => d.name.includes('趋势') || d.name.includes('RSI'));
  for (const d of techDetails) {
    console.log(chalk.gray(`  ${d.name}: ${renderBar(d.score, d.maxScore)} ${d.score}/${d.maxScore}  ${d.reason}`));
  }
  console.log(`  技术面得分: ${colorScore(result.technicalScore, 50)}/50`);
  console.log('');

  // 综合评级
  console.log(chalk.cyan.bold('─── 综合评级 ───'));
  console.log(`  综合得分: ${colorScore(result.totalScore, 100)}/100  评级: ${colorRating(result.rating)}`);
  console.log('');
}
