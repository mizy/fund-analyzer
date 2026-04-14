import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { FundCategory, FundAnalysis } from '../../types/fund.js';
import { fetchFundRanking } from '../../fetchers/fetchFundRanking.js';
import { fetchFundData } from '../../fetchers/index.js';
import { scoreFund, classifyFund, getScoreLevel } from '../../scorers/fundScorer.js';
import { colorScore } from '../../formatters/terminalFormatter.js';
import { sendToLark } from '../handleError.js';
import type { LarkMessage } from '../../notifiers/sendLarkNotification.js';

const CATEGORY_LABELS: Record<FundCategory, string> = {
  bond: '债券型',
  balanced: '混合型',
  equity: '股票型',
};

const ALL_CATEGORIES: FundCategory[] = ['bond', 'balanced', 'equity'];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAndScoreRanking(
  type: FundCategory,
  limit: number,
): Promise<{ results: FundAnalysis[]; errors: string[] }> {
  console.log(chalk.cyan.bold(`\n═══ ${CATEGORY_LABELS[type]}排行榜 ═══`));
  console.log(chalk.gray(`正在获取 ${CATEGORY_LABELS[type]} Top ${limit} ...`));

  const ranking = await fetchFundRanking(type, limit);
  if (ranking.length === 0) {
    console.log(chalk.yellow('未获取到排行数据'));
    return { results: [], errors: [] };
  }

  console.log(chalk.gray(`获取到 ${ranking.length} 只基金，开始评分 ...`));

  const results: FundAnalysis[] = [];
  const errors: string[] = [];

  for (let i = 0; i < ranking.length; i++) {
    const { code, name } = ranking[i];
    try {
      const data = await fetchFundData(code);
      const score = scoreFund(data);
      results.push({ data, score });
      console.log(chalk.gray(`  [${i + 1}/${ranking.length}] ✓ ${code} ${name}`));
    } catch {
      errors.push(code);
      console.log(chalk.red(`  [${i + 1}/${ranking.length}] ✗ ${code} ${name} 获取失败`));
    }

    if (i < ranking.length - 1) {
      await sleep(100 + Math.random() * 100);
    }
  }

  results.sort((a, b) => b.score.totalScore - a.score.totalScore);

  return { results, errors };
}

function formatLeaderboardTable(results: FundAnalysis[], type: FundCategory): void {
  if (results.length === 0) return;

  const table = new Table({
    head: [
      chalk.white.bold('#'),
      chalk.white.bold('基金名称'),
      chalk.white.bold('代码'),
      chalk.white.bold('近1年%'),
      chalk.white.bold('同类分'),
      chalk.white.bold('全市场'),
      chalk.white.bold('评级'),
    ],
    colWidths: [5, 24, 10, 10, 8, 8, 12],
  });

  results.forEach((a, i) => {
    table.push([
      `${i + 1}`,
      a.data.basic.name,
      a.data.basic.code,
      a.data.performance.returnYear1 != null ? `${a.data.performance.returnYear1.toFixed(2)}` : '-',
      colorScore(a.score.tierScore),
      colorScore(a.score.totalScore),
      getScoreLevel(a.score.totalScore),
    ]);
  });

  console.log(table.toString());
}

function scoreEmoji(score: number): string {
  if (score >= 70) return '🟢';
  if (score >= 55) return '🟡';
  return '🔴';
}

function formatLarkLeaderboard(allResults: { type: FundCategory; results: FundAnalysis[] }[]): LarkMessage {
  const sections = allResults
    .filter(s => s.results.length > 0)
    .map(({ type, results }) => {
      const rows = results
        .map((a, i) =>
          `${i + 1}. ${scoreEmoji(a.score.totalScore)} **${a.data.basic.name}** (${a.data.basic.code}) — 近1年 ${a.data.performance.returnYear1}% | **${a.score.totalScore}分** ${getScoreLevel(a.score.totalScore)}`,
        )
        .join('\n');
      return `**${CATEGORY_LABELS[type]}排行榜**\n${rows}`;
    })
    .join('\n\n---\n\n');

  const totalCount = allResults.reduce((sum, s) => sum + s.results.length, 0);

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: `📊 基金排行榜（共 ${totalCount} 只）` },
        template: 'blue',
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: sections } },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `fund-analyzer · ${new Date().toLocaleString('zh-CN')}` }],
        },
      ],
    },
  };
}

