/**
 * 基金评分回测测试
 *
 * 使用真实基金的固定历史数据快照，手动计算预期评分，
 * 验证评分模型的正确性和不同类型基金的评分差异逻辑。
 *
 * 测试样本：
 * 1. 招商双债增强 (债券型) - 稳健债基
 * 2. 易方达蓝筹精选 (股票型) - 优质股基
 * 3. 交银定期支付双息平衡 (混合型-平衡) - 平衡基金
 * 4. 华泰柏瑞沪深300ETF联接 (指数型→equity) - 指数基金
 */
import { describe, it, expect } from 'vitest';
import { scoreFund, classifyFund } from '../fundScorer.js';
import { scoreFundDeep } from '../fundScorerDeep.js';
import type { FundData, PeriodRiskMetrics, QuantMetrics, FundHoldings } from '../../types/fund.js';

// ====== 固定数据快照 ======

function makeRisk(overrides: Partial<PeriodRiskMetrics>): PeriodRiskMetrics {
  return { sharpeRatio: 1, maxDrawdown: 10, volatility: 15, sortinoRatio: 1.5, calmarRatio: 1.0, ...overrides };
}

// --- 招商双债增强 (债券型) ---
// 稳健的二级债基，收益稳定，回撤小
const bondFund: FundData = {
  basic: { code: '161716', name: '招商双债增强', type: '债券型', establishDate: '2012-11-01' },
  performance: {
    returnYear1: 5.2,
    returnYear3: 15,
    sharpeRatio: 1.2,
    maxDrawdown: 2.5,
    sortinoRatio: 1.8,
    volatility: 3.5,
    riskByPeriod: {
      year1: makeRisk({ sharpeRatio: 1.2, maxDrawdown: 2.5, volatility: 3.5, sortinoRatio: 1.8, calmarRatio: 2.08 }),
      year3: makeRisk({ sharpeRatio: 1.2, maxDrawdown: 2.5, volatility: 3.5, sortinoRatio: 1.8, calmarRatio: 2.08 }),
      all:   makeRisk({ sharpeRatio: 1.2, maxDrawdown: 2.5, volatility: 3.5, sortinoRatio: 1.8, calmarRatio: 2.08 }),
    },
  },
  meta: { morningstarRating: 4, categoryRankPercent: 15, fundSize: 85, managerYears: 8, totalFeeRate: 0.8 },
};

// --- 易方达蓝筹精选 (股票型) ---
// 明星基金经理张坤管理，大盘蓝筹风格
const equityFund: FundData = {
  basic: { code: '005827', name: '易方达蓝筹精选', type: '偏股混合型', establishDate: '2018-09-05' },
  performance: {
    returnYear1: 25,
    returnYear3: 60,
    sharpeRatio: 1.6,
    maxDrawdown: 22,
    sortinoRatio: 2.1,
    volatility: 22,
    riskByPeriod: {
      year1: makeRisk({ sharpeRatio: 1.6, maxDrawdown: 22, volatility: 22, sortinoRatio: 2.1, calmarRatio: 1.14 }),
      year3: makeRisk({ sharpeRatio: 1.6, maxDrawdown: 22, volatility: 22, sortinoRatio: 2.1, calmarRatio: 1.14 }),
      all:   makeRisk({ sharpeRatio: 1.6, maxDrawdown: 22, volatility: 22, sortinoRatio: 2.1, calmarRatio: 1.14 }),
    },
  },
  meta: { morningstarRating: 5, categoryRankPercent: 10, fundSize: 120, managerYears: 12, totalFeeRate: 1.5 },
};

// --- 交银定期支付双息平衡 (混合型-平衡) ---
// 典型平衡型基金，股债配比均衡
const balancedFund: FundData = {
  basic: { code: '519732', name: '交银定期支付双息平衡', type: '混合型-平衡', establishDate: '2013-12-04' },
  performance: {
    returnYear1: 12,
    returnYear3: 35,
    sharpeRatio: 1.3,
    maxDrawdown: 15,
    sortinoRatio: 1.8,
    volatility: 13,
    riskByPeriod: {
      year1: makeRisk({ sharpeRatio: 1.3, maxDrawdown: 15, volatility: 13, sortinoRatio: 1.8, calmarRatio: 0.8 }),
      year3: makeRisk({ sharpeRatio: 1.3, maxDrawdown: 15, volatility: 13, sortinoRatio: 1.8, calmarRatio: 0.8 }),
      all:   makeRisk({ sharpeRatio: 1.3, maxDrawdown: 15, volatility: 13, sortinoRatio: 1.8, calmarRatio: 0.8 }),
    },
  },
  meta: { morningstarRating: 3, categoryRankPercent: 25, fundSize: 25, managerYears: 6, totalFeeRate: 1.2 },
};

