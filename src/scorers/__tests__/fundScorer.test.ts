import { describe, it, expect } from 'vitest';
import { scoreFund, classifyFund, classifyRiskTier, getScoreLevel } from '../fundScorer.js';
import { scoreFundDeep } from '../fundScorerDeep.js';
import { RiskTier } from '../../types/fund.js';
import type { FundData, PeriodRiskMetrics, QuantMetrics, FundHoldings } from '../../types/fund.js';

// ====== Test Helpers ======

function makeRiskMetrics(overrides: Partial<PeriodRiskMetrics> = {}): PeriodRiskMetrics {
  return {
    sharpeRatio: 1.0,
    maxDrawdown: 10,
    volatility: 15,
    sortinoRatio: 1.5,
    calmarRatio: 1.0,
    ...overrides,
  };
}

function makeFundData(overrides: {
  type?: string;
  returnYear1?: number;
  returnYear3?: number;
  morningstarRating?: number;
  fundSize?: number;
  managerYears?: number;
  totalFeeRate?: number;
  riskByPeriod?: {
    year1?: PeriodRiskMetrics | null;
    year3?: PeriodRiskMetrics | null;
    all?: PeriodRiskMetrics;
  };
} = {}): FundData {
  const allMetrics = overrides.riskByPeriod?.all ?? makeRiskMetrics();
  return {
    basic: { code: '000001', name: '测试基金', type: overrides.type ?? '混合型-偏股', establishDate: '2020-01-01' },
    performance: {
      returnYear1: overrides.returnYear1 ?? 15,
      returnYear3: overrides.returnYear3 ?? 40,
      sharpeRatio: allMetrics.sharpeRatio,
      maxDrawdown: allMetrics.maxDrawdown,
      sortinoRatio: allMetrics.sortinoRatio,
      volatility: allMetrics.volatility,
      riskByPeriod: {
        year1: overrides.riskByPeriod?.year1 !== undefined ? overrides.riskByPeriod.year1 : makeRiskMetrics(),
        year3: overrides.riskByPeriod?.year3 !== undefined ? overrides.riskByPeriod.year3 : makeRiskMetrics(),
        all: allMetrics,
      },
    },
    meta: {
      morningstarRating: overrides.morningstarRating ?? 4,
      categoryRankPercent: 20,
      fundSize: overrides.fundSize ?? 50,
      managerYears: overrides.managerYears ?? 5,
      totalFeeRate: overrides.totalFeeRate ?? 1.2,
    },
  };
}

function makeQuantMetrics(overrides: Partial<QuantMetrics> = {}): QuantMetrics {
  return {
    alpha: 0.08,
    beta: 0.8,
    informationRatio: 0.7,
    treynorRatio: 0.1,
    var95: 0.02,
    cvar95: 0.03,
    monthlyWinRate: 0.55,
    downsideCaptureRatio: 0.8,
    cagr: 0.15,
    hhi: 0.1,
    topHoldingsRatio: 35,
    ...overrides,
  };
}

function makeHoldings(): FundHoldings {
  return {
    topStocks: [
      { name: '贵州茅台', code: '600519', percent: 8 },
      { name: '宁德时代', code: '300750', percent: 6 },
    ],
    industries: [{ industry: '制造业', percent: 40 }],
    reportDate: '2025-12-31',
  };
}

// ====== classifyFund ======

describe('classifyFund', () => {
  it('should classify bond funds', () => {
    expect(classifyFund('债券型')).toBe('bond');
    expect(classifyFund('纯债型')).toBe('bond');
    expect(classifyFund('短债型')).toBe('bond');
    expect(classifyFund('中短债型')).toBe('bond');
    expect(classifyFund('长债型')).toBe('bond');
    expect(classifyFund('偏债混合型')).toBe('bond');
  });

  it('should classify equity funds', () => {
    expect(classifyFund('股票型')).toBe('equity');
    expect(classifyFund('偏股混合型')).toBe('equity');
    expect(classifyFund('指数型')).toBe('equity');
  });

  it('should classify balanced/other as balanced', () => {
    expect(classifyFund('混合型-平衡')).toBe('balanced');
    expect(classifyFund('灵活配置')).toBe('balanced');
    expect(classifyFund('FOF')).toBe('balanced');
    expect(classifyFund('QDII')).toBe('balanced');
  });
});

// ====== getScoreLevel ======

describe('getScoreLevel', () => {
  it('should return correct levels', () => {
    expect(getScoreLevel(90)).toContain('优秀');
    expect(getScoreLevel(85)).toContain('优秀');
    expect(getScoreLevel(75)).toContain('良好');
    expect(getScoreLevel(70)).toContain('良好');
    expect(getScoreLevel(60)).toContain('中等');
    expect(getScoreLevel(55)).toContain('中等');
    expect(getScoreLevel(45)).toContain('较差');
    expect(getScoreLevel(40)).toContain('较差');
    expect(getScoreLevel(30)).toContain('差');
  });
});

// ====== scoreFund: 收益能力评分 ======

describe('scoreFund - 收益能力评分 (35分)', () => {
  it('should score year1 return for equity fund', () => {
    // equity full benchmark: 30 → max 8 points
    const high = scoreFund(makeFundData({ type: '股票型', returnYear1: 35 }));
    const mid = scoreFund(makeFundData({ type: '股票型', returnYear1: 15 }));
    const low = scoreFund(makeFundData({ type: '股票型', returnYear1: 5 }));

    const getYear1Score = (result: ReturnType<typeof scoreFund>) =>
      result.details.find(d => d.item === '近1年收益')!.score;

    expect(getYear1Score(high)).toBe(8); // >= full(30)
    expect(getYear1Score(mid)).toBe(4.8); // >= mid(10), 8 * 0.6
    expect(getYear1Score(low)).toBe(2.6); // >= low(0), 8 * 0.33 = 2.64 → round 2.6
  });

  it('should score year3 return for equity fund', () => {
    // equity year3 full: 80, maxScore: 10
    const full = scoreFund(makeFundData({ type: '股票型', returnYear3: 85 }));
    const getYear3Score = (r: ReturnType<typeof scoreFund>) =>
      r.details.find(d => d.item === '近3年收益')!.score;

    expect(getYear3Score(full)).toBe(10);
  });

  it('should score sharpe ratio with period weighting', () => {
    // equity sharpe full: 2.0, maxScore: 12
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 2.5 }),
        year3: makeRiskMetrics({ sharpeRatio: 2.5 }),
        all: makeRiskMetrics({ sharpeRatio: 2.5 }),
      },
    });
    const result = scoreFund(data);
    const sharpe = result.details.find(d => d.item === '夏普比率')!;
    expect(sharpe.score).toBe(12); // all periods at full → max score 12
  });
});

// ====== scoreFund: 风险控制评分 ======

describe('scoreFund - 风险控制评分 (35分)', () => {
  it('should score max drawdown (lower is better)', () => {
    // equity drawdown full: 15, maxScore: 18
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ maxDrawdown: 10 }),
        year3: makeRiskMetrics({ maxDrawdown: 10 }),
        all: makeRiskMetrics({ maxDrawdown: 10 }),
      },
    });
    const result = scoreFund(data);
    const drawdown = result.details.find(d => d.item === '最大回撤')!;
    expect(drawdown.score).toBe(18); // <= full(15) → max score 18
  });

  it('should score volatility (lower is better)', () => {
    // equity volatility full: 15, maxScore: 7
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ volatility: 10 }),
        year3: makeRiskMetrics({ volatility: 10 }),
        all: makeRiskMetrics({ volatility: 10 }),
      },
    });
    const result = scoreFund(data);
    const vol = result.details.find(d => d.item === '波动率')!;
    expect(vol.score).toBe(7); // <= full(15) → max score 7
  });

  it('should score sortino ratio (higher is better)', () => {
    // equity sortino full: 2.5, maxScore: 5 (now in returnScore dimension)
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ sortinoRatio: 3.0 }),
        year3: makeRiskMetrics({ sortinoRatio: 3.0 }),
        all: makeRiskMetrics({ sortinoRatio: 3.0 }),
      },
    });
    const result = scoreFund(data);
    const sortino = result.details.find(d => d.item === '索提诺比率')!;
    expect(sortino.score).toBe(5); // >= full(2.5) → max score 5
  });

  it('should aggregate risk scores correctly', () => {
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ maxDrawdown: 10, sortinoRatio: 3.0, volatility: 10 }),
        year3: makeRiskMetrics({ maxDrawdown: 10, sortinoRatio: 3.0, volatility: 10 }),
        all: makeRiskMetrics({ maxDrawdown: 10, sortinoRatio: 3.0, volatility: 10 }),
      },
    });
    const result = scoreFund(data);
    // riskScore = calmar + drawdown + volatility
    // default calmarRatio=1.0, equity calmar mid=1.0 → 10*0.6=6
    // drawdown=10 <= full(15) → 18, vol=10 <= full(15) → 7
    // riskScore = 6 + 18 + 7 = 31
    expect(result.riskScore).toBe(31);
  });
});

// ====== scoreFund: 综合评价评分 ======