async function fetchAndScoreCustomCodes(
  codes: string[],
): Promise<{ allResults: { type: FundCategory; results: FundAnalysis[] }[]; totalErrors: string[] }> {
  console.log(chalk.gray(`正在分析 ${codes.length} 只自选基金 ...`));

  const results: FundAnalysis[] = [];
  const errors: string[] = [];

  await Promise.all(
    codes.map(async (code) => {
      try {
        const data = await fetchFundData(code);
        const score = scoreFund(data);
        results.push({ data, score });
      } catch {
        errors.push(code);
        console.log(chalk.red(`  ✗ ${code} 获取失败`));
      }
    }),
  );

  // Group by category
  const grouped = new Map<FundCategory, FundAnalysis[]>();
  for (const cat of ALL_CATEGORIES) grouped.set(cat, []);

  for (const item of results) {
    const cat = classifyFund(item.data.basic.type ?? '');
    grouped.get(cat)!.push(item);
  }

  const allResults: { type: FundCategory; results: FundAnalysis[] }[] = ALL_CATEGORIES.map((cat) => ({
    type: cat,
    results: (grouped.get(cat) ?? []).sort((a, b) => b.score.totalScore - a.score.totalScore),
  }));

  return { allResults, totalErrors: errors };
}

export function registerLeaderboardCommand(program: Command): void {
  program
    .command('leaderboard [type]')
    .description('基金排行榜 (bond/balanced/equity/all)，--codes 指定自选基金代码')
    .option('--codes <codes>', '自选基金代码（逗号分隔），不从天天基金拉排行')
    .option('--limit <n>', '每类获取数量（无 --codes 时生效）', '20')
    .option('--json', '输出 JSON 格式')
    .option('--lark [url]', '发送结果到飞书')
    .action(async (type: string = 'all', opts: { codes?: string; limit: string; json?: boolean; lark?: string | true }) => {
      if (!['bond', 'balanced', 'equity', 'all'].includes(type)) {
        console.log(chalk.red('类型必须是 bond/balanced/equity/all'));
        process.exitCode = 1;
        return;
      }

      let allResults: { type: FundCategory; results: FundAnalysis[] }[] = [];

      if (opts.codes) {
        // Custom codes mode: group by auto-detected category
        const codes = opts.codes.split(',').map(c => c.trim()).filter(Boolean);
        if (codes.length === 0) {
          console.log(chalk.red('--codes 不能为空'));
          process.exitCode = 1;
          return;
        }

        const { allResults: grouped, totalErrors } = await fetchAndScoreCustomCodes(codes);
        allResults = grouped;

        if (totalErrors.length > 0) {
          console.log(chalk.yellow(`${totalErrors.length} 只基金获取失败: ${totalErrors.join(', ')}`));
        }

        // Filter by type if not 'all'
        const targetCategories: FundCategory[] = type === 'all' ? ALL_CATEGORIES : [type as FundCategory];
        if (!opts.json) {
          for (const cat of targetCategories) {
            const section = allResults.find(r => r.type === cat);
            if (section && section.results.length > 0) {
              console.log(chalk.cyan.bold(`\n═══ ${CATEGORY_LABELS[cat]}排行榜 ═══`));
              formatLeaderboardTable(section.results, cat);
            }
          }
        }

        allResults = allResults.filter(r => targetCategories.includes(r.type));
      } else {
        // Original mode: fetch ranking from 天天基金
        const limit = Math.min(parseInt(opts.limit, 10) || 20, 100);
        const categories: FundCategory[] = type === 'all' ? ALL_CATEGORIES : [type as FundCategory];

        for (const cat of categories) {
          try {
            const { results, errors } = await fetchAndScoreRanking(cat, limit);
            allResults.push({ type: cat, results });

            if (errors.length > 0) {
              console.log(chalk.yellow(`${errors.length} 只基金获取失败: ${errors.join(', ')}`));
            }

            if (!opts.json) {
              formatLeaderboardTable(results, cat);
            }
          } catch (err) {
            console.log(chalk.red(`${CATEGORY_LABELS[cat]} 排行获取失败: ${err instanceof Error ? err.message : '未知错误'}`));
          }
        }
      }

      const flatResults = allResults.flatMap(r => r.results);

      if (flatResults.length === 0) {
        console.log(chalk.yellow('\n未获取到任何基金数据'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(allResults.map(r => ({ type: r.type, results: r.results })), null, 2));
      } else {
        console.log(chalk.gray(`\n共分析 ${flatResults.length} 只基金`));
      }

      if (opts.lark !== undefined) {
        await sendToLark(opts.lark, formatLarkLeaderboard(allResults));
      }
    });
}