// --- 华泰柏瑞沪深300ETF联接 (指数型→equity) ---
// 被动指数基金，无晨星评级
const indexFund: FundData = {
  basic: { code: '460300', name: '华泰柏瑞沪深300ETF联接', type: '指数型', establishDate: '2013-04-01' },
  performance: {
    returnYear1: 18,
    returnYear3: 45,
    sharpeRatio: 1.1,
    maxDrawdown: 28,
    sortinoRatio: 1.3,
    volatility: 23,
    riskByPeriod: {
      year1: makeRisk({ sharpeRatio: 1.1, maxDrawdown: 28, volatility: 23, sortinoRatio: 1.3, calmarRatio: 0.64 }),
      year3: makeRisk({ sharpeRatio: 1.1, maxDrawdown: 28, volatility: 23, sortinoRatio: 1.3, calmarRatio: 0.64 }),
      all:   makeRisk({ sharpeRatio: 1.1, maxDrawdown: 28, volatility: 23, sortinoRatio: 1.3, calmarRatio: 0.64 }),
    },
  },
  meta: { morningstarRating: 0, categoryRankPercent: 30, fundSize: 350, managerYears: 3, totalFeeRate: 0.5 },
};

// --- 量化指标快照 ---

const equityQuant: QuantMetrics = {
  alpha: 0.10, beta: 0.85, informationRatio: 0.8,
  treynorRatio: 0.12, var95: 0.018, cvar95: 0.025,
  monthlyWinRate: 0.58, downsideCaptureRatio: 0.75,
  cagr: 0.20, hhi: 0.12, topHoldingsRatio: 40,
};

const bondQuant: QuantMetrics = {
  alpha: 0.03, beta: 0.3, informationRatio: 1.1,
  treynorRatio: 0.08, var95: 0.004, cvar95: 0.006,
  monthlyWinRate: 0.70, downsideCaptureRatio: 0.4,
  cagr: 0.05, hhi: 0.08, topHoldingsRatio: 25,
};

const balancedQuant: QuantMetrics = {
  alpha: 0.06, beta: 0.7, informationRatio: 0.5,
  treynorRatio: 0.10, var95: 0.012, cvar95: 0.018,
  monthlyWinRate: 0.55, downsideCaptureRatio: 0.6,
  cagr: 0.12, hhi: 0.10, topHoldingsRatio: 30,
};

const indexQuant: QuantMetrics = {
  alpha: 0.01, beta: 1.0, informationRatio: 0.2,
  treynorRatio: 0.09, var95: 0.022, cvar95: 0.030,
  monthlyWinRate: 0.52, downsideCaptureRatio: 0.95,
  cagr: 0.10, hhi: 0.06, topHoldingsRatio: 35,
};

const equityHoldings: FundHoldings = {
  topStocks: [
    { name: '贵州茅台', code: '600519', percent: 9 },
    { name: '泸州老窖', code: '000568', percent: 8 },
    { name: '五粮液', code: '000858', percent: 7 },
  ],
  industries: [{ industry: '食品饮料', percent: 50 }, { industry: '银行', percent: 15 }],
  reportDate: '2025-06-30',
};

const bondHoldings: FundHoldings = {
  topStocks: [{ name: '国债', code: '019666', percent: 15 }],
  industries: [{ industry: '金融', percent: 30 }],
  reportDate: '2025-06-30',
};

// ====== 回测测试 ======

describe('回测：基金类型分类', () => {
  it('should classify all sample funds correctly', () => {
    expect(classifyFund(bondFund.basic.type)).toBe('bond');
    expect(classifyFund(equityFund.basic.type)).toBe('equity');
    expect(classifyFund(balancedFund.basic.type)).toBe('balanced');
    expect(classifyFund(indexFund.basic.type)).toBe('equity'); // 指数→equity
  });
});

// ====== scoreFund 回测 ======