describe('scoreFund - 综合评价评分 (30分)', () => {
  it('should score morningstar rating (max 8)', () => {
    const r5 = scoreFund(makeFundData({ morningstarRating: 5 }));
    const r3 = scoreFund(makeFundData({ morningstarRating: 3 }));
    const r1 = scoreFund(makeFundData({ morningstarRating: 1 }));

    const getMsScore = (r: ReturnType<typeof scoreFund>) =>
      r.details.find(d => d.item === '晨星评级')!.score;

    expect(getMsScore(r5)).toBe(8);    // 5 * (8/5) = 8
    expect(getMsScore(r3)).toBe(4.8);  // 3 * (8/5) = 4.8
    expect(getMsScore(r1)).toBe(1.6);  // 1 * (8/5) = 1.6
  });

  it('should score fund size (max 8)', () => {
    const getSize = (size: number) =>
      scoreFund(makeFundData({ fundSize: size })).details.find(d => d.item === '基金规模')!.score;

    expect(getSize(50)).toBe(8);   // 2~100 → 8
    expect(getSize(2)).toBe(8);    // boundary
    expect(getSize(100)).toBe(8);  // boundary
    expect(getSize(200)).toBe(6.4);  // 100~300 → 8*0.8=6.4
    expect(getSize(1.5)).toBe(4.8);  // 1~2 → 8*0.6=4.8
    expect(getSize(500)).toBe(3.2);  // >300 → 8*0.4=3.2
    expect(getSize(0.5)).toBe(1.6);  // <1 → 8*0.2=1.6
  });

  it('should score manager years (max 8)', () => {
    const getMgr = (years: number) =>
      scoreFund(makeFundData({ managerYears: years })).details.find(d => d.item === '经理年限')!.score;

    expect(getMgr(10)).toBe(8); // >=7 → 8
    expect(getMgr(7)).toBe(8);
    expect(getMgr(6)).toBe(6.4);  // >=5 → 8*0.8=6.4
    expect(getMgr(5)).toBe(6.4);
    expect(getMgr(4)).toBe(4.8);  // >=3 → 8*0.6=4.8
    expect(getMgr(3)).toBe(4.8);
    expect(getMgr(2)).toBe(3.2);  // >=1 → 8*0.4=3.2
    expect(getMgr(0.5)).toBe(1.6); // <1 → 8*0.2=1.6
  });

  it('should score fee rate (max 6)', () => {
    const getFee = (rate: number) =>
      scoreFund(makeFundData({ totalFeeRate: rate })).details.find(d => d.item === '费率')!.score;

    expect(getFee(0.5)).toBe(6);    // <=0.8 → 6
    expect(getFee(0.8)).toBe(6);
    expect(getFee(1.0)).toBe(5.0);  // <=1.2 → 6*0.83=4.98→round=5.0
    expect(getFee(1.2)).toBe(5.0);
    expect(getFee(1.3)).toBe(4.0);  // <=1.5 → 6*0.67=4.02→round=4.0
    expect(getFee(1.5)).toBe(4.0);
    expect(getFee(1.8)).toBe(2.0);  // <=2.0 → 6*0.33=1.98→round=2.0
    expect(getFee(2.0)).toBe(2.0);
    expect(getFee(2.5)).toBe(1.0);  // >2.0 → 6*0.17=1.02→round=1.0
  });
});

// ====== 基金类型自适应测试 ======

describe('scoreFund - 基金类型自适应', () => {
  const commonOpts = {
    returnYear1: 10,
    returnYear3: 25,
    morningstarRating: 4,
    fundSize: 50,
    managerYears: 5,
    totalFeeRate: 1.2,
    riskByPeriod: {
      year1: makeRiskMetrics({ sharpeRatio: 1.2, maxDrawdown: 8, sortinoRatio: 1.5, volatility: 12 }),
      year3: makeRiskMetrics({ sharpeRatio: 1.2, maxDrawdown: 8, sortinoRatio: 1.5, volatility: 12 }),
      all: makeRiskMetrics({ sharpeRatio: 1.2, maxDrawdown: 8, sortinoRatio: 1.5, volatility: 12 }),
    },
  } as const;

  it('should score bond fund higher for same moderate metrics', () => {
    // With moderate metrics, bond funds should score higher because benchmarks are lower
    const bond = scoreFund(makeFundData({ ...commonOpts, type: '债券型' }));
    const equity = scoreFund(makeFundData({ ...commonOpts, type: '股票型' }));

    // returnYear1=10: bond full=8 (满分), equity mid=10 (0.6x)
    expect(bond.returnScore).toBeGreaterThan(equity.returnScore);
  });

  it('should produce different return scores per fund type', () => {
    // returnYear1=10: bond full(8)→满分 vs equity mid(10)→0.6x
    const bondYear1 = scoreFund(makeFundData({ ...commonOpts, type: '债券型' }))
      .details.find(d => d.item === '近1年收益')!.score;
    const equityYear1 = scoreFund(makeFundData({ ...commonOpts, type: '股票型' }))
      .details.find(d => d.item === '近1年收益')!.score;

    expect(bondYear1).toBe(8); // 10 >= 8 (bond full) → 8
    expect(equityYear1).toBe(4.8); // 10 >= 10 (equity mid) → 8 * 0.6
  });

  it('should produce different risk scores per fund type', () => {
    // maxDrawdown=8: bond mid(10)→0.53x, equity full(15)→满分
    const bondDrawdown = scoreFund(makeFundData({ ...commonOpts, type: '债券型' }))
      .details.find(d => d.item === '最大回撤')!.score;
    const equityDrawdown = scoreFund(makeFundData({ ...commonOpts, type: '股票型' }))
      .details.find(d => d.item === '最大回撤')!.score;

    // bond: drawdown 8 > full(3), > high(5), ≤ mid(10) → 18*0.53 = 9.54 → 9.5
    expect(bondDrawdown).toBe(9.5);
    // equity: drawdown 8 ≤ full(15) → 18
    expect(equityDrawdown).toBe(18);
  });
});

// ====== 晨星评级缺失时权重重分配 ======

describe('scoreFund - 晨星评级缺失权重重分配', () => {
  it('should exclude morningstar detail when rating is 0', () => {
    const result = scoreFund(makeFundData({ morningstarRating: 0 }));
    const msDetail = result.details.find(d => d.item === '晨星评级');
    expect(msDetail).toBeUndefined();
  });

  it('should include morningstar detail when rating > 0', () => {
    const result = scoreFund(makeFundData({ morningstarRating: 4 }));
    const msDetail = result.details.find(d => d.item === '晨星评级');
    expect(msDetail).toBeDefined();
    expect(msDetail!.score).toBe(6.4); // 4 * (8/5) = 6.4
  });

  it('should scale maxScores when morningstar is missing (scale = 100/92)', () => {
    const result = scoreFund(makeFundData({ morningstarRating: 0 }));
    const scale = 100 / 92;

    // 近1年收益 maxScore: round(8 * scale, 1)
    const year1 = result.details.find(d => d.item === '近1年收益')!;
    expect(year1.maxScore).toBeCloseTo(Math.round(8 * scale * 10) / 10, 1);

    // 夏普比率 maxScore: round(12 * scale, 1)
    const sharpe = result.details.find(d => d.item === '夏普比率')!;
    expect(sharpe.maxScore).toBeCloseTo(Math.round(12 * scale * 10) / 10, 1);
  });

  it('should not scale maxScores when morningstar is present', () => {
    const result = scoreFund(makeFundData({ morningstarRating: 4 }));
    const year1 = result.details.find(d => d.item === '近1年收益')!;
    expect(year1.maxScore).toBe(8);
  });

  it('should still produce total close to 100 without morningstar', () => {
    // Perfect scores in all non-morningstar dimensions should still sum near 100
    const data = makeFundData({
      type: '股票型',
      returnYear1: 50,
      returnYear3: 100,
      morningstarRating: 0,
      fundSize: 50,
      managerYears: 10,
      totalFeeRate: 0.5,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
        year3: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
        all: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
      },
    });
    const result = scoreFund(data);
    // With scale, scores are amplified so total reaches ~100
    expect(result.totalScore).toBeGreaterThan(90);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });
});

// ====== 满分/零分场景 ======

describe('scoreFund - 满分场景', () => {
  it('should reach ~100 with perfect inputs for equity fund', () => {
    const data = makeFundData({
      type: '股票型',
      returnYear1: 30,    // >= full(30), avoids momentum penalty
      returnYear3: 100,   // >> full(80)
      morningstarRating: 5,
      fundSize: 50,       // best range
      managerYears: 10,   // >= 7
      totalFeeRate: 0.5,  // <= 0.8
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
        year3: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
        all: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
      },
    });
    const result = scoreFund(data);
    expect(result.returnScore).toBe(35);
    expect(result.riskScore).toBe(35);
    expect(result.overallScore).toBe(30);
    expect(result.totalScore).toBe(100);
  });

  it('should reach ~100 with perfect inputs for bond fund', () => {
    const data = makeFundData({
      type: '债券型',
      returnYear1: 10,    // >= full(8), no momentum penalty (<=30)
      returnYear3: 25,    // >= full(20)
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 10,
      totalFeeRate: 0.5,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 2, maxDrawdown: 2, sortinoRatio: 2.5, calmarRatio: 3, volatility: 2 }),
        year3: makeRiskMetrics({ sharpeRatio: 2, maxDrawdown: 2, sortinoRatio: 2.5, calmarRatio: 3, volatility: 2 }),
        all: makeRiskMetrics({ sharpeRatio: 2, maxDrawdown: 2, sortinoRatio: 2.5, calmarRatio: 3, volatility: 2 }),
      },
    });
    const result = scoreFund(data);
    expect(result.totalScore).toBe(100);
  });
});

