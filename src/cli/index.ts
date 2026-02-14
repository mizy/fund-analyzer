#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchFundData } from '../fetchers/ttjjFetcher.js';
import { scoreFund } from '../scorers/fundScorer.js';
import { formatFundAnalysis, formatCompareTable, formatBatchSummary } from '../formatters/terminalFormatter.js';
import type { FundAnalysis } from '../types/fund.js';

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
  .action(async (code: string, opts: { json?: boolean }) => {
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
    } catch (err) {
      handleError(err, code);
    }
  });

program
  .command('batch <codes>')
  .description('批量分析（逗号分隔，如 110011,000001,519694）')
  .option('--sort <field>', '排序字段 (score|return|risk)', 'score')
  .option('--json', '输出 JSON 格式')
  .action(async (codesStr: string, opts: { sort: string; json?: boolean }) => {
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