describe('回测：scoreFund 基础模型', () => {
  /**
   * 债券基金评分推导（scale=1，有晨星4星）：
   * 权重: 收益35 + 风控35 + 综合30 = 100
   *
   * 近1年 5.2%: bond {full:8,high:5} → ≥high → 8*0.8 = 6.4
   * 近3年 15%:  bond {full:20,high:12} → ≥high → 10*0.8 = 8
   * 夏普 1.2:   bond {full:1.5,high:1.0} → ≥high → 12*0.8 = 9.6 (加权同值)
   * 索提诺 1.8: bond {full:2.0,high:1.5} → ≥high → 5*0.8 = 4
   * 卡玛 2.08:  bond {full:2.0} → ≥full → 10
   * 最大回撤 2.5%: bond {full:3} → ≤full → 18
   * 波动率 3.5%:   bond {full:3,high:5} → ≤high → 7*0.8 = 5.6
   * 晨星 4星: 4*(8/5) = 6.4
   * 规模 85亿: 2-100 → 8
   * 经理 8年: ≥7 → 8
   * 费率 0.8%: ≤0.8 → 6
   *
   * return = 9.6+4+6.4+8 = 28, risk = 10+18+5.6 = 33.6, overall = 6.4+8+8+6 = 28.4
   * total = 90
   */
  it('债券基金 - 招商双债增强 (161716)', () => {
    const result = scoreFund(bondFund);

    expect(result.returnScore).toBeCloseTo(28, 0);
    expect(result.riskScore).toBeCloseTo(33.6, 0);
    expect(result.overallScore).toBeCloseTo(28.4, 0);
    expect(result.totalScore).toBeCloseTo(90, 0);

    // Verify individual detail items
    const d = (item: string) => result.details.find(x => x.item === item)!;
    expect(d('近1年收益').score).toBe(6.4);
    expect(d('近3年收益').score).toBe(8);
    expect(d('夏普比率').score).toBe(9.6);
    expect(d('索提诺比率').score).toBe(4);
    expect(d('卡玛比率').score).toBe(10);
    expect(d('最大回撤').score).toBe(18);
    expect(d('波动率').score).toBe(5.6);
    expect(d('晨星评级').score).toBe(6.4);
    expect(d('基金规模').score).toBe(8);
    expect(d('经理年限').score).toBe(8);
    expect(d('费率').score).toBe(6);
  });

  /**
   * 股票基金评分推导（scale=1，有晨星5星）：
   * 权重: 收益35 + 风控35 + 综合30 = 100
   *
   * 近1年 25%: equity {full:30,high:20} → ≥high → 8*0.8 = 6.4
   * 近3年 60%: equity {full:80,high:50} → ≥high → 10*0.8 = 8
   * 夏普 1.6:  equity {full:2.0,high:1.5} → ≥high → 12*0.8 = 9.6
   * 索提诺 2.1: equity {full:2.5,high:2.0} → ≥high → 5*0.8 = 4
   * 卡玛 1.14:  equity {full:3.0,high:2.0,mid:1.0} → ≥mid → 10*0.6 = 6
   * 最大回撤 22%: equity {full:15,high:25} → ≤high → 18*0.8 = 14.4
   * 波动率 22%:   equity {full:15,high:20,mid:25} → ≤mid → 7*0.53 = 3.71 → round = 3.7
   * 晨星 5星: 5*(8/5) = 8
   * 规模 120亿: 100-300 → 8*0.8 = 6.4
   * 经理 12年: ≥7 → 8
   * 费率 1.5%: ≤1.5 → 6*0.67 = 4.02 → round = 4
   *
   * return = 9.6+4+6.4+8 = 28, risk = 6+14.4+3.7 = 24.1, overall = 8+6.4+8+4 = 26.4
   * total = 78.5
   */
  it('股票基金 - 易方达蓝筹精选 (005827)', () => {
    const result = scoreFund(equityFund);

    expect(result.returnScore).toBeCloseTo(28, 0);
    expect(result.riskScore).toBeCloseTo(24.1, 0);
    expect(result.overallScore).toBeCloseTo(26.4, 0);
    expect(result.totalScore).toBeCloseTo(78.5, 0);

    const d = (item: string) => result.details.find(x => x.item === item)!;
    expect(d('近1年收益').score).toBe(6.4);
    expect(d('近3年收益').score).toBe(8);
    expect(d('夏普比率').score).toBe(9.6);
    expect(d('索提诺比率').score).toBe(4);
    expect(d('卡玛比率').score).toBe(6);
    expect(d('最大回撤').score).toBe(14.4);
    expect(d('波动率').score).toBe(3.7); // 7*0.53 rounded
    expect(d('晨星评级').score).toBe(8);
    expect(d('基金规模').score).toBe(6.4);
    expect(d('经理年限').score).toBe(8);
    expect(d('费率').score).toBe(4);
  });

  /**
   * 平衡基金评分推导（scale=1，有晨星3星）：
   * 权重: 收益35 + 风控35 + 综合30 = 100
   *
   * 近1年 12%: balanced {full:20,high:12} → ≥high → 8*0.8 = 6.4
   * 近3年 35%: balanced {full:50,high:30} → ≥high → 10*0.8 = 8
   * 夏普 1.3:  balanced {full:2.0,high:1.5,mid:1.0} → ≥mid → 12*0.6 = 7.2
   * 索提诺 1.8: balanced {full:2.5,high:2.0,mid:1.5} → ≥mid → 5*0.6 = 3
   * 卡玛 0.8:  balanced {full:3.0,high:2.0,mid:1.0,low:0.5} → ≥low → 10*0.33 = 3.3
   * 最大回撤 15%: balanced {full:10,high:20} → ≤high → 18*0.8 = 14.4
   * 波动率 13%:   balanced {full:10,high:15} → ≤high → 7*0.8 = 5.6
   * 晨星 3星: 3*(8/5) = 4.8
   * 规模 25亿: 2-100 → 8
   * 经理 6年: ≥5 → 8*0.8 = 6.4
   * 费率 1.2%: ≤1.2 → 6*0.83 = 4.98 → round = 5
   *
   * return = 7.2+3+6.4+8 = 24.6, risk = 3.3+14.4+5.6 = 23.3, overall = 4.8+8+6.4+5 = 24.2
   * total = 72.1
   */
  it('平衡基金 - 交银定期支付双息平衡 (519732)', () => {
    const result = scoreFund(balancedFund);

    expect(result.returnScore).toBeCloseTo(24.6, 0);
    expect(result.riskScore).toBeCloseTo(23.3, 0);
    expect(result.overallScore).toBeCloseTo(24.2, 0);
    expect(result.totalScore).toBeCloseTo(72.1, 0);

    const d = (item: string) => result.details.find(x => x.item === item)!;
    expect(d('近1年收益').score).toBe(6.4);
    expect(d('近3年收益').score).toBe(8);
    expect(d('夏普比率').score).toBe(7.2);
    expect(d('索提诺比率').score).toBe(3);
    expect(d('卡玛比率').score).toBe(3.3);
    expect(d('最大回撤').score).toBe(14.4);
    expect(d('波动率').score).toBe(5.6);
    expect(d('晨星评级').score).toBe(4.8);
    expect(d('基金规模').score).toBe(8);
    expect(d('经理年限').score).toBe(6.4);
    expect(d('费率').score).toBe(5);
  });

  /**
   * 指数基金评分推导（无晨星，scale = 100/92 ≈ 1.08696）：
   * 权重: 收益35 + 风控35 + 综合30 = 100 (无晨星8分，92分按比例放大)
   *
   * 近1年 18%: equity {full:30,high:20,mid:10} → ≥mid → (8*scale)*0.6
   * 近3年 45%: equity {full:80,high:50,mid:30} → ≥mid → (10*scale)*0.6
   * 夏普 1.1: equity {full:2.0,high:1.5,mid:1.0} → ≥mid → (12*scale)*0.6
   * 索提诺 1.3: equity {full:2.5,high:2.0,mid:1.5,low:1.0} → ≥low → (5*scale)*0.33
   * 卡玛 0.64: equity {full:3.0,high:2.0,mid:1.0,low:0.5} → ≥low → (10*scale)*0.33
   * 最大回撤 28%: equity {full:15,high:25,mid:35} → ≤mid → (18*scale)*0.53
   * 波动率 23%: equity {full:15,high:20,mid:25} → ≤mid → (7*scale)*0.53
   * 晨星: excluded
   * 规模 350亿: >300 → (8*scale)*0.4
   * 经理 3年: ≥3 → (8*scale)*0.6
   * 费率 0.5%: ≤0.8 → 6*scale
   */
  it('指数基金 - 华泰柏瑞沪深300ETF联接 (460300)', () => {
    const result = scoreFund(indexFund);
    const scale = 100 / 92;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    // No morningstar → morningstar detail excluded
    expect(result.details.find(x => x.item === '晨星评级')).toBeUndefined();

    // Verify scaled maxScores
    const d = (item: string) => result.details.find(x => x.item === item)!;
    expect(d('近1年收益').maxScore).toBe(round1(8 * scale));
    expect(d('夏普比率').maxScore).toBe(round1(12 * scale));

    // Detail scores
    expect(d('近1年收益').score).toBeCloseTo(round1(8 * scale * 0.6), 0.5); // mid tier
    expect(d('近3年收益').score).toBeCloseTo(round1(10 * scale * 0.6), 0.5);

    // Sortino 1.3: equity {full:2.5,high:2.0,mid:1.5,low:1.0} → ≥low → 0.33x
    expect(d('索提诺比率').score).toBeCloseTo(round1(5 * scale * 0.33), 0.5);

    // Meta scores (scaled)
    expect(d('基金规模').score).toBe(round1(8 * scale * 0.4));
    expect(d('经理年限').score).toBe(round1(8 * scale * 0.6));
    expect(d('费率').score).toBe(round1(6 * scale));

    // Overall structure check - returnScore includes sharpe+sortino+year1+year3 (NOT calmar)
    const expectedReturn = round1(
      d('夏普比率').score + d('索提诺比率').score +
      d('近1年收益').score + d('近3年收益').score
    );
    expect(result.returnScore).toBe(expectedReturn);
    expect(result.totalScore).toBe(round1(result.returnScore + result.riskScore + result.overallScore));

    // Without morningstar, total should be meaningfully lower
    expect(result.totalScore).toBeLessThan(bondFund.meta.morningstarRating > 0 ? 100 : 0);
    // But still reasonable
    expect(result.totalScore).toBeGreaterThan(40);
    expect(result.totalScore).toBeLessThan(80);
  });
});