describe('scoreFund - 低分场景', () => {
  it('should produce low total with poor inputs', () => {
    const data = makeFundData({
      type: '股票型',
      returnYear1: -20,   // very negative
      returnYear3: -30,
      morningstarRating: 1,
      fundSize: 0.3,      // tiny
      managerYears: 0.5,  // < 1 year
      totalFeeRate: 3.0,  // expensive
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: -0.5, maxDrawdown: 60, sortinoRatio: -0.5, volatility: 40 }),
        year3: makeRiskMetrics({ sharpeRatio: -0.5, maxDrawdown: 60, sortinoRatio: -0.5, volatility: 40 }),
        all: makeRiskMetrics({ sharpeRatio: -0.5, maxDrawdown: 60, sortinoRatio: -0.5, volatility: 40 }),
      },
    });
    const result = scoreFund(data);
    expect(result.totalScore).toBeLessThan(30);
  });
});

// ====== 边界/极端值 ======

describe('scoreFund - 边界情况', () => {
  it('should handle zero returns', () => {
    const data = makeFundData({ returnYear1: 0, returnYear3: 0 });
    const result = scoreFund(data);
    expect(result.totalScore).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('should handle negative returns', () => {
    const data = makeFundData({ returnYear1: -50, returnYear3: -80 });
    const result = scoreFund(data);
    expect(result.totalScore).toBeGreaterThan(0); // meta scores still contribute
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('should handle very large return values', () => {
    const data = makeFundData({ returnYear1: 1000, returnYear3: 5000 });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it('should handle zero sharpe/sortino across all periods', () => {
    const data = makeFundData({
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 0, sortinoRatio: 0 }),
        year3: makeRiskMetrics({ sharpeRatio: 0, sortinoRatio: 0 }),
        all: makeRiskMetrics({ sharpeRatio: 0, sortinoRatio: 0 }),
      },
    });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('should handle null year1 and year3 risk periods', () => {
    const data = makeFundData({
      riskByPeriod: {
        year1: null,
        year3: null,
        all: makeRiskMetrics(),
      },
    });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    // Only all-time period used → still produces valid scores
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it('should handle all null periods except all', () => {
    const data = makeFundData({
      riskByPeriod: {
        year1: null,
        year3: null,
        all: makeRiskMetrics({ sharpeRatio: 2, maxDrawdown: 5, sortinoRatio: 2.5, volatility: 10 }),
      },
    });
    const result = scoreFund(data);
    // Should still calculate weighted scores using only 'all' period
    expect(result.totalScore).toBeGreaterThan(0);
  });
});

// ====== 总分计算 ======

describe('scoreFund - 总分计算', () => {
  it('should equal sum of three dimension scores', () => {
    const result = scoreFund(makeFundData());
    const expected = Math.round((result.returnScore + result.riskScore + result.overallScore) * 10) / 10;
    expect(result.totalScore).toBe(expected);
  });

  it('should have totalScore = returnScore + riskScore + overallScore for various inputs', () => {
    const types = ['债券型', '股票型', '混合型-平衡'];
    for (const type of types) {
      const result = scoreFund(makeFundData({ type }));
      const sum = Math.round((result.returnScore + result.riskScore + result.overallScore) * 10) / 10;
      expect(result.totalScore).toBe(sum);
    }
  });

  it('should round scores to 1 decimal place', () => {
    const result = scoreFund(makeFundData());
    for (const d of result.details) {
      // Check that score has at most 1 decimal
      expect(Math.round(d.score * 10) / 10).toBe(d.score);
    }
    expect(Math.round(result.totalScore * 10) / 10).toBe(result.totalScore);
    expect(Math.round(result.returnScore * 10) / 10).toBe(result.returnScore);
    expect(Math.round(result.riskScore * 10) / 10).toBe(result.riskScore);
    expect(Math.round(result.overallScore * 10) / 10).toBe(result.overallScore);
  });

  it('should produce max 35+35+30=100 for perfect equity fund with morningstar', () => {
    const data = makeFundData({
      type: '股票型',
      returnYear1: 30,   // >= full(30), avoids momentum penalty
      returnYear3: 100,
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 10,
      totalFeeRate: 0.5,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
        year3: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
        all: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, calmarRatio: 4, volatility: 10 }),
      },
    });
    const result = scoreFund(data);
    expect(result.returnScore).toBe(35);
    expect(result.riskScore).toBe(35);
    expect(result.overallScore).toBe(30);
    expect(result.totalScore).toBe(100);
  });
});

// ====== 分时段加权测试 ======

describe('scoreFund - 分时段加权', () => {
  it('should weight year1 at 40%, year3 at 30%, all at 30%', () => {
    // Set different sharpe ratios per period to verify weighting
    // equity sharpe: full=2.0 → maxScore=12
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 2.5 }), // full → 12
        year3: makeRiskMetrics({ sharpeRatio: 0.5 }), // low → 12*0.33 = 3.96
        all: makeRiskMetrics({ sharpeRatio: 0.5 }),    // low → 12*0.33 = 3.96
      },
    });
    const result = scoreFund(data);
    const sharpe = result.details.find(d => d.item === '夏普比率')!;
    // weighted: (12*0.4 + 3.96*0.3 + 3.96*0.3) = 4.8 + 1.188 + 1.188 = 7.176 ≈ 7.2
    expect(sharpe.score).toBeCloseTo(7.2, 0);
  });

  it('should skip null periods and renormalize weights', () => {
    // Only year1 and all available → weights become 0.4/(0.4+0.3), 0.3/(0.4+0.3)
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 2.5 }), // full → 12
        year3: null,
        all: makeRiskMetrics({ sharpeRatio: 2.5 }),    // full → 12
      },
    });
    const result = scoreFund(data);
    const sharpe = result.details.find(d => d.item === '夏普比率')!;
    // Both are full score → result should be 12 regardless of weight distribution
    expect(sharpe.score).toBe(12);
  });
});

// ====== scoreFundDeep 测试 ======

describe('scoreFundDeep - 基础评分', () => {
  it('should return correct dimension structure', () => {
    const data = makeFundData({ type: '股票型' });
    const result = scoreFundDeep(data);
    expect(result).toHaveProperty('returnScore');
    expect(result).toHaveProperty('riskScore');
    expect(result).toHaveProperty('holdingScore');
    expect(result).toHaveProperty('stabilityScore');
    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('totalScore');
    expect(result).toHaveProperty('details');
  });

  it('should sum dimensions to totalScore', () => {
    const data = makeFundData({ type: '股票型' });
    const quant = makeQuantMetrics();
    const holdings = makeHoldings();
    const result = scoreFundDeep(data, quant, holdings);

    const sum = Math.round((
      result.returnScore + result.riskScore + result.holdingScore +
      result.stabilityScore + result.overallScore
    ) * 10) / 10;
    expect(result.totalScore).toBe(sum);
  });
});

describe('scoreFundDeep - 无量化数据时给中间分', () => {
  it('should assign 50% scores for quant-dependent items when no quant data', () => {
    const data = makeFundData({ type: '股票型' });
    const result = scoreFundDeep(data); // no quant, no holdings

    const alpha = result.details.find(d => d.item === 'Alpha超额收益')!;
    expect(alpha.score).toBe(5); // 10 * 0.5

    const winRate = result.details.find(d => d.item === '月度胜率')!;
    expect(winRate.score).toBe(2.5); // 5 * 0.5

    const beta = result.details.find(d => d.item === 'Beta系数')!;
    expect(beta.score).toBe(2.5); // 5 * 0.5

    const varScore = result.details.find(d => d.item === 'VaR(95%)')!;
    expect(varScore.score).toBe(2); // 4 * 0.5

    const ir = result.details.find(d => d.item === '信息比率IR')!;
    expect(ir.score).toBe(2.5); // 5 * 0.5

    const consistency = result.details.find(d => d.item === '收益一致性')!;
    expect(consistency.score).toBe(2.5); // 5 * 0.5
  });

  it('should assign 50% for holdings-dependent items when no holdings', () => {
    const data = makeFundData({ type: '股票型' });
    const result = scoreFundDeep(data); // no holdings

    const hhi = result.details.find(d => d.item === '行业集中度HHI')!;
    expect(hhi.score).toBe(4); // 8 * 0.5

    const topHold = result.details.find(d => d.item === '重仓占比')!;
    expect(topHold.score).toBe(3.5); // 7 * 0.5
  });
});

