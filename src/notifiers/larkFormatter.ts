import type { FundAnalysis } from '../types/fund.js';
import { getScoreLevel, classifyFund } from '../scorers/fundScorer.js';
import type { LarkMessage } from './sendLarkNotification.js';

const CATEGORY_LABELS = { bond: '债券类', balanced: '平衡类', equity: '股票类' } as const;

function scoreEmoji(score: number): string {
  if (score >= 70) return '🟢';
  if (score >= 55) return '🟡';
  return '🔴';
}

/** 格式化单只基金分析结果为飞书卡片消息 */
export function formatLarkFundAnalysis(analysis: FundAnalysis): LarkMessage {
  const { data, score } = analysis;
  const { basic, performance: p, meta } = data;
  const cat = classifyFund(basic.type);

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: `📊 ${basic.name} (${basic.code})` },
        template: score.totalScore >= 70 ? 'green' : score.totalScore >= 55 ? 'yellow' : 'red',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              `**类型:** ${basic.type || '未知'} [${CATEGORY_LABELS[cat]}]`,
              `**总分:** ${scoreEmoji(score.totalScore)} **${score.totalScore}**/100  ${getScoreLevel(score.totalScore)}`,
              `**收益能力:** ${score.returnScore}/40  **风险控制:** ${score.riskScore}/30  **综合评价:** ${score.overallScore}/30`,
            ].join('\n'),
          },
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              '**关键指标**',
              `近1年收益 **${p.returnYear1}%**  |  近3年收益 **${p.returnYear3}%**`,
              `夏普比率 **${p.sharpeRatio}**  |  最大回撤 **${p.maxDrawdown}%**`,
              `波动率 **${p.volatility}%**  |  规模 **${meta.fundSize}亿**`,
              `经理年限 **${meta.managerYears}年**  |  费率 **${meta.totalFeeRate}%**`,
            ].join('\n'),
          },
        },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `fund-analyzer · ${new Date().toLocaleString('zh-CN')}` }],
        },
      ],
    },
  };
}

/** 格式化批量分析结果为飞书卡片消息 */
export function formatLarkBatchSummary(analyses: FundAnalysis[]): LarkMessage {
  const sorted = [...analyses].sort((a, b) => b.score.totalScore - a.score.totalScore);

  const rows = sorted
    .map((a, i) => {
      const cat = classifyFund(a.data.basic.type);
      return `${i + 1}. ${scoreEmoji(a.score.totalScore)} **${a.data.basic.name}** (${a.data.basic.code}) [${CATEGORY_LABELS[cat]}] — **${a.score.totalScore}分** ${getScoreLevel(a.score.totalScore)}`;
    })
    .join('\n');

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: `📊 基金批量分析（共 ${sorted.length} 只）` },
        template: 'blue',
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: rows } },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `fund-analyzer · ${new Date().toLocaleString('zh-CN')}` }],
        },
      ],
    },
  };
}
