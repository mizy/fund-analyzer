import type { Command } from 'commander';
import chalk from 'chalk';
import { fetchIndexValuation, SUPPORTED_INDEXES } from '../../fetchers/index.js';
import { fetchHistoryNav } from '../../fetchers/fetchNavHistory.js';
import { calcTechnicalSignals } from '../../analyzers/calcTechnicalSignals.js';
import { calcIndexTimingRating } from '../../scorers/fundScorerIndex.js';
import { formatIndexTiming } from '../../formatters/indexFormatter.js';
import { handleError } from '../handleError.js';

/** 指数代码 → 常用跟踪基金代码（用于获取 NAV 历史） */
const INDEX_TRACKING_FUND: Record<string, { fund: string; name: string }> = {
  '000300': { fund: '510300', name: '沪深300' },
  '000905': { fund: '510500', name: '中证500' },
  '000852': { fund: '512100', name: '中证1000' },
  '399006': { fund: '159915', name: '创业板指' },
  '000016': { fund: '510050', name: '上证50' },
  '399673': { fund: '159949', name: '创业板50' },
  '000688': { fund: '588000', name: '科创50' },
};

export function registerAnalyzeIndexCommand(program: Command): void {
  program
    .command('analyze-index <indexCode>')
    .description(`分析指数买卖时机（支持: ${SUPPORTED_INDEXES.join(', ')}）`)
    .option('--name <name>', '指数名称（默认自动识别）')
    .option('--json', '输出 JSON 格式')
    .action(async (indexCode: string, opts: { name?: string; json?: boolean }) => {
      try {
        const tracking = INDEX_TRACKING_FUND[indexCode];
        const indexName = opts.name ?? tracking?.name ?? indexCode;

        console.log(chalk.gray(`正在分析指数 ${indexName} (${indexCode}) ...`));

        // 并行获取估值和 NAV 历史
        const [valuation, technicalResult] = await Promise.allSettled([
          fetchIndexValuation(indexCode),
          tracking
            ? fetchHistoryNav(tracking.fund).then(navs => calcTechnicalSignals(navs))
            : Promise.reject(new Error('无可用跟踪基金')),
        ]);

        if (valuation.status === 'rejected') {
          console.log(chalk.red(`估值数据获取失败: ${valuation.reason instanceof Error ? valuation.reason.message : '未知错误'}`));
          process.exitCode = 1;
          return;
        }

        // 技术面数据不可用时使用默认中性值
        let technical;
        if (technicalResult.status === 'fulfilled') {
          technical = technicalResult.value;
        } else {
          console.log(chalk.yellow(`技术面数据不可用，使用中性默认值`));
          technical = { ma5: 0, ma20: 0, ma60: 0, rsi: 50, direction: 'neutral' as const };
        }

        const result = calcIndexTimingRating({
          indexCode,
          indexName,
          valuation: valuation.value,
          technical,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          formatIndexTiming(result);
        }
      } catch (err) {
        handleError(err, indexCode);
      }
    });
}