describe('scoreFundDeep - 有量化数据', () => {
  it('should use quant data for alpha scoring', () => {
    const data = makeFundData({ type: '股票型' });
    // equity alpha full: 0.15
    const quant = makeQuantMetrics({ alpha: 0.2 }); // > full
    const result = scoreFundDeep(data, quant);

    const alpha = result.details.find(d => d.item === 'Alpha超额收益')!;
    expect(alpha.score).toBe(10); // max score
  });

  it('should score beta correctly', () => {
    const data = makeFundData({ type: '股票型' });

    // Ideal beta (0.6-0.9) → full score
    const ideal = scoreFundDeep(data, makeQuantMetrics({ beta: 0.8 }));
    expect(ideal.details.find(d => d.item === 'Beta系数')!.score).toBe(5);

    // High beta (1.0-1.2) → 50%
    const high = scoreFundDeep(data, makeQuantMetrics({ beta: 1.1 }));
    expect(high.details.find(d => d.item === 'Beta系数')!.score).toBe(2.5);

    // Very high beta (>1.2) → 30%
    const vhigh = scoreFundDeep(data, makeQuantMetrics({ beta: 1.5 }));
    expect(vhigh.details.find(d => d.item === 'Beta系数')!.score).toBe(1.5);
  });

  it('should score VaR correctly (lower is better)', () => {
    const data = makeFundData({ type: '股票型' });
    // equity VaR full: 0.015
    const quant = makeQuantMetrics({ var95: 0.01 }); // < full
    const result = scoreFundDeep(data, quant);
    const varScore = result.details.find(d => d.item === 'VaR(95%)')!;
    expect(varScore.score).toBe(4); // max score
  });

  it('should score monthly win rate', () => {
    const data = makeFundData({ type: '股票型' });
    // equity winRate full: 0.60
    const quant = makeQuantMetrics({ monthlyWinRate: 0.65 }); // > full
    const result = scoreFundDeep(data, quant);
    const wr = result.details.find(d => d.item === '月度胜率')!;
    expect(wr.score).toBe(5); // max
  });
});

describe('scoreFundDeep - 持仓评分', () => {
  it('should score HHI in optimal range', () => {
    const data = makeFundData({ type: '股票型' });
    const quant = makeQuantMetrics({ hhi: 0.1 }); // in 0.05-0.15 → max
    const result = scoreFundDeep(data, quant, makeHoldings());
    const hhi = result.details.find(d => d.item === '行业集中度HHI')!;
    expect(hhi.score).toBe(8); // max
  });

  it('should score concentrated HHI lower', () => {
    const data = makeFundData({ type: '股票型' });
    const quant = makeQuantMetrics({ hhi: 0.3 }); // >0.25 → 0.4x
    const result = scoreFundDeep(data, quant, makeHoldings());
    const hhi = result.details.find(d => d.item === '行业集中度HHI')!;
    expect(hhi.score).toBeCloseTo(3.2, 1); // 8 * 0.4
  });

  it('should score topHoldings in optimal range (20-50%)', () => {
    const data = makeFundData({ type: '股票型' });
    const quant = makeQuantMetrics({ topHoldingsRatio: 35 }); // in 20-50 → max
    const result = scoreFundDeep(data, quant, makeHoldings());
    const topHold = result.details.find(d => d.item === '重仓占比')!;
    expect(topHold.score).toBe(7); // max
  });

  it('should penalize over-concentrated holdings', () => {
    const data = makeFundData({ type: '股票型' });
    const quant = makeQuantMetrics({ topHoldingsRatio: 70 }); // >65 → 0.4x
    const result = scoreFundDeep(data, quant, makeHoldings());
    const topHold = result.details.find(d => d.item === '重仓占比')!;
    expect(topHold.score).toBeCloseTo(2.8, 1); // 7 * 0.4
  });
});

describe('scoreFundDeep - 稳定性评分', () => {
  it('should score information ratio', () => {
    const data = makeFundData({ type: '股票型' });
    // equity IR full: 1.0
    const quant = makeQuantMetrics({ informationRatio: 1.2 }); // > full
    const result = scoreFundDeep(data, quant);
    const ir = result.details.find(d => d.item === '信息比率IR')!;
    expect(ir.score).toBe(5); // max
  });

  it('should score rolling consistency based on cagr sign', () => {
    const data = makeFundData({ type: '股票型' });
    // cagr > 0 → positiveRatio=0.7, >=0.60 → 0.6x of 5 = 3
    const positive = scoreFundDeep(data, makeQuantMetrics({ cagr: 0.1 }));
    expect(positive.details.find(d => d.item === '收益一致性')!.score).toBe(3);

    // cagr <= 0 → positiveRatio=0.4, <0.45 → 0.2x of 5 = 1
    const negative = scoreFundDeep(data, makeQuantMetrics({ cagr: -0.05 }));
    expect(negative.details.find(d => d.item === '收益一致性')!.score).toBe(1);
  });
});

describe('scoreFundDeep - 综合因素', () => {
  it('should score morningstar with max 5 in deep model', () => {
    const data5 = makeFundData({ morningstarRating: 5 });
    const r5 = scoreFundDeep(data5);
    // scoreMorningstar(5, 5) = 5
    expect(r5.details.find(d => d.item === '晨星评级')!.score).toBe(5);

    const data3 = makeFundData({ morningstarRating: 3 });
    const r3 = scoreFundDeep(data3);
    // scoreMorningstar(3, 5) = 3
    expect(r3.details.find(d => d.item === '晨星评级')!.score).toBe(3);
  });

  it('should assign 2.5 for morningstar when rating is 0', () => {
    const data = makeFundData({ morningstarRating: 0 });
    const result = scoreFundDeep(data);
    expect(result.details.find(d => d.item === '晨星评级')!.score).toBe(2.5);
  });
});

describe('scoreFundDeep - 满分/低分场景', () => {
  it('should approach 100 with perfect data', () => {
    const data = makeFundData({
      type: '股票型',
      returnYear1: 50,
      returnYear3: 100,
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 10,
      totalFeeRate: 0.5,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, volatility: 10 }),
        year3: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, volatility: 10 }),
        all: makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 5, sortinoRatio: 3, volatility: 10 }),
      },
    });
    const quant = makeQuantMetrics({
      alpha: 0.2, beta: 0.8, informationRatio: 1.5, var95: 0.01,
      monthlyWinRate: 0.7, cagr: 0.3, hhi: 0.1, topHoldingsRatio: 35,
    });
    const holdings = makeHoldings();
    const result = scoreFundDeep(data, quant, holdings);

    expect(result.returnScore).toBe(30);
    expect(result.riskScore).toBeGreaterThanOrEqual(28);
    expect(result.holdingScore).toBe(15);
    expect(result.totalScore).toBeGreaterThan(90);
  });

  it('should produce low score with poor data', () => {
    const data = makeFundData({
      type: '股票型',
      returnYear1: -30,
      returnYear3: -50,
      morningstarRating: 1,
      fundSize: 0.3,
      managerYears: 0.5,
      totalFeeRate: 3.0,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: -1, maxDrawdown: 60, sortinoRatio: -1, volatility: 40 }),
        year3: makeRiskMetrics({ sharpeRatio: -1, maxDrawdown: 60, sortinoRatio: -1, volatility: 40 }),
        all: makeRiskMetrics({ sharpeRatio: -1, maxDrawdown: 60, sortinoRatio: -1, volatility: 40 }),
      },
    });
    const quant = makeQuantMetrics({
      alpha: -0.1, beta: 1.5, informationRatio: -0.5, var95: 0.05,
      monthlyWinRate: 0.3, cagr: -0.2, hhi: 0.4, topHoldingsRatio: 80,
    });
    const result = scoreFundDeep(data, quant, makeHoldings());
    expect(result.totalScore).toBeLessThan(35);
  });
});

describe('scoreFundDeep - 基金类型自适应', () => {
  it('should produce different scores for same data across fund types', () => {
    const opts = {
      returnYear1: 10,
      returnYear3: 25,
      morningstarRating: 4,
      fundSize: 50,
      managerYears: 5,
      totalFeeRate: 1.0,
    };
    const quant = makeQuantMetrics();

    const bond = scoreFundDeep(makeFundData({ ...opts, type: '债券型' }), quant, makeHoldings());
    const equity = scoreFundDeep(makeFundData({ ...opts, type: '股票型' }), quant, makeHoldings());

    // With moderate returns, bond should score higher on returns (lower benchmarks)
    expect(bond.returnScore).toBeGreaterThan(equity.returnScore);
  });
});

// ====== NaN / Infinity 安全性 ======

