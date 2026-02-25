import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { writeFileSync } from 'node:fs';
import { sendLarkNotification, getLarkWebhookUrl } from '../../notifiers/sendLarkNotification.js';
import { backtestBatch, generateBacktestHTML } from '../../backtest/index.js';
import { handleError } from '../handleError.js';
import type { ScoringBacktestReport } from '../../backtest/types.js';

function formatScoringBacktestReport(report: ScoringBacktestReport): void {
  console.log('');
  console.log(chalk.cyan.bold('─── 回测统计 ───'));
  const statsTable = new Table({
    head: ['总样本数', '基金数量', '评估日期范围'].map(h => chalk.white.bold(h)),
  });
  statsTable.push([
    String(report.summary.totalSamples),
    String(report.summary.fundCount),
    report.summary.dateRange,
  ]);
  console.log(statsTable.toString());
  console.log('');

  console.log(chalk.cyan.bold('─── 评分与后续收益相关性 ───'));
  const corrTable = new Table({
    head: ['前瞻期', 'Pearson', 'Spearman', '样本量'].map(h => chalk.white.bold(h)),
  });
  for (const [period, corr] of Object.entries(report.correlation)) {
    const fmtCorr = (v: number) => {
      const s = v.toFixed(4);
      return Math.abs(v) >= 0.3 ? chalk.green(s) : Math.abs(v) >= 0.1 ? chalk.yellow(s) : chalk.gray(s);
    };
    corrTable.push([period, fmtCorr(corr.pearson), fmtCorr(corr.spearman), String(corr.sampleSize)]);
  }
  console.log(corrTable.toString());
  console.log('');

  for (const { period, quintiles } of report.scoreQuintileReturns) {
    if (quintiles.length === 0) continue;
    console.log(chalk.cyan.bold(`─── 五分位收益分析 (前瞻${period}) ───`));
    const qTable = new Table({
      head: ['分位', '平均评分', '平均收益', '样本数'].map(h => chalk.white.bold(h)),
    });
    for (const q of quintiles) {
      const retStr = q.avgReturn >= 0
        ? chalk.green(`+${q.avgReturn.toFixed(2)}%`)
        : chalk.red(`${q.avgReturn.toFixed(2)}%`);
      qTable.push([q.label, q.avgScore.toFixed(1), retStr, String(q.count)]);
    }
    console.log(qTable.toString());
    console.log('');
  }

  console.log(chalk.cyan.bold('─── 各时点评分详情 ───'));
  const periods = Object.keys(report.correlation);
  const detailHead = ['日期', '基金', '评分', ...periods.map(p => `前瞻${p}`)];
  const detailTable = new Table({
    head: detailHead.map(h => chalk.white.bold(h)),
  });
  for (const r of report.results) {
    const fwdCells = periods.map(p => {
      const fwd = r.forwardReturns.find(f => f.period === p);
      if (!fwd || isNaN(fwd.return)) return chalk.gray('—');
      const s = `${fwd.return >= 0 ? '+' : ''}${fwd.return.toFixed(2)}%`;
      return fwd.return >= 0 ? chalk.green(s) : chalk.red(s);
    });
    detailTable.push([r.evalDate, `${r.fundName}(${r.fundCode})`, r.score.toFixed(1), ...fwdCells]);
  }
  console.log(detailTable.toString());
  console.log('');
}

export function registerNotifyTestCommand(program: Command): void {
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
}

export function registerScoringBacktestCommand(program: Command): void {
  program
    .command('scoring-backtest <codes>')
    .description('评分预测回测：验证评分模型对未来收益的预测力')
    .option('--start <date>', '回测起始日期 (YYYY-MM-DD)', '2020-01-01')
    .option('--end <date>', '回测结束日期 (YYYY-MM-DD)', '2024-01-01')
    .option('--step <months>', '采样间隔（月）', '3')
    .option('--forward <years>', '前瞻期（年，逗号分隔）', '1')
    .option('--json', '输出 JSON 格式')
    .option('--html [path]', '生成 HTML 可视化报告（默认 backtest_report.html）')
    .action(async (codesStr: string, opts: {
      start: string; end: string; step: string; forward: string; json?: boolean; html?: string | true;
    }) => {
      const codes = codesStr.split(',').map(c => c.trim()).filter(Boolean);
      if (codes.length === 0) {
        console.log(chalk.red('请提供至少一个基金代码'));
        return;
      }

      const stepMonths = parseInt(opts.step) || 3;
      const forwardYears = opts.forward.split(',').map(s => parseFloat(s.trim())).filter(n => n > 0);

      console.log(chalk.cyan.bold('═══ 评分预测回测 ═══'));
      console.log(chalk.gray(`基金: ${codes.join(', ')}`));
      console.log(chalk.gray(`回测区间: ${opts.start} ~ ${opts.end}，每${stepMonths}月采样`));
      console.log(chalk.gray(`前瞻期: ${forwardYears.map(y => `${y}年`).join(', ')}`));
      console.log('');

      try {
        const report = await backtestBatch(
          codes, opts.start, opts.end, stepMonths, forwardYears,
          msg => console.log(chalk.gray(`  ${msg}`)),
        );

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          formatScoringBacktestReport(report);
        }

        if (opts.html !== undefined) {
          const htmlPath = typeof opts.html === 'string' ? opts.html : 'backtest_report.html';
          const html = generateBacktestHTML(report);
          writeFileSync(htmlPath, html, 'utf-8');
          console.log(chalk.green(`✓ HTML 报告已生成: ${htmlPath}`));
        }
      } catch (err) {
        handleError(err, codesStr);
      }
    });
}