// ====== 类型间评分差异验证 ======

describe('回测：不同类型基金的评分差异逻辑', () => {
  it('债券基金的风险分应高于股票基金', () => {
    // Bond fund with low drawdown (2.5%) scores well on bond benchmarks
    // Equity fund with higher drawdown (22%) scores lower on equity benchmarks
    const bondResult = scoreFund(bondFund);
    const equityResult = scoreFund(equityFund);
    expect(bondResult.riskScore).toBeGreaterThan(equityResult.riskScore);
  });

  it('优质债基总分应达到"优秀"级别', () => {
    const result = scoreFund(bondFund);
    expect(result.totalScore).toBeGreaterThanOrEqual(85); // 优秀 ★★★★★ (90)
  });

  it('优质股基总分应达到"良好"级别', () => {
    const result = scoreFund(equityFund);
    expect(result.totalScore).toBeGreaterThanOrEqual(70); // 良好 ★★★★ (78.5)
  });

  it('平衡基金总分应在"中等"或"良好"范围', () => {
    const result = scoreFund(balancedFund);
    expect(result.totalScore).toBeGreaterThanOrEqual(55);
    expect(result.totalScore).toBeLessThan(85);
  });

  it('无晨星评级的指数基金总分应低于有评级的主动基金', () => {
    const indexResult = scoreFund(indexFund);
    const equityResult = scoreFund(equityFund);
    expect(indexResult.totalScore).toBeLessThan(equityResult.totalScore);
  });

  it('所有基金总分应在合理范围内 (30-100)', () => {
    for (const fund of [bondFund, equityFund, balancedFund, indexFund]) {
      const result = scoreFund(fund);
      expect(result.totalScore).toBeGreaterThanOrEqual(30);
      expect(result.totalScore).toBeLessThanOrEqual(100);
    }
  });

  it('维度分之和应等于总分', () => {
    const round1 = (n: number) => Math.round(n * 10) / 10;
    for (const fund of [bondFund, equityFund, balancedFund, indexFund]) {
      const result = scoreFund(fund);
      const sum = round1(result.returnScore + result.riskScore + result.overallScore);
      expect(result.totalScore).toBe(sum);
    }
  });
});