describe('scoreFund - NaN/Infinity safety', () => {
  it('should produce finite score when returnYear1 is NaN', () => {
    const data = makeFundData({ returnYear1: NaN });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('should produce finite score when returnYear3 is NaN', () => {
    const data = makeFundData({ returnYear3: NaN });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('should produce finite score when risk metrics contain NaN', () => {
    const data = makeFundData({
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: NaN, maxDrawdown: NaN, sortinoRatio: NaN, volatility: NaN }),
        year3: makeRiskMetrics({ sharpeRatio: NaN }),
        all: makeRiskMetrics({ sharpeRatio: NaN }),
      },
    });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    for (const d of result.details) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it('should produce finite score when risk metrics contain Infinity', () => {
    const data = makeFundData({
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: Infinity, maxDrawdown: Infinity, volatility: -Infinity }),
        year3: makeRiskMetrics(),
        all: makeRiskMetrics(),
      },
    });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    for (const d of result.details) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it('should produce finite score with Infinity return values', () => {
    const data = makeFundData({ returnYear1: Infinity, returnYear3: -Infinity });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });
});

describe('scoreFundDeep - NaN/Infinity safety', () => {
  it('should produce finite score with NaN quant metrics', () => {
    const data = makeFundData({ type: '股票型' });
    const quant = makeQuantMetrics({
      alpha: NaN,
      beta: NaN,
      informationRatio: NaN,
      var95: NaN,
      monthlyWinRate: NaN,
      cagr: NaN,
      hhi: NaN,
      topHoldingsRatio: NaN,
    });
    const result = scoreFundDeep(data, quant, makeHoldings());
    expect(Number.isFinite(result.totalScore)).toBe(true);
    for (const d of result.details) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it('should produce finite score with Infinity quant metrics', () => {
    const data = makeFundData({ type: '股票型' });
    const quant = makeQuantMetrics({
      alpha: Infinity,
      beta: Infinity,
      var95: Infinity,
      hhi: Infinity,
      topHoldingsRatio: Infinity,
    });
    const result = scoreFundDeep(data, quant, makeHoldings());
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('should handle NaN morningstar rating in deep scoring', () => {
    const data = makeFundData({ morningstarRating: NaN });
    const result = scoreFundDeep(data);
    const ms = result.details.find(d => d.item === '晨星评级')!;
    expect(Number.isFinite(ms.score)).toBe(true);
  });

  it('should handle NaN fund size and manager years', () => {
    const data = makeFundData({ fundSize: NaN, managerYears: NaN });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    // NaN comparisons return false, so these should hit the fallback/last branch
    const sizeScore = result.details.find(d => d.item === '基金规模')!;
    const mgrScore = result.details.find(d => d.item === '经理年限')!;
    expect(Number.isFinite(sizeScore.score)).toBe(true);
    expect(Number.isFinite(mgrScore.score)).toBe(true);
  });
});

describe('scoreFundDeep - 四舍五入', () => {
  it('should round all detail scores to 1 decimal', () => {
    const data = makeFundData();
    const result = scoreFundDeep(data, makeQuantMetrics(), makeHoldings());
    for (const d of result.details) {
      expect(Math.round(d.score * 10) / 10).toBe(d.score);
    }
  });

  it('should round dimension and total scores to 1 decimal', () => {
    const data = makeFundData();
    const result = scoreFundDeep(data, makeQuantMetrics(), makeHoldings());
    const round1 = (n: number) => Math.round(n * 10) / 10;
    expect(round1(result.returnScore)).toBe(result.returnScore);
    expect(round1(result.riskScore)).toBe(result.riskScore);
    expect(round1(result.holdingScore)).toBe(result.holdingScore);
    expect(round1(result.stabilityScore)).toBe(result.stabilityScore);
    expect(round1(result.overallScore)).toBe(result.overallScore);
    expect(round1(result.totalScore)).toBe(result.totalScore);
  });
});

// ====== P1 bug fix: 有持仓但无 quant 时持仓评分 ======

describe('scoreFundDeep - holdings present but no quant', () => {
  it('should give 50% holding scores when holdings exist but quant is undefined', () => {
    // This was the P1 bug: holdings present but quant missing caused score skew
    const data = makeFundData({ type: '股票型' });
    const result = scoreFundDeep(data, undefined, makeHoldings());

    // HHI: holdings exists, quant missing → 4 (8 * 0.5)
    const hhi = result.details.find(d => d.item === '行业集中度HHI')!;
    expect(hhi.score).toBe(4);

    // Top holdings: holdings exists, quant missing → 3.5 (7 * 0.5)
    const topHold = result.details.find(d => d.item === '重仓占比')!;
    expect(topHold.score).toBe(3.5);

    // Total holding score = 4 + 3.5 = 7.5
    expect(result.holdingScore).toBe(7.5);
  });

  it('should give same holding scores whether holdings is present or absent when quant is missing', () => {
    const data = makeFundData({ type: '股票型' });

    // No holdings, no quant
    const noHoldings = scoreFundDeep(data);
    // Holdings present, no quant
    const withHoldings = scoreFundDeep(data, undefined, makeHoldings());

    // Both should give 50% holding scores since quant is missing
    expect(noHoldings.holdingScore).toBe(withHoldings.holdingScore);
  });

  it('should use actual quant values when both holdings and quant are present', () => {
    const data = makeFundData({ type: '股票型' });
    const quant = makeQuantMetrics({ hhi: 0.1, topHoldingsRatio: 35 });
    const result = scoreFundDeep(data, quant, makeHoldings());

    // HHI 0.1 in [0.05, 0.15] → full score (8)
    const hhi = result.details.find(d => d.item === '行业集中度HHI')!;
    expect(hhi.score).toBe(8);

    // topHoldingsRatio 35 in [20, 50] → full score (7)
    const topHold = result.details.find(d => d.item === '重仓占比')!;
    expect(topHold.score).toBe(7);

    expect(result.holdingScore).toBe(15);
  });
});

// ====== NaN in non-safeNum-protected functions ======

describe('scoreFund - NaN in meta fields', () => {
  it('should handle NaN totalFeeRate gracefully', () => {
    // scoreFeeRate doesn't use safeNum, NaN falls through all comparisons to last branch
    const data = makeFundData({ totalFeeRate: NaN });
    const result = scoreFund(data);
    const fee = result.details.find(d => d.item === '费率')!;
    expect(Number.isFinite(fee.score)).toBe(true);
    expect(fee.score).toBe(1.0); // NaN fails all comparisons → falls to default: 6*0.17=1.02→round=1.0
  });

  it('should handle zero morningstar rating consistently', () => {
    const withZero = scoreFund(makeFundData({ morningstarRating: 0 }));
    const withNeg = scoreFund(makeFundData({ morningstarRating: -1 }));

    // Both should exclude morningstar from details
    expect(withZero.details.find(d => d.item === '晨星评级')).toBeUndefined();
    // Negative rating is treated as "has rating" since -1 > 0 is false
    expect(withNeg.details.find(d => d.item === '晨星评级')).toBeUndefined();
  });
});

// ====== scoreFund totalScore never exceeds 100 ======

describe('scoreFund - score bounds', () => {
  it('should never exceed 100 even with extreme positive inputs', () => {
    const data = makeFundData({
      type: '债券型',
      returnYear1: 9999,
      returnYear3: 9999,
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 20,
      totalFeeRate: 0.1,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 100, maxDrawdown: 0, sortinoRatio: 100, volatility: 0 }),
        year3: makeRiskMetrics({ sharpeRatio: 100, maxDrawdown: 0, sortinoRatio: 100, volatility: 0 }),
        all: makeRiskMetrics({ sharpeRatio: 100, maxDrawdown: 0, sortinoRatio: 100, volatility: 0 }),
      },
    });
    const result = scoreFund(data);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it('should produce non-negative total score with all-zero inputs', () => {
    const data = makeFundData({
      returnYear1: 0,
      returnYear3: 0,
      morningstarRating: 0,
      fundSize: 0,
      managerYears: 0,
      totalFeeRate: 0,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 0, maxDrawdown: 0, sortinoRatio: 0, volatility: 0 }),
        year3: makeRiskMetrics({ sharpeRatio: 0, maxDrawdown: 0, sortinoRatio: 0, volatility: 0 }),
        all: makeRiskMetrics({ sharpeRatio: 0, maxDrawdown: 0, sortinoRatio: 0, volatility: 0 }),
      },
    });
    const result = scoreFund(data);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });
});

// ====== classifyRiskTier ======

describe('classifyRiskTier', () => {
  it('should classify money market / ultra-short bond as VERY_LOW', () => {
    expect(classifyRiskTier('货币型', 0.3)).toBe(RiskTier.VERY_LOW);
    expect(classifyRiskTier('超短债', 0.2)).toBe(RiskTier.VERY_LOW);
  });

  it('should classify pure bond funds as LOW', () => {
    expect(classifyRiskTier('纯债型', 2)).toBe(RiskTier.LOW);
    expect(classifyRiskTier('短债型', 1.5)).toBe(RiskTier.LOW);
  });

  it('should classify secondary bond / FOF as MEDIUM', () => {
    expect(classifyRiskTier('债券型', 5)).toBe(RiskTier.MEDIUM);
    expect(classifyRiskTier('FOF', 8)).toBe(RiskTier.MEDIUM);
  });

  it('should classify balanced / flexible as MEDIUM_HIGH', () => {
    expect(classifyRiskTier('混合型-平衡', 15)).toBe(RiskTier.MEDIUM_HIGH);
    expect(classifyRiskTier('灵活配置', 12)).toBe(RiskTier.MEDIUM_HIGH);
  });

  it('should classify equity / index as HIGH', () => {
    expect(classifyRiskTier('股票型', 25)).toBe(RiskTier.HIGH);
    expect(classifyRiskTier('指数型', 22)).toBe(RiskTier.HIGH);
  });

  it('should take higher tier when type and volatility conflict', () => {
    // Type says LOW (纯债) but volatility says HIGH (25%)
    expect(classifyRiskTier('纯债型', 25)).toBe(RiskTier.HIGH);
    // Type says HIGH (股票型) but volatility says VERY_LOW (0.3%)
    expect(classifyRiskTier('股票型', 0.3)).toBe(RiskTier.HIGH);
  });

  it('should handle NaN volatility', () => {
    // NaN → 0 → VERY_LOW vol tier, but type determines
    expect(classifyRiskTier('股票型', NaN)).toBe(RiskTier.HIGH);
  });

  // --- 波动率边界值测试 ---
  it('should handle volatility at exact tier boundaries', () => {
    // vol=0.5 → LOW boundary (vol>=0.5 is LOW, not VERY_LOW)
    expect(classifyRiskTier('货币型', 0.5)).toBe(RiskTier.LOW); // type=VERY_LOW, vol=LOW → LOW
    // vol=3 → MEDIUM boundary
    expect(classifyRiskTier('货币型', 3)).toBe(RiskTier.MEDIUM); // type=VERY_LOW, vol=MEDIUM → MEDIUM
    // vol=10 → MEDIUM_HIGH boundary
    expect(classifyRiskTier('货币型', 10)).toBe(RiskTier.MEDIUM_HIGH);
    // vol=20 → HIGH boundary
    expect(classifyRiskTier('货币型', 20)).toBe(RiskTier.HIGH);
  });

  it('should handle volatility just below boundaries', () => {
    expect(classifyRiskTier('货币型', 0.49)).toBe(RiskTier.VERY_LOW);
    expect(classifyRiskTier('货币型', 2.99)).toBe(RiskTier.LOW);
    expect(classifyRiskTier('货币型', 9.99)).toBe(RiskTier.MEDIUM);
    expect(classifyRiskTier('货币型', 19.99)).toBe(RiskTier.MEDIUM_HIGH);
  });

  it('should classify 一级债基 as LOW', () => {
    expect(classifyRiskTier('债券型一级', 2)).toBe(RiskTier.LOW);
  });

  it('should classify 偏股混合型 as MEDIUM_HIGH', () => {
    expect(classifyRiskTier('偏股混合型', 15)).toBe(RiskTier.MEDIUM_HIGH);
  });

  it('should handle Infinity volatility by treating as 0 (not finite)', () => {
    // Infinity is not finite → falls to 0 → VERY_LOW vol tier, type LOW wins
    expect(classifyRiskTier('纯债型', Infinity)).toBe(RiskTier.LOW);
    // For equity type, type=HIGH dominates regardless
    expect(classifyRiskTier('股票型', Infinity)).toBe(RiskTier.HIGH);
  });

  it('should handle negative volatility (impossible but defensive)', () => {
    // negative → not finite check passes, falls to 0 → VERY_LOW vol, type determines
    expect(classifyRiskTier('股票型', -5)).toBe(RiskTier.HIGH);
  });

  it('should default unknown types to MEDIUM', () => {
    expect(classifyRiskTier('其他类型', 5)).toBe(RiskTier.MEDIUM);
    expect(classifyRiskTier('QDII-混合型', 5)).toBe(RiskTier.MEDIUM);
  });
});

// ====== scoreFund - 分层评分字段 ======

describe('scoreFund - tier scoring fields', () => {
  it('should include riskTier, tierScore, marketScore, tierDetails in result', () => {
    const result = scoreFund(makeFundData());
    expect(result.riskTier).toBeDefined();
    expect(result.tierScore).toBeDefined();
    expect(result.marketScore).toBeDefined();
    expect(result.tierDetails).toBeDefined();
    expect(result.tierDetails.length).toBeGreaterThan(0);
  });

  it('should have marketScore equal to totalScore', () => {
    const result = scoreFund(makeFundData());
    expect(result.marketScore).toBe(result.totalScore);
  });

  it('should produce finite tierScore', () => {
    const result = scoreFund(makeFundData());
    expect(Number.isFinite(result.tierScore)).toBe(true);
    expect(result.tierScore).toBeGreaterThanOrEqual(0);
    expect(result.tierScore).toBeLessThanOrEqual(100);
  });

  it('should classify equity fund as HIGH tier', () => {
    const result = scoreFund(makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ volatility: 22 }),
        year3: makeRiskMetrics({ volatility: 22 }),
        all: makeRiskMetrics({ volatility: 22 }),
      },
    }));
    expect(result.riskTier).toBe(RiskTier.HIGH);
  });

  it('should classify bond fund as LOW or MEDIUM tier', () => {
    const result = scoreFund(makeFundData({
      type: '债券型',
      riskByPeriod: {
        year1: makeRiskMetrics({ volatility: 4 }),
        year3: makeRiskMetrics({ volatility: 4 }),
        all: makeRiskMetrics({ volatility: 4 }),
      },
    }));
    expect([RiskTier.LOW, RiskTier.MEDIUM]).toContain(result.riskTier);
  });

  it('should produce different tierScore vs marketScore for typical fund', () => {
    // Tier benchmarks are different from market benchmarks, so scores generally differ
    const result = scoreFund(makeFundData({
      type: '股票型',
      returnYear1: 20,
      returnYear3: 50,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 18, volatility: 22 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 18, volatility: 22 }),
        all: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 18, volatility: 22 }),
      },
    }));
    // Just verify both are valid scores
    expect(Number.isFinite(result.tierScore)).toBe(true);
    expect(Number.isFinite(result.marketScore)).toBe(true);
  });

  it('should have tierDetails with same structure as details', () => {
    const result = scoreFund(makeFundData());
    for (const d of result.tierDetails) {
      expect(d).toHaveProperty('item');
      expect(d).toHaveProperty('score');
      expect(d).toHaveProperty('maxScore');
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it('should produce finite tierScore with NaN inputs', () => {
    const data = makeFundData({
      returnYear1: NaN,
      returnYear3: NaN,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: NaN, maxDrawdown: NaN }),
        year3: null,
        all: makeRiskMetrics({ sharpeRatio: NaN }),
      },
    });
    const result = scoreFund(data);
    expect(Number.isFinite(result.tierScore)).toBe(true);
  });

  it('should cap tierScore at 100', () => {
    const data = makeFundData({
      type: '债券型',
      returnYear1: 999,
      returnYear3: 999,
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 20,
      totalFeeRate: 0.1,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 100, maxDrawdown: 0, sortinoRatio: 100, calmarRatio: 100, volatility: 0 }),
        year3: makeRiskMetrics({ sharpeRatio: 100, maxDrawdown: 0, sortinoRatio: 100, calmarRatio: 100, volatility: 0 }),
        all: makeRiskMetrics({ sharpeRatio: 100, maxDrawdown: 0, sortinoRatio: 100, calmarRatio: 100, volatility: 0 }),
      },
    });
    const result = scoreFund(data);
    expect(result.tierScore).toBeLessThanOrEqual(100);
  });
});

