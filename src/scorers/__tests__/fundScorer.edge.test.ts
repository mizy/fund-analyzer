/**
 * fundScorer 边界条件测试
 * 覆盖 NaN、Infinity、undefined 等极端输入场景
 */
import { describe, it, expect } from 'vitest';
import { scoreFund } from '../fundScorer.js';
import { scoreFundDeep } from '../fundScorerDeep.js';
import type { FundData, PeriodRiskMetrics, QuantMetrics, FundHoldings } from '../../types/fund.js';

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

function makeFundData(overrides: Partial<{
  type: string;
  returnYear1: number;
  returnYear3: number;
  morningstarRating: number;
  fundSize: number;
  managerYears: number;
  totalFeeRate: number;
  riskByPeriod: {
    year1: PeriodRiskMetrics | null;
    year3: PeriodRiskMetrics | null;
    all: PeriodRiskMetrics;
  };
}> = {}): FundData {
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

// ====== NaN/Infinity 输入安全性 ======

describe('scoreFund - NaN/Infinity safety', () => {
  it('handles NaN returnYear1 without crashing', () => {
    const result = scoreFund(makeFundData({ returnYear1: NaN }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('handles NaN returnYear3 without crashing', () => {
    const result = scoreFund(makeFundData({ returnYear3: NaN }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('handles Infinity returnYear1', () => {
    const result = scoreFund(makeFundData({ returnYear1: Infinity }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('handles -Infinity returnYear1', () => {
    const result = scoreFund(makeFundData({ returnYear1: -Infinity }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('handles NaN in risk metrics', () => {
    const result = scoreFund(makeFundData({
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: NaN, maxDrawdown: NaN }),
        year3: makeRiskMetrics({ sortinoRatio: NaN, volatility: NaN }),
        all: makeRiskMetrics({ sharpeRatio: NaN, maxDrawdown: NaN, sortinoRatio: NaN, volatility: NaN }),
      },
    }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
    // NaN → safeNum → 0, so scores should be low but finite
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('handles Infinity in risk metrics', () => {
    const result = scoreFund(makeFundData({
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: Infinity }),
        year3: makeRiskMetrics(),
        all: makeRiskMetrics({ maxDrawdown: Infinity }),
      },
    }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it('handles all metrics as NaN simultaneously', () => {
    const result = scoreFund(makeFundData({
      returnYear1: NaN,
      returnYear3: NaN,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: NaN, maxDrawdown: NaN, sortinoRatio: NaN, calmarRatio: NaN, volatility: NaN }),
        year3: makeRiskMetrics({ sharpeRatio: NaN, maxDrawdown: NaN, sortinoRatio: NaN, calmarRatio: NaN, volatility: NaN }),
        all: makeRiskMetrics({ sharpeRatio: NaN, maxDrawdown: NaN, sortinoRatio: NaN, calmarRatio: NaN, volatility: NaN }),
      },
    }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
    // Meta scores (morningstar, size, manager, fee) should still contribute
    expect(result.overallScore).toBeGreaterThan(0);
    // Tier score should also be finite
    expect(Number.isFinite(result.tierScore)).toBe(true);
  });
});

// ====== scoreFundDeep NaN safety ======

describe('scoreFundDeep - NaN/Infinity safety', () => {
  it('handles NaN in quant metrics', () => {
    const quant: QuantMetrics = {
      alpha: NaN,
      beta: NaN,
      informationRatio: NaN,
      treynorRatio: NaN,
      var95: NaN,
      cvar95: NaN,
      monthlyWinRate: NaN,
      downsideCaptureRatio: NaN,
      cagr: NaN,
      hhi: NaN,
      topHoldingsRatio: NaN,
    };
    const result = scoreFundDeep(makeFundData(), quant);
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('handles Infinity in quant metrics', () => {
    const quant: QuantMetrics = {
      alpha: Infinity,
      beta: Infinity,
      informationRatio: Infinity,
      treynorRatio: Infinity,
      var95: Infinity,
      cvar95: Infinity,
      monthlyWinRate: Infinity,
      downsideCaptureRatio: Infinity,
      cagr: Infinity,
      hhi: Infinity,
      topHoldingsRatio: Infinity,
    };
    const result = scoreFundDeep(makeFundData(), quant, {
      topStocks: [],
      industries: [],
      reportDate: '2025-12-31',
    });
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });
});

// ====== 极端数值边界 ======

describe('scoreFund - extreme values', () => {
  it('handles extremely high sharpe ratio (999)', () => {
    const result = scoreFund(makeFundData({
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 999 }),
        year3: makeRiskMetrics({ sharpeRatio: 999 }),
        all: makeRiskMetrics({ sharpeRatio: 999 }),
      },
    }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
    // Should cap at max score, not exceed 100
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it('handles extremely negative sharpe ratio (-999)', () => {
    const result = scoreFund(makeFundData({
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: -999 }),
        year3: makeRiskMetrics({ sharpeRatio: -999 }),
        all: makeRiskMetrics({ sharpeRatio: -999 }),
      },
    }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('handles manager years = 0', () => {
    const result = scoreFund(makeFundData({ managerYears: 0 }));
    const mgrScore = result.details.find(d => d.item === '经理年限')!;
    expect(mgrScore.score).toBe(1.6); // < 1 year → 8*0.2=1.6
  });

  it('handles fund size = 0', () => {
    const result = scoreFund(makeFundData({ fundSize: 0 }));
    const sizeScore = result.details.find(d => d.item === '基金规模')!;
    expect(sizeScore.score).toBe(1.6); // < 1 → 8*0.2=1.6
  });

  it('handles all-zero performance data', () => {
    const result = scoreFund(makeFundData({
      returnYear1: 0,
      returnYear3: 0,
      riskByPeriod: {
        year1: makeRiskMetrics({ sharpeRatio: 0, maxDrawdown: 0, sortinoRatio: 0, volatility: 0 }),
        year3: makeRiskMetrics({ sharpeRatio: 0, maxDrawdown: 0, sortinoRatio: 0, volatility: 0 }),
        all: makeRiskMetrics({ sharpeRatio: 0, maxDrawdown: 0, sortinoRatio: 0, volatility: 0 }),
      },
    }));
    expect(Number.isFinite(result.totalScore)).toBe(true);
    // Zero drawdown/volatility is actually perfect → max risk score
    expect(result.riskScore).toBeGreaterThan(10);
  });
});
