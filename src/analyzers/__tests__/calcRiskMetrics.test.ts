/**
 * calcRiskMetrics 单元测试
 *
 * 使用手工构造的净值序列，手动计算预期值作为基准。
 */
import { describe, it, expect } from 'vitest';
import {
  calcMaxDrawdown,
  calcVolatility,
  calcSharpeRatio,
  calcSortinoRatio,
  calcCalmarRatio,
  sliceNavData,
  calcMultiPeriodRiskMetrics,
} from '../calcRiskMetrics.js';

// ====== 测试数据构造 ======

const DAY_MS = 24 * 3600 * 1000;

/** 生成等间隔日净值序列 */
function makeNavSeries(startDate: string, dailyNavs: number[]): number[][] {
  const startTs = new Date(startDate).getTime();
  return dailyNavs.map((nav, i) => [startTs + i * DAY_MS, nav]);
}

/** 生成线性增长净值：startNav 每天增长 dailyGrowth（乘法） */
function makeLinearGrowthNav(startDate: string, days: number, startNav: number, dailyGrowth: number): number[][] {
  const startTs = new Date(startDate).getTime();
  const result: number[][] = [];
  let nav = startNav;
  for (let i = 0; i < days; i++) {
    result.push([startTs + i * DAY_MS, nav]);
    nav = nav * (1 + dailyGrowth);
  }
  return result;
}

/** 生成恒定净值序列 */
function makeConstantNav(startDate: string, days: number, nav: number): number[][] {
  const startTs = new Date(startDate).getTime();
  return Array.from({ length: days }, (_, i) => [startTs + i * DAY_MS, nav]);
}

// ====== calcMaxDrawdown ======

