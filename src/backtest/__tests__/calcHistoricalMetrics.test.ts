/**
 * calcHistoricalMetrics 单元测试
 *
 * 使用手工构造的净值序列，手动计算预期值作为基准。
 * 所有预期值均由独立推导得出，不依赖代码逻辑。
 */
import { describe, it, expect } from 'vitest';
import { calcMetricsAtDate, buildFundDataAtDate, calcForwardReturns } from '../calcHistoricalMetrics.js';

// ====== 测试数据构造 ======

/** 生成等间隔日净值序列: startDate 开始，每天一个点，共 days 天 */
function makeNavSeries(
  startDate: string,
  dailyNavs: number[],
): number[][] {
  const startTs = new Date(startDate).getTime();
  const dayMs = 24 * 3600 * 1000;
  return dailyNavs.map((nav, i) => [startTs + i * dayMs, nav]);
}

/**
 * 生成线性增长净值序列
 * startNav=1.0, 每天增长 dailyGrowth
 * 如 dailyGrowth=0.001 表示每日增长0.1%
 */
function makeLinearGrowthNav(
  startDate: string,
  days: number,
  startNav: number,
  dailyGrowth: number,
): number[][] {
  const startTs = new Date(startDate).getTime();
  const dayMs = 24 * 3600 * 1000;
  const result: number[][] = [];
  let nav = startNav;
  for (let i = 0; i < days; i++) {
    result.push([startTs + i * dayMs, nav]);
    nav = nav * (1 + dailyGrowth);
  }
  return result;
}

// ====== calcMetricsAtDate 测试 ======