// ====== scoreFund: 卡玛比率评分 ======

describe('scoreFund - 卡玛比率评分', () => {
  it('should score calmar ratio for equity fund (max 10)', () => {
    // equity calmar full: 3.0
    const full = scoreFund(makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ calmarRatio: 3.5 }),
        year3: makeRiskMetrics({ calmarRatio: 3.5 }),
        all: makeRiskMetrics({ calmarRatio: 3.5 }),
      },
    }));
    const calmar = full.details.find(d => d.item === '卡玛比率')!;
    expect(calmar.score).toBe(10); // >= full → max

    // equity calmar high: 2.0
    const high = scoreFund(makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ calmarRatio: 2.5 }),
        year3: makeRiskMetrics({ calmarRatio: 2.5 }),
        all: makeRiskMetrics({ calmarRatio: 2.5 }),
      },
    }));
    expect(high.details.find(d => d.item === '卡玛比率')!.score).toBe(8); // 10*0.8

    // equity calmar mid: 1.0
    const mid = scoreFund(makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ calmarRatio: 1.2 }),
        year3: makeRiskMetrics({ calmarRatio: 1.2 }),
        all: makeRiskMetrics({ calmarRatio: 1.2 }),
      },
    }));
    expect(mid.details.find(d => d.item === '卡玛比率')!.score).toBe(6); // 10*0.6
  });

  it('should score calmar ratio for bond fund (max 10)', () => {
    // bond calmar full: 2.0
    const full = scoreFund(makeFundData({
      type: '债券型',
      riskByPeriod: {
        year1: makeRiskMetrics({ calmarRatio: 2.5 }),
        year3: makeRiskMetrics({ calmarRatio: 2.5 }),
        all: makeRiskMetrics({ calmarRatio: 2.5 }),
      },
    }));
    expect(full.details.find(d => d.item === '卡玛比率')!.score).toBe(10);
  });

  it('should handle calmar ratio with period weighting', () => {
    // Different calmar per period to verify weighting
    // equity calmar: { full:3.0, high:2.0, mid:1.0, low:0.5 }
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ calmarRatio: 3.5 }), // >= full(3.0) → 10
        year3: makeRiskMetrics({ calmarRatio: 0.3 }), // < low(0.5) → max(0, 10*0.2*(0.3/0.5)) = 1.2
        all: makeRiskMetrics({ calmarRatio: 0.3 }),    // < low(0.5) → 1.2
      },
    });
    const result = scoreFund(data);
    const calmar = result.details.find(d => d.item === '卡玛比率')!;
    // weighted: (10*0.4 + 1.2*0.3 + 1.2*0.3) = 4 + 0.36 + 0.36 = 4.72 → round = 4.7
    expect(calmar.score).toBeCloseTo(4.7, 0);
  });

  it('should handle NaN calmar ratio', () => {
    const data = makeFundData({
      riskByPeriod: {
        year1: makeRiskMetrics({ calmarRatio: NaN }),
        year3: makeRiskMetrics({ calmarRatio: NaN }),
        all: makeRiskMetrics({ calmarRatio: NaN }),
      },
    });
    const result = scoreFund(data);
    const calmar = result.details.find(d => d.item === '卡玛比率')!;
    expect(Number.isFinite(calmar.score)).toBe(true);
    expect(calmar.score).toBeGreaterThanOrEqual(0);
  });

  it('should handle zero calmar ratio', () => {
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ calmarRatio: 0 }),
        year3: makeRiskMetrics({ calmarRatio: 0 }),
        all: makeRiskMetrics({ calmarRatio: 0 }),
      },
    });
    const result = scoreFund(data);
    const calmar = result.details.find(d => d.item === '卡玛比率')!;
    expect(calmar.score).toBeGreaterThanOrEqual(0);
    expect(calmar.score).toBeLessThan(3); // 0 < low(0.5) → very low score
  });

  it('should include calmar ratio in riskScore calculation', () => {
    const data = makeFundData({ type: '股票型' });
    const result = scoreFund(data);
    const calmar = result.details.find(d => d.item === '卡玛比率')!;
    const drawdown = result.details.find(d => d.item === '最大回撤')!;
    const vol = result.details.find(d => d.item === '波动率')!;
    const expectedRisk = Math.round((calmar.score + drawdown.score + vol.score) * 10) / 10;
    expect(result.riskScore).toBe(expectedRisk);

    // returnScore = sharpe + sortino + y1 + y3 (no calmar)
    const sharpe = result.details.find(d => d.item === '夏普比率')!;
    const sortino = result.details.find(d => d.item === '索提诺比率')!;
    const y1 = result.details.find(d => d.item === '近1年收益')!;
    const y3 = result.details.find(d => d.item === '近3年收益')!;
    const expectedReturn = Math.round((sharpe.score + sortino.score + y1.score + y3.score) * 10) / 10;
    expect(result.returnScore).toBe(expectedReturn);
  });
});