// ====== scoreFundDeep 回测 ======

describe('回测：scoreFundDeep 深度模型', () => {
  /**
   * 债券基金深度评分推导（bond类型）：
   *
   * 收益(30分):
   *   近1年 5.2%: bond {full:8,high:5} → ≥high → 8*0.8 = 6.4
   *   近3年 15%:  bond {full:20,high:12} → ≥high → 7*0.8 = 5.6
   *   Alpha 0.03: bond {full:0.05,high:0.03} → ≥high → 10*0.8 = 8
   *   胜率 0.70:  bond {full:0.75,high:0.65} → ≥high → 5*0.8 = 4
   *   return = round1(6.4 + 5.6 + 8 + 4) = 24
   *
   * 风险(30分):
   *   夏普 1.2: bond {full:1.5,high:1.0} → ≥high → 10*0.8 = 8
   *   回撤 2.5%: bond {full:3} → ≤full → 8
   *   Beta 0.3: <0.4 → 5*0.6 = 3
   *   VaR 0.004: bond {full:0.003,high:0.005} → ≤high → 4*0.8 = 3.2
   *   波动率 3.5%: bond {full:3,high:5} → ≤high → 3*0.8 = 2.4
   *   risk = round1(8 + 8 + 3 + 3.2 + 2.4) = 24.6
   *
   * 持仓(15分):
   *   HHI 0.08: 0.05-0.15 → 8 (满分)
   *   重仓 25%: 20-50 → 7 (满分)
   *   holding = 15
   *
   * 稳定性(10分):
   *   IR 1.1: bond {full:1.5,high:1.0} → ≥high → 5*0.8 = 4
   *   一致性: cagr 0.05 > 0 → ratio=0.7 → ≥0.60 → 5*0.6 = 3
   *   stability = round1(4 + 3) = 7
   *
   * 综合(15分):
   *   规模 85亿 → 5
   *   经理 8年 → 5
   *   晨星 4星: scoreMorningstar(4)/3 = 12/3 = 4
   *   overall = round1(5 + 5 + 4) = 14
   *
   * total = 24 + 24.6 + 15 + 7 + 14 = 84.6
   */
  it('债券基金深度评分 - 招商双债增强', () => {
    const result = scoreFundDeep(bondFund, bondQuant, bondHoldings);

    expect(result.returnScore).toBeCloseTo(24, 0.5);
    expect(result.riskScore).toBeCloseTo(24.6, 0.5);
    expect(result.holdingScore).toBeCloseTo(15, 0.5);
    expect(result.stabilityScore).toBeCloseTo(7, 0.5);
    expect(result.overallScore).toBeCloseTo(14, 0.5);
    expect(result.totalScore).toBeCloseTo(84.6, 0.5);

    const d = (item: string) => result.details.find(x => x.item === item)!;
    expect(d('Alpha超额收益').score).toBe(8);
    expect(d('行业集中度HHI').score).toBe(8);
    expect(d('重仓占比').score).toBe(7);
  });

  /**
   * 股票基金深度评分推导（equity类型）：
   *
   * 收益(30分):
   *   近1年 25%: equity {full:30,high:20} → ≥high → 8*0.8 = 6.4
   *   近3年 60%: equity {full:80,high:50} → ≥high → 7*0.8 = 5.6
   *   Alpha 0.10: equity {full:0.15,high:0.08} → ≥high → 10*0.8 = 8
   *   胜率 0.58: equity {full:0.60,high:0.55} → ≥high → 5*0.8 = 4
   *   return = round1(6.4 + 5.6 + 8 + 4) = 24
   *
   * 风险(30分):
   *   夏普 1.6: equity {full:2.0,high:1.5} → ≥high → 10*0.8 = 8
   *   回撤 22%: equity {full:15,high:25} → ≤high → 8*0.8 = 6.4
   *   Beta 0.85: 0.6-0.9 → 5 (满分)
   *   VaR 0.018: equity {full:0.015,high:0.020} → ≤high → 4*0.8 = 3.2
   *   波动率 22%: equity {full:15,high:20,mid:25} → ≤mid → 3*0.53 = 1.59
   *   risk = round1(8 + 6.4 + 5 + 3.2 + 1.59) = 24.2
   *
   * 持仓(15分):
   *   HHI 0.12: 0.05-0.15 → 8
   *   重仓 40%: 20-50 → 7
   *   holding = 15
   *
   * 稳定性(10分):
   *   IR 0.8: equity {full:1.0,high:0.7} → ≥high → 5*0.8 = 4
   *   一致性: cagr 0.20 > 0 → ratio=0.7 → ≥0.60 → 5*0.6 = 3
   *   stability = 7
   *
   * 综合(15分):
   *   规模 120亿: 100-300 → 4
   *   经理 12年: ≥7 → 5
   *   晨星 5星: 15/3 = 5
   *   overall = 14
   *
   * total = 24 + 24.2 + 15 + 7 + 14 = 84.2
   */
  it('股票基金深度评分 - 易方达蓝筹精选', () => {
    const result = scoreFundDeep(equityFund, equityQuant, equityHoldings);

    expect(result.returnScore).toBeCloseTo(24, 0.5);
    expect(result.riskScore).toBeCloseTo(24.2, 0.5);
    expect(result.holdingScore).toBe(15);
    expect(result.stabilityScore).toBeCloseTo(7, 0.5);
    expect(result.overallScore).toBeCloseTo(14, 0.5);
    expect(result.totalScore).toBeCloseTo(84.2, 0.5);

    const d = (item: string) => result.details.find(x => x.item === item)!;
    expect(d('Beta系数').score).toBe(5); // ideal range
    expect(d('VaR(95%)').score).toBeCloseTo(3.2, 0.1);
  });

  /**
   * 平衡基金深度评分推导：
   *
   * 收益(30分):
   *   近1年 12%: balanced {full:20,high:12} → ≥high → 8*0.8 = 6.4
   *   近3年 35%: balanced {full:50,high:30} → ≥high → 7*0.8 = 5.6
   *   Alpha 0.06: balanced {full:0.10,high:0.05} → ≥high → 10*0.8 = 8
   *   胜率 0.55: balanced {full:0.65,high:0.58,mid:0.50} → ≥mid → 5*0.6 = 3
   *   return = round1(6.4 + 5.6 + 8 + 3) = 23
   *
   * 风险(30分):
   *   夏普 1.3: balanced {full:2.0,high:1.5,mid:1.0} → ≥mid → 10*0.6 = 6
   *   回撤 15%: balanced {full:10,high:20} → ≤high → 8*0.8 = 6.4
   *   Beta 0.7: 0.6-0.9 → 5
   *   VaR 0.012: balanced {full:0.010,high:0.015} → ≤high → 4*0.8 = 3.2
   *   波动率 13%: balanced {full:10,high:15} → ≤high → 3*0.8 = 2.4
   *   risk = round1(6 + 6.4 + 5 + 3.2 + 2.4) = 23
   *
   * 持仓(15分):
   *   HHI 0.10: 0.05-0.15 → 8
   *   重仓 30%: 20-50 → 7
   *   holding = 15
   *
   * 稳定性(10分):
   *   IR 0.5: balanced {full:1.0,high:0.7,mid:0.3} → ≥mid → 5*0.6 = 3
   *   一致性: cagr 0.12 > 0 → ratio=0.7 → ≥0.60 → 5*0.6 = 3
   *   stability = 6
   *
   * 综合(15分):
   *   规模 25亿 → 5
   *   经理 6年 → 4
   *   晨星 3星: 9/3 = 3
   *   overall = 12
   *
   * total = 23 + 23 + 15 + 6 + 12 = 79
   */
  it('平衡基金深度评分 - 交银定期支付双息平衡', () => {
    const result = scoreFundDeep(balancedFund, balancedQuant, { ...bondHoldings });

    expect(result.returnScore).toBeCloseTo(23, 0.5);
    expect(result.riskScore).toBeCloseTo(23, 0.5);
    expect(result.holdingScore).toBe(15);
    expect(result.stabilityScore).toBeCloseTo(6, 0.5);
    expect(result.overallScore).toBeCloseTo(12, 0.5);
    expect(result.totalScore).toBeCloseTo(79, 0.5);
  });

  /**
   * 指数基金深度评分推导（equity类型，无晨星）：
   *
   * 收益(30分):
   *   近1年 18%: equity {full:30,high:20,mid:10} → ≥mid → 8*0.6 = 4.8
   *   近3年 45%: equity {full:80,high:50,mid:30} → ≥mid → 7*0.6 = 4.2
   *   Alpha 0.01: equity {full:0.15,high:0.08,mid:0.03,low:-0.05} → ≥low → 10*0.33 = 3.3
   *   胜率 0.52: equity {full:0.60,high:0.55,mid:0.48} → ≥mid → 5*0.6 = 3
   *   return = round1(4.8 + 4.2 + 3.3 + 3) = 15.3
   *
   * 风险(30分):
   *   夏普 1.1: equity {full:2.0,high:1.5,mid:1.0} → ≥mid → 10*0.6 = 6
   *   回撤 28%: equity {full:15,high:25,mid:35} → ≤mid → 8*0.53 = 4.24
   *   Beta 1.0: 0.9-1.0 → 5*0.8 = 4
   *   VaR 0.022: equity {full:0.015,high:0.020,mid:0.030} → ≤mid → 4*0.53 = 2.12
   *   波动率 23%: equity {full:15,high:20,mid:25} → ≤mid → 3*0.53 = 1.59
   *   risk = round1(6 + 4.24 + 4 + 2.12 + 1.59) = round1(17.95) = 18.0
   *
   * 持仓(15分):
   *   HHI 0.06: 0.05-0.15 → 8
   *   重仓 35%: 20-50 → 7
   *   holding = 15
   *
   * 稳定性(10分):
   *   IR 0.2: equity {full:1.0,high:0.7,mid:0.3,low:0.0} → ≥low → 5*0.33 = 1.65
   *   一致性: cagr 0.10 > 0 → ratio=0.7 → ≥0.60 → 5*0.6 = 3
   *   stability = round1(1.65 + 3) = 4.7
   *
   * 综合(15分):
   *   规模 350亿: >300 → 2
   *   经理 3年: ≥3 → 3
   *   晨星 0: → 2.5
   *   overall = round1(2 + 3 + 2.5) = 7.5
   *
   * total = round1(15.3 + 18.0 + 15 + 4.7 + 7.5) = 60.5
   */
  it('指数基金深度评分 - 华泰柏瑞沪深300ETF联接', () => {
    const result = scoreFundDeep(indexFund, indexQuant, { ...bondHoldings });

    expect(result.returnScore).toBeCloseTo(15.3, 0.5);
    expect(result.riskScore).toBeCloseTo(18, 1);
    expect(result.holdingScore).toBe(15);
    expect(result.stabilityScore).toBeCloseTo(4.7, 0.5);
    expect(result.overallScore).toBeCloseTo(7.5, 0.5);
    expect(result.totalScore).toBeCloseTo(60.5, 1);

    const d = (item: string) => result.details.find(x => x.item === item)!;
    expect(d('Beta系数').score).toBe(4); // beta=1.0 → 0.9-1.0 range → 0.8x
    expect(d('晨星评级').score).toBe(2.5); // no rating → 2.5
  });
});