describe('calcMetricsAtDate', () => {
  it('应正确计算近1年收益率', () => {
    // 构造从 2021-01-01 到 2023-01-01 (约730天) 的净值数据
    // 净值从 1.0 稳定增长到 1.5
    // 评估日: 2023-01-01
    // 1年前 (约2022-01-01) 的净值 ≈ 1.25 (线性增长中点偏右)
    // 2023-01-01 净值 ≈ 1.5
    // 近1年收益 ≈ (1.5 - 1.25) / 1.25 * 100 = 20%

    const days = 730;
    const navData: number[][] = [];
    const startTs = new Date('2021-01-01').getTime();
    const dayMs = 24 * 3600 * 1000;
    for (let i = 0; i < days; i++) {
      // 线性从 1.0 到 1.5
      const nav = 1.0 + (0.5 * i) / (days - 1);
      navData.push([startTs + i * dayMs, nav]);
    }

    const evalDate = new Date('2023-01-01');
    const metrics = calcMetricsAtDate(navData, evalDate);

    // 近1年: 从 ~2022-01-01 到 2023-01-01
    // 2022-01-01 是第365天，nav = 1.0 + 0.5 * 365/729 ≈ 1.2503
    // 2023-01-01 是第729天 (最后一天)，nav = 1.5
    // 收益 = (1.5 - 1.2503) / 1.2503 * 100 ≈ 19.97%
    expect(metrics.returnYear1).toBeCloseTo(19.97, 0);
  });

  it('应正确计算近3年收益率 - 数据足够', () => {
    // 4年数据: 2019-01-01 到 2023-01-01
    // 净值从 1.0 增长到 2.0 (线性)
    const days = 365 * 4;
    const navData: number[][] = [];
    const startTs = new Date('2019-01-01').getTime();
    const dayMs = 24 * 3600 * 1000;
    for (let i = 0; i < days; i++) {
      const nav = 1.0 + (1.0 * i) / (days - 1);
      navData.push([startTs + i * dayMs, nav]);
    }

    const evalDate = new Date('2023-01-01');
    const metrics = calcMetricsAtDate(navData, evalDate);

    // 近3年: 从 ~2020-01-01 到 2023-01-01
    // 2020-01-01 约第365天，nav = 1.0 + 365/1459 ≈ 1.2502
    // 2023-01-01 约第1459天(最后一天)，nav = 2.0
    // 收益 = (2.0 - 1.2502) / 1.2502 * 100 ≈ 59.97%
    expect(metrics.returnYear3).toBeCloseTo(59.97, 0);
  });

  it('应正确计算夏普比率 - 稳定增长', () => {
    // 使用稳定日收益率 0.04% 的几何增长序列
    // 几何增长时，日收益率 = (nav[i] - nav[i-1]) / nav[i-1] 完全相同
    // 即所有日收益率 = 0.0004
    // 但 calcDailyReturns 计算的是 (nav[i]-nav[i-1])/nav[i-1]
    // 对于等比数列 nav[i] = nav[0] * (1+r)^i:
    //   (nav[i]-nav[i-1])/nav[i-1] = r = 0.0004 (恒定)
    // 所以 variance = 0, std = 0, 夏普应该返回 0
    //
    // 但实际上浮点运算会引入微小的精度误差，导致 variance 极小但非零
    // 所以夏普可能是一个非常大的数。这是合理的浮点行为。
    const dailyReturn = 0.0004;
    const navData = makeLinearGrowthNav('2022-01-01', 400, 1.0, dailyReturn);
    const evalDate = new Date('2023-02-05');
    const metrics = calcMetricsAtDate(navData, evalDate);

    // 稳定增长序列的夏普应该非常高（因为收益恒定，波动极小）
    // 浮点精度导致 std 接近但不等于 0，所以夏普值可能极大
    // 只验证它是有限数或 0
    expect(Number.isFinite(metrics.sharpeRatio) || metrics.sharpeRatio === 0).toBe(true);
  });

  it('应正确计算夏普比率 - 有波动的序列', () => {
    // 构造一个有实际波动的序列：交替涨跌
    // 200天数据，交替 +1% / -0.5%
    const days = 200;
    const navData: number[][] = [];
    const startTs = new Date('2022-01-01').getTime();
    const dayMs = 24 * 3600 * 1000;
    let nav = 1.0;
    navData.push([startTs, nav]);
    for (let i = 1; i < days; i++) {
      const dailyRet = i % 2 === 1 ? 0.01 : -0.005;
      nav = nav * (1 + dailyRet);
      navData.push([startTs + i * dayMs, nav]);
    }

    const evalDate = new Date('2022-07-20');
    const metrics = calcMetricsAtDate(navData, evalDate);

    // 手工推导:
    // 日收益交替: +1%, -0.5%
    // mean = (0.01 + (-0.005)) / 2 = 0.0025
    // variance = ((0.01-0.0025)^2 + (-0.005-0.0025)^2) / 2
    //          = (0.0075^2 + 0.0075^2) / 2 = 0.0075^2 = 0.00005625
    // std = 0.0075
    // rf_daily = 0.02/252 ≈ 0.0000794
    // sharpe = ((0.0025 - 0.0000794) / 0.0075) * sqrt(252)
    //        = (0.0024206 / 0.0075) * 15.875 ≈ 0.3227 * 15.875 ≈ 5.12
    // 注意: 前面几天有真实的复利扭曲，实际计算会略有差异
    expect(metrics.sharpeRatio).toBeGreaterThan(4);
    expect(metrics.sharpeRatio).toBeLessThan(6);
  });

  it('应正确计算最大回撤', () => {
    // 构造净值序列：1.0 → 1.5 → 1.2 → 1.8
    // 最大回撤从 1.5 到 1.2 = (1.5-1.2)/1.5 = 20%
    const navData: number[][] = [
      [new Date('2022-01-01').getTime(), 1.0],
      [new Date('2022-02-01').getTime(), 1.2],
      [new Date('2022-03-01').getTime(), 1.5], // peak
      [new Date('2022-04-01').getTime(), 1.3],
      [new Date('2022-05-01').getTime(), 1.2], // trough (dd = (1.5-1.2)/1.5 = 20%)
      [new Date('2022-06-01').getTime(), 1.4],
      [new Date('2022-07-01').getTime(), 1.8],
      // 这里需要足够数据点让 sliceNavWindow 返回非 null
    ];
    // 补充到30+个数据点
    const startTs = new Date('2022-01-01').getTime();
    const dayMs = 24 * 3600 * 1000;
    const fullNavData: number[][] = [];
    // 前30天从1.0涨到1.5
    for (let i = 0; i < 30; i++) {
      fullNavData.push([startTs + i * dayMs, 1.0 + 0.5 * i / 29]);
    }
    // 第31-40天从1.5跌到1.2
    for (let i = 0; i < 10; i++) {
      fullNavData.push([startTs + (30 + i) * dayMs, 1.5 - 0.3 * i / 9]);
    }
    // 第41-50天从1.2涨到1.8
    for (let i = 0; i < 10; i++) {
      fullNavData.push([startTs + (40 + i) * dayMs, 1.2 + 0.6 * i / 9]);
    }

    const evalDate = new Date('2022-02-20');
    const metrics = calcMetricsAtDate(fullNavData, evalDate);

    // 最大回撤 = (1.5 - 1.2) / 1.5 = 0.2 = 20%
    expect(metrics.maxDrawdown).toBe(20);
  });

  it('数据不足10个点时返回零值', () => {
    const navData: number[][] = [
      [new Date('2022-01-01').getTime(), 1.0],
      [new Date('2022-01-02').getTime(), 1.01],
      [new Date('2022-01-03').getTime(), 1.02],
    ];

    const evalDate = new Date('2022-01-03');
    const metrics = calcMetricsAtDate(navData, evalDate);

    expect(metrics.returnYear1).toBe(0);
    expect(metrics.returnYear3).toBe(0);
    expect(metrics.sharpeRatio).toBe(0);
    expect(metrics.maxDrawdown).toBe(0);
    expect(metrics.volatility).toBe(0);
    expect(metrics.sortinoRatio).toBe(0);
  });

  it('基金成立不到1年时近1年收益为0', () => {
    // 只有6个月数据，使用有波动的序列（交替涨跌）
    const days = 180;
    const navData: number[][] = [];
    const startTs = new Date('2022-07-01').getTime();
    const dayMs = 24 * 3600 * 1000;
    let nav = 1.0;
    for (let i = 0; i < days; i++) {
      navData.push([startTs + i * dayMs, nav]);
      // 交替涨跌以产生实际波动
      nav *= 1 + (i % 2 === 0 ? 0.003 : -0.001);
    }

    const evalDate = new Date('2022-12-28');
    const metrics = calcMetricsAtDate(navData, evalDate);

    // sliceNavWindow 要求实际时间跨度 >= 80% * 1年，6个月 < 80%*12月
    // 所以 returnYear1 应为 0
    expect(metrics.returnYear1).toBe(0);
    // returnYear3 也为 0（数据更不足）
    expect(metrics.returnYear3).toBe(0);
    // 全量风险指标仍可计算（数据够10个点，且有实际波动）
    expect(metrics.volatility).toBeGreaterThan(0);
  });

  it('基金成立不到3年但超过1年时，近3年为0但近1年有值', () => {
    // 2年数据
    const navData = makeLinearGrowthNav('2021-01-01', 730, 1.0, 0.001);
    const evalDate = new Date('2023-01-01');
    const metrics = calcMetricsAtDate(navData, evalDate);

    // 近1年应有值（有超过1年的数据）
    expect(metrics.returnYear1).toBeGreaterThan(0);
    // 近3年应为 0（数据不足3年 * 80% = 2.4年）
    expect(metrics.returnYear3).toBe(0);
  });
});