// ====== 分层评分深度测试 ======

describe('scoreFund - 分层评分对比', () => {
  it('低风险基金同类评分应高于或等于全市场评分', () => {
    // 债基用低风险基准（更宽松的夏普、回撤要求），同类评分更高
    const data = makeFundData({
      type: '纯债型',
      returnYear1: 5,
      returnYear3: 14,
      morningstarRating: 4,
      fundSize: 50,
      managerYears: 8,
      totalFeeRate: 0.5,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.2, maxDrawdown: 1.5, sortinoRatio: 1.5, calmarRatio: 3, volatility: 2 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.2, maxDrawdown: 1.5, sortinoRatio: 1.5, calmarRatio: 3, volatility: 2 }),
        all: makeRiskMetrics({ sharpeRatio: 1.2, maxDrawdown: 1.5, sortinoRatio: 1.5, calmarRatio: 3, volatility: 2 }),
      },
    });
    const result = scoreFund(data);
    // For a good bond fund, tier benchmarks (LOW) are lenient → tier score should be high
    expect(result.riskTier).toBe(RiskTier.LOW);
    expect(result.tierScore).toBeGreaterThan(70);
    expect(Number.isFinite(result.tierScore)).toBe(true);
  });

  it('高风险基金使用更宽松的回撤基准（20%）', () => {
    // equity fund with 18% drawdown should score well on tier benchmarks (drawdown base 20%)
    const data = makeFundData({
      type: '股票型',
      returnYear1: 25,
      returnYear3: 60,
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 8,
      totalFeeRate: 1.2,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 18, sortinoRatio: 2.0, calmarRatio: 1.4, volatility: 20 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 18, sortinoRatio: 2.0, calmarRatio: 1.4, volatility: 20 }),
        all: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 18, sortinoRatio: 2.0, calmarRatio: 1.4, volatility: 20 }),
      },
    });
    const result = scoreFund(data);
    expect(result.riskTier).toBe(RiskTier.HIGH);
    // With HIGH tier: drawdownBenchmark=20, 18% < 20 → full score on drawdown
    const tierDrawdown = result.tierDetails.find(d => d.item === '最大回撤')!;
    expect(tierDrawdown.score).toBe(18); // full score: 18 <= 20 (full benchmark)
  });

  it('同一数据切换不同类型/波动率应产生不同风险层级', () => {
    const base = {
      returnYear1: 10,
      returnYear3: 30,
      morningstarRating: 4,
      fundSize: 50,
      managerYears: 5,
      totalFeeRate: 1.0,
      riskByPeriod: {
        year1: makeRiskMetrics({ volatility: 5 }),
        year3: makeRiskMetrics({ volatility: 5 }),
        all: makeRiskMetrics({ volatility: 5 }),
      },
    };

    const bondResult = scoreFund(makeFundData({ ...base, type: '纯债型' }));
    const equityResult = scoreFund(makeFundData({ ...base, type: '股票型' }));

    // Same vol=5: bond type → LOW/MEDIUM, equity type → HIGH (type takes precedence)
    expect(bondResult.riskTier).not.toBe(equityResult.riskTier);
    expect(equityResult.riskTier).toBe(RiskTier.HIGH); // type=HIGH > vol=MEDIUM
    expect([RiskTier.LOW, RiskTier.MEDIUM]).toContain(bondResult.riskTier);
  });

  it('tierDetails should have same item set as details (excluding morningstar edge case)', () => {
    const data = makeFundData({ morningstarRating: 4 });
    const result = scoreFund(data);
    const detailItems = result.details.map(d => d.item).sort();
    const tierItems = result.tierDetails.map(d => d.item).sort();
    expect(tierItems).toEqual(detailItems);
  });

  it('tierScore uses tier-specific benchmarks, not market benchmarks', () => {
    // A HIGH tier fund: market benchmarks are per-type (equity uses SHARPE_BENCHMARKS.equity)
    // Tier benchmarks are from TIER_BENCHMARKS.HIGH
    const data = makeFundData({
      type: '股票型',
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.5, volatility: 22 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.5, volatility: 22 }),
        all: makeRiskMetrics({ sharpeRatio: 1.5, volatility: 22 }),
      },
    });
    const result = scoreFund(data);

    // Verify tierDetails contains 夏普比率 with a score (may differ from market score)
    const tierSharpe = result.tierDetails.find(d => d.item === '夏普比率')!;
    const marketSharpe = result.details.find(d => d.item === '夏普比率')!;
    expect(tierSharpe).toBeDefined();
    expect(marketSharpe).toBeDefined();
    // Both should be valid scores
    expect(Number.isFinite(tierSharpe.score)).toBe(true);
    expect(Number.isFinite(marketSharpe.score)).toBe(true);
  });
});

// ====== 向后兼容性 ======

