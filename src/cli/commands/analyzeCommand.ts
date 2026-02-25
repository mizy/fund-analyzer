import type { Command } from 'commander';
import chalk from 'chalk';
import { fetchFundData } from '../../fetchers/index.js';
import { scoreFund } from '../../scorers/fundScorer.js';
import { formatFundAnalysis, formatBatchSummary } from '../../formatters/terminalFormatter.js';
import { formatLarkFundAnalysis, formatLarkBatchSummary } from '../../notifiers/larkFormatter.js';
import { handleError, sendToLark } from '../handleError.js';
import type { FundAnalysis } from '../../types/fund.js';

export function registerAnalyzeCommand(program: Command): void {
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
}

export function registerBatchCommand(program: Command): void {
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

      if (opts.sort === 'return') {
        results.sort((a, b) => b.score.returnScore - a.score.returnScore);
      } else if (opts.sort === 'risk') {
        results.sort((a, b) => b.score.riskScore - a.score.riskScore);
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        formatBatchSummary(results);
      }

      if (opts.lark !== undefined) {
        await sendToLark(opts.lark, formatLarkBatchSummary(results));
      }
    });
}
