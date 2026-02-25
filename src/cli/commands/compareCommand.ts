import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { fetchFundData } from '../../fetchers/index.js';
import { scoreFund, getScoreLevel } from '../../scorers/fundScorer.js';
import { handleError } from '../handleError.js';
import type { FundAnalysis } from '../../types/fund.js';
import { TIER_LABELS, colorScore } from '../../formatters/terminalFormatter.js';

/** 对比多只基金（支持 2 只及以上） */
function formatMultiCompare(analyses: FundAnalysis[]): void {
  console.log('');
  console.log(chalk.cyan.bold(`═══ 基金对比（${analyses.length} 只）═══`));
  console.log('');

  const headers = ['', ...analyses.map(a => chalk.white.bold(a.data.basic.name))];
  const colWidths = [14, ...analyses.map(() => 22)];
  const table = new Table({ head: headers, colWidths });

  // 每只基金的近1年风险指标
  const risks = analyses.map(a =>
    a.data.performance.riskByPeriod.year1 ?? a.data.performance.riskByPeriod.all
  );

  type Row = { label: string; values: number[]; lowerBetter: boolean };
  const rows: Row[] = [
    { label: '近1年收益%', values: analyses.map(a => a.data.performance.returnYear1), lowerBetter: false },
    { label: '近3年收益%', values: analyses.map(a => a.data.performance.returnYear3), lowerBetter: false },
    { label: '夏普(近1年)', values: risks.map(r => r.sharpeRatio), lowerBetter: false },
    { label: '回撤(近1年)%', values: risks.map(r => r.maxDrawdown), lowerBetter: true },
    { label: '卡玛(近1年)', values: risks.map(r => r.calmarRatio), lowerBetter: false },
    { label: '波动(近1年)%', values: risks.map(r => r.volatility), lowerBetter: true },
    { label: '夏普(全历史)', values: analyses.map(a => a.data.performance.sharpeRatio), lowerBetter: false },
    { label: '回撤(全历史)%', values: analyses.map(a => a.data.performance.maxDrawdown), lowerBetter: true },
    { label: '基金规模(亿)', values: analyses.map(a => a.data.meta.fundSize), lowerBetter: false },
    { label: '经理年限', values: analyses.map(a => a.data.meta.managerYears), lowerBetter: false },
    { label: '费率%', values: analyses.map(a => a.data.meta.totalFeeRate), lowerBetter: true },
    { label: '全市场评分', values: analyses.map(a => a.score.totalScore), lowerBetter: false },
    { label: '同类评分', values: analyses.map(a => a.score.tierScore), lowerBetter: false },
  ];

  for (const row of rows) {
    const best = row.lowerBetter
      ? Math.min(...row.values)
      : Math.max(...row.values);

    const cells = row.values.map(v => {
      const isBest = v === best && row.values.filter(x => x === best).length < row.values.length;
      return isBest ? chalk.green(`${v}`) : `${v}`;
    });

    table.push([row.label, ...cells]);
  }

  console.log(table.toString());

  // 评级对比
  console.log('');
  for (const a of analyses) {
    console.log(`  ${a.data.basic.name}: ${colorScore(a.score.totalScore)}/100 ${getScoreLevel(a.score.totalScore)}  同类: ${colorScore(a.score.tierScore)} [${TIER_LABELS[a.score.riskTier]}]`);
  }

  // 跨层级对比提示
  const tiers = new Set(analyses.map(a => a.score.riskTier));
  if (tiers.size > 1) {
    console.log('');
    console.log(chalk.yellow('  ⚠ 跨层级对比仅供参考，建议重点关注同类评分'));
  }
  console.log('');
}

export function registerCompareCommand(program: Command): void {
  program
    .command('compare <codes...>')
    .description('对比基金（支持 2 只及以上，如 compare 110011 000001 519694）')
    .action(async (codes: string[]) => {
      if (codes.length < 2) {
        console.log(chalk.red('请提供至少 2 个基金代码'));
        return;
      }

      try {
        console.log(chalk.gray(`正在获取 ${codes.join(', ')} 的数据 ...`));
        const dataList = await Promise.all(codes.map(c => fetchFundData(c)));
        const analyses: FundAnalysis[] = dataList.map(data => ({
          data,
          score: scoreFund(data),
        }));
        formatMultiCompare(analyses);
      } catch (err) {
        handleError(err, codes.join('/'));
      }
    });
}