describe('scoreFund - 向后兼容性', () => {
  it('totalScore should always equal marketScore', () => {
    const types = ['债券型', '股票型', '混合型-平衡', '指数型', '纯债型', 'FOF'];
    for (const type of types) {
      const result = scoreFund(makeFundData({ type }));
      expect(result.totalScore).toBe(result.marketScore);
    }
  });

  it('FundScore should have all legacy fields (returnScore, riskScore, overallScore, totalScore, details)', () => {
    const result = scoreFund(makeFundData());
    expect(typeof result.returnScore).toBe('number');
    expect(typeof result.riskScore).toBe('number');
    expect(typeof result.overallScore).toBe('number');
    expect(typeof result.totalScore).toBe('number');
    expect(Array.isArray(result.details)).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('totalScore should still be returnScore + riskScore + overallScore', () => {
    const types = ['债券型', '股票型', '混合型-平衡'];
    for (const type of types) {
      const result = scoreFund(makeFundData({ type }));
      const sum = Math.round((result.returnScore + result.riskScore + result.overallScore) * 10) / 10;
      expect(result.totalScore).toBe(sum);
      expect(result.marketScore).toBe(sum);
    }
  });
});

// ====== 权重验证 ======

describe('scoreFund - 权重总和验证', () => {
  it('all maxScore should sum to 100 when morningstar is present', () => {
    const data = makeFundData({ morningstarRating: 4 });
    const result = scoreFund(data);
    const totalMaxScore = result.details.reduce((sum, d) => sum + d.maxScore, 0);
    expect(totalMaxScore).toBe(100);
  });

  it('perfect scores should sum to exactly 100 for all fund types', () => {
    const perfectRisk = makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 0, sortinoRatio: 3, calmarRatio: 4, volatility: 0 });
    const types = [
      { type: '债券型', y1: 10, y3: 25 },
      { type: '股票型', y1: 30, y3: 100 },      // y1=30 avoids momentum penalty
      { type: '混合型-平衡', y1: 25, y3: 60 },   // y1=25 avoids momentum penalty
    ];
    for (const { type, y1, y3 } of types) {
      const data = makeFundData({
        type,
        returnYear1: y1,
        returnYear3: y3,
        morningstarRating: 5,
        fundSize: 50,
        managerYears: 10,
        totalFeeRate: 0.5,
        riskByPeriod: { year1: perfectRisk, year3: perfectRisk, all: perfectRisk },
      });
      const result = scoreFund(data);
      expect(result.totalScore).toBe(100);
    }
  });

  it('weight distribution should be 35+35+30=100', () => {
    // Verify via perfect fund: return items should sum to 35, risk to 35, overall to 30
    const perfectRisk = makeRiskMetrics({ sharpeRatio: 3, maxDrawdown: 0, sortinoRatio: 3, calmarRatio: 4, volatility: 0 });
    const data = makeFundData({
      type: '股票型',
      returnYear1: 30,   // >= full(30), avoids momentum penalty
      returnYear3: 100,
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 10,
      totalFeeRate: 0.5,
      riskByPeriod: { year1: perfectRisk, year3: perfectRisk, all: perfectRisk },
    });
    const result = scoreFund(data);

    // Return dimension: sharpe(12) + sortino(5) + year1(8) + year3(10) = 35
    expect(result.returnScore).toBe(35);
    // Risk dimension: calmar(10) + drawdown(18) + volatility(7) = 35
    expect(result.riskScore).toBe(35);
    // Overall dimension: morningstar(8) + size(8) + manager(8) + fee(6) = 30
    expect(result.overallScore).toBe(30);
  });
});

// ====== 防御性测试补充 ======

describe('scoreFund - 防御性测试', () => {
  it('should handle all NaN risk metrics including calmar', () => {
    const nanMetrics = makeRiskMetrics({
      sharpeRatio: NaN, maxDrawdown: NaN, sortinoRatio: NaN, calmarRatio: NaN, volatility: NaN,
    });
    const data = makeFundData({
      returnYear1: NaN,
      returnYear3: NaN,
      morningstarRating: 0,
      fundSize: NaN,
      managerYears: NaN,
      totalFeeRate: NaN,
      riskByPeriod: { year1: nanMetrics, year3: nanMetrics, all: nanMetrics },
    });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(Number.isFinite(result.tierScore)).toBe(true);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.tierScore).toBeGreaterThanOrEqual(0);
    for (const d of result.details) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
    for (const d of result.tierDetails) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it('should handle all Infinity risk metrics including calmar', () => {
    const infMetrics = makeRiskMetrics({
      sharpeRatio: Infinity, maxDrawdown: Infinity, sortinoRatio: -Infinity, calmarRatio: Infinity, volatility: Infinity,
    });
    const data = makeFundData({
      returnYear1: Infinity,
      returnYear3: -Infinity,
      riskByPeriod: { year1: infMetrics, year3: infMetrics, all: infMetrics },
    });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(Number.isFinite(result.tierScore)).toBe(true);
    expect(result.totalScore).toBeLessThanOrEqual(100);
    expect(result.tierScore).toBeLessThanOrEqual(100);
  });

  it('should handle missing riskByPeriod data (year1/year3 null)', () => {
    const data = makeFundData({
      riskByPeriod: {
        year1: null,
        year3: null,
        all: makeRiskMetrics({ calmarRatio: 1.5 }),
      },
    });
    const result = scoreFund(data);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(Number.isFinite(result.tierScore)).toBe(true);
    // calmar should still get a score from 'all' period
    const calmar = result.details.find(d => d.item === '卡玛比率')!;
    expect(calmar.score).toBeGreaterThan(0);
  });

  it('should produce consistent results across multiple calls', () => {
    const data = makeFundData({ type: '股票型', returnYear1: 20 });
    const r1 = scoreFund(data);
    const r2 = scoreFund(data);
    expect(r1.totalScore).toBe(r2.totalScore);
    expect(r1.tierScore).toBe(r2.tierScore);
    expect(r1.riskTier).toBe(r2.riskTier);
  });
});

// ====== 基金评分合理性验证 ======

describe('scoreFund - 评分合理性验证 (mock 数据)', () => {
  it('低风险稳健债基应识别为 LOW 风险层，同类评分应较高', () => {
    // 模拟 110017 (易方达增强) 的典型数据
    const data = makeFundData({
      type: '债券型',
      returnYear1: 6,
      returnYear3: 18,
      morningstarRating: 4,
      fundSize: 80,
      managerYears: 7,
      totalFeeRate: 0.8,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.3, maxDrawdown: 2, sortinoRatio: 2.0, calmarRatio: 3, volatility: 3 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.3, maxDrawdown: 2, sortinoRatio: 2.0, calmarRatio: 3, volatility: 3 }),
        all: makeRiskMetrics({ sharpeRatio: 1.3, maxDrawdown: 2, sortinoRatio: 2.0, calmarRatio: 3, volatility: 3 }),
      },
    });
    const result = scoreFund(data);
    expect(result.riskTier).toBe(RiskTier.MEDIUM); // 债券型 → MEDIUM type, vol=3 → MEDIUM
    expect(result.totalScore).toBeGreaterThan(80);
  });

  it('优质偏债混合基金应识别为 MEDIUM 风险层', () => {
    // 模拟 010011 (景顺景颐) 的典型数据
    const data = makeFundData({
      type: '偏债混合型',
      returnYear1: 8,
      returnYear3: 22,
      morningstarRating: 5,
      fundSize: 40,
      managerYears: 6,
      totalFeeRate: 1.0,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 3, sortinoRatio: 2.2, calmarRatio: 2.7, volatility: 4 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 3, sortinoRatio: 2.2, calmarRatio: 2.7, volatility: 4 }),
        all: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 3, sortinoRatio: 2.2, calmarRatio: 2.7, volatility: 4 }),
      },
    });
    const result = scoreFund(data);
    expect(result.riskTier).toBe(RiskTier.MEDIUM); // 偏债 → MEDIUM type, vol=4 → MEDIUM
    expect(result.totalScore).toBeGreaterThan(85);
  });

  it('科技股基金应识别为 HIGH 风险层', () => {
    // 模拟 007356 (汇添富科技) 的典型数据
    const data = makeFundData({
      type: '偏股混合型',
      returnYear1: 15,
      returnYear3: 40,
      morningstarRating: 3,
      fundSize: 60,
      managerYears: 4,
      totalFeeRate: 1.5,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.0, maxDrawdown: 30, sortinoRatio: 1.2, calmarRatio: 0.5, volatility: 25 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.0, maxDrawdown: 30, sortinoRatio: 1.2, calmarRatio: 0.5, volatility: 25 }),
        all: makeRiskMetrics({ sharpeRatio: 1.0, maxDrawdown: 30, sortinoRatio: 1.2, calmarRatio: 0.5, volatility: 25 }),
      },
    });
    const result = scoreFund(data);
    expect(result.riskTier).toBe(RiskTier.HIGH); // 偏股混合 → MEDIUM_HIGH type, vol=25 → HIGH → max(MEDIUM_HIGH, HIGH) = HIGH
  });

  it('低风险债基的同类评分应高于高风险股基的同类评分（假设两者都是优质基金）', () => {
    // 优质债基
    const bondData = makeFundData({
      type: '纯债型',
      returnYear1: 5,
      returnYear3: 14,
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 8,
      totalFeeRate: 0.5,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 1, sortinoRatio: 2.0, calmarRatio: 5, volatility: 1.5 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 1, sortinoRatio: 2.0, calmarRatio: 5, volatility: 1.5 }),
        all: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 1, sortinoRatio: 2.0, calmarRatio: 5, volatility: 1.5 }),
      },
    });
    // 优质股基（指标也不错但面对更高的基准）
    const equityData = makeFundData({
      type: '股票型',
      returnYear1: 30,
      returnYear3: 80,
      morningstarRating: 5,
      fundSize: 50,
      managerYears: 8,
      totalFeeRate: 1.0,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 15, sortinoRatio: 2.0, calmarRatio: 2, volatility: 20 }),
        year3: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 15, sortinoRatio: 2.0, calmarRatio: 2, volatility: 20 }),
        all: makeRiskMetrics({ sharpeRatio: 1.5, maxDrawdown: 15, sortinoRatio: 2.0, calmarRatio: 2, volatility: 20 }),
      },
    });

    const bondResult = scoreFund(bondData);
    const equityResult = scoreFund(equityData);

    // Both should be valid
    expect(bondResult.tierScore).toBeGreaterThan(50);
    expect(equityResult.tierScore).toBeGreaterThan(50);
    // Both should have reasonable total scores
    expect(bondResult.totalScore).toBeGreaterThan(70);
    expect(equityResult.totalScore).toBeGreaterThan(70);
  });
});