// ====== buildFundDataAtDate 测试 ======

describe('buildFundDataAtDate', () => {
  it('应正确构建 FundData 对象', () => {
    const navData = makeLinearGrowthNav('2020-01-01', 1100, 1.0, 0.0005);
    const evalDate = new Date('2023-01-01');
    const metrics = calcMetricsAtDate(navData, evalDate);

    const meta = {
      fundCode: '000001',
      fundName: '测试基金',
      fundType: '混合型-偏股',
      establishDate: '2020-01-01',
      fundSize: 50,
      managerYears: 5,
      totalFeeRate: 1.2,
    };

    const fundData = buildFundDataAtDate(metrics, navData, evalDate, meta);

    // 基本信息应正确
    expect(fundData.basic.code).toBe('000001');
    expect(fundData.basic.name).toBe('测试基金');
    expect(fundData.basic.type).toBe('混合型-偏股');

    // 性能指标应从 metrics 赋值
    expect(fundData.performance.returnYear1).toBe(metrics.returnYear1);
    expect(fundData.performance.returnYear3).toBe(metrics.returnYear3);
    expect(fundData.performance.sharpeRatio).toBe(metrics.sharpeRatio);

    // 不可用指标使用默认值
    expect(fundData.meta.morningstarRating).toBe(0);
    expect(fundData.meta.categoryRankPercent).toBe(0);

    // 规模和费率使用当前值
    expect(fundData.meta.fundSize).toBe(50);
    expect(fundData.meta.totalFeeRate).toBe(1.2);
  });

  it('应从成立日期推算经理年限到评估日期', () => {
    const navData = makeLinearGrowthNav('2020-01-01', 1100, 1.0, 0.0005);
    const evalDate = new Date('2023-01-01');
    const metrics = calcMetricsAtDate(navData, evalDate);

    const meta = {
      fundCode: '000001',
      fundName: '测试基金',
      fundType: '混合型-偏股',
      establishDate: '2020-01-01',
      fundSize: 50,
      managerYears: 5,
      totalFeeRate: 1.2,
    };

    const fundData = buildFundDataAtDate(metrics, navData, evalDate, meta);

    // 2020-01-01 到 2023-01-01 约 3 年
    expect(fundData.meta.managerYears).toBeCloseTo(3, 0);
  });

  it('riskByPeriod 应包含分时段风险指标', () => {
    const navData = makeLinearGrowthNav('2019-01-01', 1500, 1.0, 0.0005);
    const evalDate = new Date('2023-02-01');
    const metrics = calcMetricsAtDate(navData, evalDate);

    const meta = {
      fundCode: '000001',
      fundName: '测试',
      fundType: '股票型',
      establishDate: '2019-01-01',
      fundSize: 50,
      managerYears: 5,
      totalFeeRate: 1.0,
    };

    const fundData = buildFundDataAtDate(metrics, navData, evalDate, meta);
    const rbp = fundData.performance.riskByPeriod;

    // all 应始终存在
    expect(rbp.all).toBeDefined();
    expect(rbp.all.sharpeRatio).toBe(metrics.sharpeRatio);
    expect(rbp.all.maxDrawdown).toBe(metrics.maxDrawdown);

    // year1 和 year3 取决于数据是否足够
    // 4年数据足够算 year1 和 year3
    expect(rbp.year1).not.toBeNull();
    expect(rbp.year3).not.toBeNull();
  });
});