// ====== 深度模型类型间差异 ======

describe('回测：深度模型类型间评分差异', () => {
  it('债券基金深度总分应高于指数基金', () => {
    const bondResult = scoreFundDeep(bondFund, bondQuant, bondHoldings);
    const indexResult = scoreFundDeep(indexFund, indexQuant, { ...bondHoldings });
    expect(bondResult.totalScore).toBeGreaterThan(indexResult.totalScore);
  });

  it('有量化数据时总分应与无量化数据时不同', () => {
    const withQuant = scoreFundDeep(equityFund, equityQuant, equityHoldings);
    const withoutQuant = scoreFundDeep(equityFund);
    expect(withQuant.totalScore).not.toBe(withoutQuant.totalScore);
  });

  it('深度模型各维度之和应等于总分', () => {
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const funds = [
      { data: bondFund, quant: bondQuant, holdings: bondHoldings },
      { data: equityFund, quant: equityQuant, holdings: equityHoldings },
      { data: balancedFund, quant: balancedQuant, holdings: bondHoldings },
      { data: indexFund, quant: indexQuant, holdings: bondHoldings },
    ];
    for (const { data, quant, holdings } of funds) {
      const r = scoreFundDeep(data, quant, holdings);
      const sum = round1(r.returnScore + r.riskScore + r.holdingScore + r.stabilityScore + r.overallScore);
      expect(r.totalScore).toBe(sum);
    }
  });

  it('所有基金深度总分应在合理范围内 (30-100)', () => {
    const funds = [
      { data: bondFund, quant: bondQuant, holdings: bondHoldings },
      { data: equityFund, quant: equityQuant, holdings: equityHoldings },
      { data: balancedFund, quant: balancedQuant, holdings: bondHoldings },
      { data: indexFund, quant: indexQuant, holdings: bondHoldings },
    ];
    for (const { data, quant, holdings } of funds) {
      const r = scoreFundDeep(data, quant, holdings);
      expect(r.totalScore).toBeGreaterThanOrEqual(30);
      expect(r.totalScore).toBeLessThanOrEqual(100);
    }
  });
});