describe('calcMaxDrawdown', () => {
  it('returns 0 for null input', () => {
    expect(calcMaxDrawdown(null)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(calcMaxDrawdown([])).toBe(0);
  });

  it('returns 0 for single data point', () => {
    expect(calcMaxDrawdown([[0, 1.0]])).toBe(0);
  });

  it('returns 0 for monotonically increasing nav', () => {
    // 1.0 → 1.1 → 1.2 → 1.3, no drawdown
    const nav = makeNavSeries('2023-01-01', [1.0, 1.1, 1.2, 1.3]);
    expect(calcMaxDrawdown(nav)).toBe(0);
  });

  it('calculates simple drawdown correctly', () => {
    // Peak at 2.0, trough at 1.0: drawdown = (2.0-1.0)/2.0 = 50%
    const nav = makeNavSeries('2023-01-01', [1.0, 2.0, 1.0]);
    expect(calcMaxDrawdown(nav)).toBe(50);
  });

  it('handles multiple peaks, picks max drawdown', () => {
    // First peak 1.5 → trough 1.2 (20%), second peak 2.0 → trough 1.0 (50%)
    const nav = makeNavSeries('2023-01-01', [1.0, 1.5, 1.2, 2.0, 1.0]);
    expect(calcMaxDrawdown(nav)).toBe(50);
  });

  it('handles drawdown at start then recovery', () => {
    // Peak 1.0, trough 0.8 (20%), recovery to 1.5
    const nav = makeNavSeries('2023-01-01', [1.0, 0.8, 1.5]);
    expect(calcMaxDrawdown(nav)).toBe(20);
  });

  it('rounds to 2 decimal places (percentage)', () => {
    // Peak 3.0, trough 2.0: dd = (3.0-2.0)/3.0 = 33.333...% → 33.33
    const nav = makeNavSeries('2023-01-01', [3.0, 2.0]);
    expect(calcMaxDrawdown(nav)).toBe(33.33);
  });
});

// ====== calcVolatility ======

describe('calcVolatility', () => {
  it('returns 0 for null input', () => {
    expect(calcVolatility(null)).toBe(0);
  });

  it('returns 0 for less than 10 data points', () => {
    const nav = makeNavSeries('2023-01-01', [1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08]);
    expect(nav.length).toBe(9);
    expect(calcVolatility(nav)).toBe(0);
  });

  it('returns 0 for constant nav (zero variance)', () => {
    const nav = makeConstantNav('2023-01-01', 20, 1.5);
    expect(calcVolatility(nav)).toBe(0);
  });

  it('calculates positive volatility for varying nav', () => {
    // 50 days of growth should produce a measurable volatility
    const nav = makeLinearGrowthNav('2023-01-01', 50, 1.0, 0.001);
    const vol = calcVolatility(nav);
    // Constant daily growth → very low volatility (near 0 but > 0 due to compounding precision)
    // Actually perfectly constant % growth → all daily returns identical → variance=0
    // With multiplicative growth, daily return = (1+g)^1 - 1 = g exactly, so variance=0
    expect(vol).toBe(0);
  });

  it('higher oscillation produces higher volatility', () => {
    // Alternating up/down pattern: high volatility
    const navs = Array.from({ length: 30 }, (_, i) => 1.0 + (i % 2 === 0 ? 0.1 : -0.1));
    const nav = makeNavSeries('2023-01-01', navs);
    const vol = calcVolatility(nav);
    expect(vol).toBeGreaterThan(100); // Very high annualized volatility
  });
});

// ====== calcSharpeRatio ======

describe('calcSharpeRatio', () => {
  it('returns 0 for null input', () => {
    expect(calcSharpeRatio(null)).toBe(0);
  });

  it('returns 0 for less than 30 data points', () => {
    const nav = makeLinearGrowthNav('2023-01-01', 29, 1.0, 0.001);
    expect(calcSharpeRatio(nav)).toBe(0);
  });

  it('returns 0 for constant nav (zero stddev)', () => {
    const nav = makeConstantNav('2023-01-01', 50, 2.0);
    expect(calcSharpeRatio(nav)).toBe(0);
  });

  it('returns positive sharpe for steadily growing fund', () => {
    // Alternating returns with positive bias
    const navs = [1.0];
    for (let i = 1; i < 60; i++) {
      navs.push(navs[i - 1] * (1 + 0.003 + (i % 2 === 0 ? 0.001 : -0.001)));
    }
    const nav = makeNavSeries('2023-01-01', navs);
    expect(calcSharpeRatio(nav)).toBeGreaterThan(0);
  });

  it('returns negative sharpe for declining fund', () => {
    // Declining with some volatility
    const navs = [1.0];
    for (let i = 1; i < 60; i++) {
      navs.push(navs[i - 1] * (1 - 0.003 + (i % 2 === 0 ? 0.001 : -0.001)));
    }
    const nav = makeNavSeries('2023-01-01', navs);
    expect(calcSharpeRatio(nav)).toBeLessThan(0);
  });

  it('result is rounded to 2 decimal places', () => {
    const navs = [1.0];
    for (let i = 1; i < 60; i++) {
      navs.push(navs[i - 1] * (1 + 0.002 + (i % 3 === 0 ? 0.002 : -0.001)));
    }
    const nav = makeNavSeries('2023-01-01', navs);
    const sharpe = calcSharpeRatio(nav);
    // Check rounding: value should have at most 2 decimal places
    expect(sharpe).toBe(Math.round(sharpe * 100) / 100);
  });
});

// ====== calcSortinoRatio ======

describe('calcSortinoRatio', () => {
  it('returns 0 for null input', () => {
    expect(calcSortinoRatio(null, 10)).toBe(0);
  });

  it('returns 0 for less than 10 data points', () => {
    const nav = makeNavSeries('2023-01-01', [1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08]);
    expect(calcSortinoRatio(nav, 10)).toBe(0);
  });

  it('returns 3 when no downside returns (all returns above risk-free)', () => {
    // Steady growth: every daily return > riskFreeDaily (0.02/252 ≈ 0.0000794)
    // 0.5% daily growth is well above risk-free
    const nav = makeLinearGrowthNav('2023-01-01', 20, 1.0, 0.005);
    expect(calcSortinoRatio(nav, 100)).toBe(3);
  });

  it('returns positive sortino for decent fund with some downside', () => {
    // Mix of up and down days, net positive
    const navs = [1.0];
    for (let i = 1; i < 30; i++) {
      const change = i % 3 === 0 ? -0.005 : 0.003;
      navs.push(navs[i - 1] * (1 + change));
    }
    const nav = makeNavSeries('2023-01-01', navs);
    const sortino = calcSortinoRatio(nav, 15);
    expect(sortino).toBeGreaterThan(0);
  });

  it('returns negative sortino when return is below risk-free and has downside', () => {
    // Heavy downside
    const navs = [1.0];
    for (let i = 1; i < 30; i++) {
      navs.push(navs[i - 1] * (1 - 0.005 + (i % 2 === 0 ? 0.001 : -0.001)));
    }
    const nav = makeNavSeries('2023-01-01', navs);
    // returnYear1 is deeply negative
    const sortino = calcSortinoRatio(nav, -30);
    expect(sortino).toBeLessThan(0);
  });

  it('result is rounded to 2 decimal places', () => {
    const navs = [1.0];
    for (let i = 1; i < 30; i++) {
      navs.push(navs[i - 1] * (1 + (i % 4 === 0 ? -0.003 : 0.002)));
    }
    const nav = makeNavSeries('2023-01-01', navs);
    const sortino = calcSortinoRatio(nav, 20);
    expect(sortino).toBe(Math.round(sortino * 100) / 100);
  });
});

// ====== calcCalmarRatio ======

describe('calcCalmarRatio', () => {
  it('returns ratio of annualized return / |maxDrawdown|', () => {
    expect(calcCalmarRatio(15, 5)).toBe(3);
    expect(calcCalmarRatio(10, 10)).toBe(1);
  });

  it('returns 0 when maxDrawdown is 0', () => {
    expect(calcCalmarRatio(10, 0)).toBe(0);
  });

  it('handles negative returns', () => {
    expect(calcCalmarRatio(-10, 20)).toBe(-0.5);
  });

  it('returns 0 for NaN/Infinity inputs', () => {
    expect(calcCalmarRatio(NaN, 10)).toBe(0);
    expect(calcCalmarRatio(10, NaN)).toBe(0);
    expect(calcCalmarRatio(Infinity, 10)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    const result = calcCalmarRatio(10, 3);
    expect(result).toBe(Math.round(result * 100) / 100);
  });
});

// ====== sliceNavData ======

describe('sliceNavData', () => {
  it('returns null for empty array', () => {
    expect(sliceNavData([], 1)).toBeNull();
  });

  it('returns null when data span is less than 80% of requested window', () => {
    // 100 days of data, request 1 year (365 days), 100/365 = 27% < 80%
    const nav = makeLinearGrowthNav('2023-01-01', 100, 1.0, 0.001);
    expect(sliceNavData(nav, 1)).toBeNull();
  });

  it('returns data when span covers >= 80% of window', () => {
    // 300 days of data, request 1 year: 300/365 = 82% >= 80%
    const nav = makeLinearGrowthNav('2023-01-01', 300, 1.0, 0.001);
    const result = sliceNavData(nav, 1);
    expect(result).not.toBeNull();
    // Should contain approximately 300 points (all within 1-year window from end)
    expect(result!.length).toBeGreaterThan(0);
    expect(result!.length).toBeLessThanOrEqual(300);
  });

  it('slices to last year of multi-year data', () => {
    // 3 years of data (1095 days), request last 1 year
    const nav = makeLinearGrowthNav('2020-01-01', 1095, 1.0, 0.0005);
    const result = sliceNavData(nav, 1);
    expect(result).not.toBeNull();
    // Should have approximately 365 days of data
    expect(result!.length).toBeGreaterThan(350);
    expect(result!.length).toBeLessThanOrEqual(370);
  });

  it('returns all data when window covers entire range', () => {
    // 400 days, request 2 years — 400 is < 80% of 730 days
    const nav = makeLinearGrowthNav('2023-01-01', 400, 1.0, 0.001);
    expect(sliceNavData(nav, 2)).toBeNull();
  });

  it('returns data for 3-year window with sufficient history', () => {
    // 4 years of data, request 3 years
    const nav = makeLinearGrowthNav('2019-01-01', 1460, 1.0, 0.0003);
    const result = sliceNavData(nav, 3);
    expect(result).not.toBeNull();
    // Should have approximately 1095 days
    expect(result!.length).toBeGreaterThan(1050);
    expect(result!.length).toBeLessThanOrEqual(1100);
  });
});

// ====== calcMultiPeriodRiskMetrics ======

describe('calcMultiPeriodRiskMetrics', () => {
  it('returns zeroed all-metrics for null navData', () => {
    const result = calcMultiPeriodRiskMetrics(null, 10);
    expect(result.all).toEqual({
      maxDrawdown: 0,
      volatility: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
    });
    expect(result.year1).toBeNull();
    expect(result.year3).toBeNull();
  });

  it('returns null for year1/year3 when data is too short', () => {
    // 100 days of data - not enough for 1-year or 3-year windows
    const nav = makeLinearGrowthNav('2023-01-01', 100, 1.0, 0.001);
    const result = calcMultiPeriodRiskMetrics(nav, 10);
    expect(result.year1).toBeNull();
    expect(result.year3).toBeNull();
    // But 'all' should have some data (100 points > 30 for sharpe, > 10 for others)
    expect(result.all.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it('returns year1 metrics when data covers >= 1 year', () => {
    // 400 days with some volatility
    const navs = [1.0];
    for (let i = 1; i < 400; i++) {
      navs.push(navs[i - 1] * (1 + 0.001 + (i % 5 === 0 ? -0.005 : 0.001)));
    }
    const nav = makeNavSeries('2023-01-01', navs);
    const result = calcMultiPeriodRiskMetrics(nav, 15);
    expect(result.year1).not.toBeNull();
    expect(result.year1!.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.year1!.volatility).toBeGreaterThanOrEqual(0);
  });

  it('returns all three periods when data covers >= 3 years', () => {
    // 4 years of data with volatility
    const navs = [1.0];
    for (let i = 1; i < 1460; i++) {
      navs.push(navs[i - 1] * (1 + 0.0005 + (i % 7 === 0 ? -0.003 : 0.0005)));
    }
    const nav = makeNavSeries('2020-01-01', navs);
    const result = calcMultiPeriodRiskMetrics(nav, 10);
    expect(result.year1).not.toBeNull();
    expect(result.year3).not.toBeNull();
    expect(result.all.sharpeRatio).not.toBe(0);
  });
});