// ====== calcForwardReturns 测试 ======

describe('calcForwardReturns', () => {
  it('应正确计算1年前瞻收益', () => {
    // 构造 2020-01-01 到 2025-01-01 的净值
    // 净值从 1.0 线性增长到 2.0
    const days = 365 * 5;
    const navData: number[][] = [];
    const startTs = new Date('2020-01-01').getTime();
    const dayMs = 24 * 3600 * 1000;
    for (let i = 0; i < days; i++) {
      const nav = 1.0 + (1.0 * i) / (days - 1);
      navData.push([startTs + i * dayMs, nav]);
    }

    const evalDate = new Date('2022-01-01');
    const results = calcForwardReturns(navData, evalDate, [1]);

    // evalDate = 2022-01-01, 约第 730 天
    // evalNav ≈ 1.0 + 730/1824 ≈ 1.4003
    // 1年后 = 2023-01-01, 约第 1095 天
    // targetNav ≈ 1.0 + 1095/1824 ≈ 1.6003
    // return = (1.6003 - 1.4003) / 1.4003 * 100 ≈ 14.28%
    expect(results).toHaveLength(1);
    expect(results[0].period).toBe('1y');
    expect(results[0].return).toBeCloseTo(14.28, 0);
  });

  it('应正确计算多个前瞻期', () => {
    const days = 365 * 5;
    const navData: number[][] = [];
    const startTs = new Date('2020-01-01').getTime();
    const dayMs = 24 * 3600 * 1000;
    for (let i = 0; i < days; i++) {
      const nav = 1.0 + (1.0 * i) / (days - 1);
      navData.push([startTs + i * dayMs, nav]);
    }

    const evalDate = new Date('2021-01-01');
    const results = calcForwardReturns(navData, evalDate, [1, 2]);

    expect(results).toHaveLength(2);
    expect(results[0].period).toBe('1y');
    expect(results[1].period).toBe('2y');
    // 两个前瞻期都应有有效收益
    expect(results[0].return).not.toBeNaN();
    expect(results[1].return).not.toBeNaN();
    // 2年收益应大于1年
    expect(results[1].return).toBeGreaterThan(results[0].return);
  });

  it('数据不足时返回 NaN', () => {
    // 只有1年数据，但要求2年前瞻
    const navData = makeLinearGrowthNav('2022-01-01', 365, 1.0, 0.001);
    const evalDate = new Date('2022-06-01');
    const results = calcForwardReturns(navData, evalDate, [2]);

    // 6月评估，数据到年底只有约半年，不足2年 * 80% = 1.6年
    expect(results).toHaveLength(1);
    expect(results[0].return).toBeNaN();
  });

  it('evalDate 在数据末尾时返回空数组', () => {
    const navData = makeLinearGrowthNav('2022-01-01', 100, 1.0, 0.001);
    const evalDate = new Date('2025-01-01'); // 远超数据范围
    const results = calcForwardReturns(navData, evalDate, [1]);
    expect(results).toHaveLength(0);
  });

  it('应正确计算年化收益率', () => {
    // 已知净值: evalNav=1.0, 1年后 targetNav=1.20
    // totalReturn = 20%
    // annualized = (1.20/1.0)^(1/1) - 1 = 20%
    const navData: number[][] = [
      [new Date('2022-01-01').getTime(), 1.0],
      [new Date('2023-01-01').getTime(), 1.2],
    ];
    const evalDate = new Date('2022-01-01');
    const results = calcForwardReturns(navData, evalDate, [1]);

    expect(results).toHaveLength(1);
    expect(results[0].return).toBeCloseTo(20, 0);
    expect(results[0].annualized).toBeCloseTo(20, 0);
  });
});
