import type { Command } from 'commander';
import chalk from 'chalk';
import { fetchFundData } from '../../fetchers/index.js';
import { scoreFund, getScoreLevel } from '../../scorers/fundScorer.js';
import type { FundAnalysis } from '../../types/fund.js';

interface DailyReportFactItem {
  code: string;
  name: string;
  type: string;
  realtime: FundAnalysis['data']['realtime'];
  performance: {
    returnYear1: number;
    returnYear3: number;
    maxDrawdown: number;
    volatility: number;
    sharpeRatio: number;
  };
  score: {
    tierScore: number;
    marketScore: number;
    level: string;
  };
}

interface DailyReportFactPayload {
  generatedAt: string;
  failedCodes: string[];
  funds: DailyReportFactItem[];
}

function getGeneratedAt(items: DailyReportFactItem[]): string {
  const updateTimes = items.map(item => item.realtime?.updateTime).filter(Boolean) as string[];
  if (updateTimes.length === 0) {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16);
  }
  return updateTimes.sort().at(-1)!;
}

function toFactItem(analysis: FundAnalysis): DailyReportFactItem {
  const { data, score } = analysis;
  const risk = data.performance.riskByPeriod.year1 ?? data.performance.riskByPeriod.all;
  return {
    code: data.basic.code,
    name: data.basic.name,
    type: data.basic.type,
    realtime: data.realtime,
    performance: {
      returnYear1: data.performance.returnYear1,
      returnYear3: data.performance.returnYear3,
      maxDrawdown: risk.maxDrawdown,
      volatility: risk.volatility,
      sharpeRatio: risk.sharpeRatio,
    },
    score: {
      tierScore: score.tierScore,
      marketScore: score.marketScore,
      level: getScoreLevel(score.marketScore),
    },
  };
}

function formatTextFacts(payload: DailyReportFactPayload): string {
  const lines: string[] = [
    `基金客观数据快照 ${payload.generatedAt}`,
    '',
  ];

  for (const fund of payload.funds) {
    lines.push(`${fund.name}(${fund.code})`);
    lines.push(`- 类型: ${fund.type || '未知'}`);
    lines.push(`- 实时估值: ${fund.realtime?.estimatedNav ?? '--'}`);
    lines.push(`- 实时涨跌幅: ${fund.realtime?.changePercent ?? '--'}%`);
    lines.push(`- 估值时间: ${fund.realtime?.updateTime ?? '--'}`);
    lines.push(`- 近1年收益: ${fund.performance.returnYear1}%`);
    lines.push(`- 近3年收益: ${fund.performance.returnYear3}%`);
    lines.push(`- 最大回撤: ${fund.performance.maxDrawdown}%`);
    lines.push(`- 波动率: ${fund.performance.volatility}%`);
    lines.push(`- 夏普比率: ${fund.performance.sharpeRatio}`);
    lines.push(`- 同类评分: ${fund.score.tierScore}`);
    lines.push(`- 全市场评分: ${fund.score.marketScore}`);
    lines.push(`- 评分等级: ${fund.score.level}`);
    lines.push('');
  }

  if (payload.failedCodes.length > 0) {
    lines.push(`抓取失败: ${payload.failedCodes.join(', ')}`);
  }

  return lines.join('\n').trimEnd();
}

export function registerDailyReportCommand(program: Command): void {
  program
    .command('daily-report <codes>')
    .description('输出持仓基金的客观数据快照，供后续 AI 汇总日报')
    .option('--json', '输出 JSON 格式')
    .action(async (codesStr: string, opts: { json?: boolean }) => {
      const codes = codesStr.split(',').map(code => code.trim()).filter(Boolean);
      if (codes.length === 0) {
        console.log(chalk.red('请提供至少一个基金代码'));
        process.exitCode = 1;
        return;
      }

      const analyses: FundAnalysis[] = [];
      const failedCodes: string[] = [];

      for (const code of codes) {
        try {
          const data = await fetchFundData(code);
          const score = scoreFund(data);
          analyses.push({ data, score });
        } catch {
          failedCodes.push(code);
        }
      }

      if (analyses.length === 0) {
        console.log(chalk.red(`所有基金抓取失败: ${failedCodes.join(', ')}`));
        process.exitCode = 1;
        return;
      }

      const funds = analyses
        .map(toFactItem)
        .sort((a, b) => b.score.marketScore - a.score.marketScore);

      const payload: DailyReportFactPayload = {
        generatedAt: getGeneratedAt(funds),
        failedCodes,
        funds,
      };

      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(formatTextFacts(payload));
    });
}
