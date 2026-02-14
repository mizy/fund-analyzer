# 基金量化分析指标详解

> 参考标准：CFA (Chartered Financial Analyst) / FRM (Financial Risk Manager) 教材

---

## 1. 风险调整收益指标 (Risk-Adjusted Return Metrics)

### 1.1 Alpha (Jensen's Alpha / 詹森阿尔法)

**计算公式：**
```typescript
// Jensen's Alpha = Rp - [Rf + βp × (Rm - Rf)]
function calculateAlpha(
  portfolioReturn: number,    // Rp: 组合实际收益率
  riskFreeRate: number,       // Rf: 无风险利率
  beta: number,               // βp: 组合贝塔系数
  marketReturn: number        // Rm: 市场收益率
): number {
  const expectedReturn = riskFreeRate + beta * (marketReturn - riskFreeRate);
  return portfolioReturn - expectedReturn;
}
```

**含义：** 衡量基金相对于 CAPM 模型预期收益的超额回报，正值表示跑赢预期，负值表示跑输预期

**参考值范围：**
- Alpha > 0: 优秀（超额回报）
- Alpha = 0: 中性（符合预期）
- Alpha < 0: 较差（低于预期）

---

### 1.2 Beta (贝塔系数)

**计算公式：**
```typescript
// Beta = Cov(Rp, Rm) / Var(Rm)
function calculateBeta(
  portfolioReturns: number[],  // 组合收益率序列
  marketReturns: number[]      // 市场收益率序列
): number {
  const n = portfolioReturns.length;

  // 计算均值
  const avgPortfolio = portfolioReturns.reduce((a, b) => a + b) / n;
  const avgMarket = marketReturns.reduce((a, b) => a + b) / n;

  // 计算协方差
  let covariance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (portfolioReturns[i] - avgPortfolio) * (marketReturns[i] - avgMarket);
  }
  covariance /= (n - 1);

  // 计算市场方差
  let marketVariance = 0;
  for (let i = 0; i < n; i++) {
    marketVariance += Math.pow(marketReturns[i] - avgMarket, 2);
  }
  marketVariance /= (n - 1);

  return covariance / marketVariance;
}

// 或使用相关系数简化公式：
// Beta = ρ(Rp, Rm) × σp / σm
function calculateBetaByCorrelation(
  correlation: number,         // 相关系数
  portfolioStdDev: number,     // 组合标准差
  marketStdDev: number         // 市场标准差
): number {
  return correlation * (portfolioStdDev / marketStdDev);
}
```

**含义：** 衡量基金相对市场的系统性风险暴露，反映基金对市场波动的敏感度

**参考值范围：**
- Beta = 1: 与市场同步波动
- Beta > 1: 比市场波动更大（高风险高收益）
- Beta < 1: 比市场波动更小（低风险低收益）
- Beta < 0: 与市场反向波动（对冲型）

---

### 1.3 Information Ratio (信息比率 / IR)

**计算公式：**
```typescript
// IR = (Rp - Rb) / Tracking Error
function calculateInformationRatio(
  portfolioReturns: number[],   // 组合收益率序列
  benchmarkReturns: number[]    // 基准收益率序列
): number {
  const n = portfolioReturns.length;

  // 计算平均主动收益
  const activeReturns = portfolioReturns.map((r, i) => r - benchmarkReturns[i]);
  const avgActiveReturn = activeReturns.reduce((a, b) => a + b) / n;

  // 计算跟踪误差 (Tracking Error = 主动收益的标准差)
  const variance = activeReturns.reduce((sum, r) =>
    sum + Math.pow(r - avgActiveReturn, 2), 0
  ) / (n - 1);
  const trackingError = Math.sqrt(variance);

  return avgActiveReturn / trackingError;
}
```

**含义：** 衡量单位主动风险带来的主动收益，评估基金经理创造超额收益的稳定性

**参考值范围：**
- IR > 0.5: 优秀（稳定超额收益）
- IR = 0 ~ 0.5: 一般
- IR < 0: 较差（负超额收益）

---

### 1.4 Treynor Ratio (特雷诺比率)

**计算公式：**
```typescript
// Treynor Ratio = (Rp - Rf) / βp
function calculateTreynorRatio(
  portfolioReturn: number,      // 组合收益率
  riskFreeRate: number,         // 无风险利率
  beta: number                  // 组合贝塔系数
): number {
  return (portfolioReturn - riskFreeRate) / beta;
}
```

**含义：** 衡量单位系统性风险带来的超额收益，适用于充分分散化的组合

**参考值范围：**
- 数值越高越好
- 与 Sharpe Ratio 对比使用：Treynor 关注系统性风险，Sharpe 关注总风险

---

## 2. 持仓分析指标 (Portfolio Composition Metrics)

### 2.1 HHI Index (Herfindahl-Hirschman Index / 赫芬达尔指数)

**计算公式：**
```typescript
// HHI = Σ(wi^2)，wi 为各持仓权重（百分比形式）
function calculateHHI(weights: number[]): number {
  // weights 为百分比形式，如 [25, 30, 20, 15, 10] 代表 25%, 30% ...
  return weights.reduce((sum, w) => sum + Math.pow(w, 2), 0);
}

// 归一化 HHI (0-1 范围)
function calculateNormalizedHHI(weights: number[]): number {
  const n = weights.length;
  if (n <= 1) return 1;

  const hhi = weights.reduce((sum, w) => sum + Math.pow(w / 100, 2), 0);
  const minHHI = 1 / n;  // 完全分散
  const maxHHI = 1;       // 完全集中

  return (hhi - minHHI) / (maxHHI - minHHI);
}
```

**含义：** 衡量持仓集中度，数值越大表示集中度越高，分散度越低

**参考值范围：**
- HHI < 0.15 (1500): 低集中度（高分散）
- HHI = 0.15 ~ 0.25 (1500-2500): 中等集中度
- HHI > 0.25 (2500): 高集中度（低分散）
- *注：括号内为以 10000 为上限的表示法*

---

### 2.2 Top Holdings Ratio (重仓股占比)

**计算公式：**
```typescript
// 前 N 大持仓占比
function calculateTopHoldingsRatio(
  weights: number[],   // 所有持仓权重（降序排列）
  topN: number = 10    // 取前 N 大持仓
): number {
  const sortedWeights = [...weights].sort((a, b) => b - a);
  return sortedWeights.slice(0, topN).reduce((sum, w) => sum + w, 0);
}
```

**含义：** 前 N 大持仓的总权重占比，反映核心持仓的集中程度

**参考值范围：**
- 前10大占比 < 30%: 高度分散
- 前10大占比 30% ~ 50%: 适度集中
- 前10大占比 > 50%: 高度集中

---

## 3. 业绩分析指标 (Performance Metrics)

### 3.1 Rolling Return (滚动收益率)

**计算公式：**
```typescript
// 计算滚动收益率序列
function calculateRollingReturns(
  navSeries: number[],       // 净值序列
  windowDays: number         // 滚动窗口天数（如 252 代表 1 年）
): number[] {
  const rollingReturns: number[] = [];

  for (let i = windowDays; i < navSeries.length; i++) {
    const startNav = navSeries[i - windowDays];
    const endNav = navSeries[i];
    const return_ = (endNav - startNav) / startNav;
    rollingReturns.push(return_);
  }

  return rollingReturns;
}

// 滚动收益统计分析
function analyzeRollingReturns(rollingReturns: number[]) {
  return {
    mean: rollingReturns.reduce((a, b) => a + b) / rollingReturns.length,
    median: rollingReturns.sort()[Math.floor(rollingReturns.length / 2)],
    min: Math.min(...rollingReturns),
    max: Math.max(...rollingReturns),
    positiveRatio: rollingReturns.filter(r => r > 0).length / rollingReturns.length
  };
}
```

**含义：** 滑动时间窗口内的收益率序列，消除起止点偏差，评估收益稳定性

**参考值范围：**
- 正收益占比 > 70%: 稳定性好
- 正收益占比 50% ~ 70%: 一般
- 正收益占比 < 50%: 稳定性差

---

### 3.2 CAGR (Compound Annual Growth Rate / 年化复合增长率)

**计算公式：**
```typescript
// CAGR = (FV / PV)^(1/n) - 1
function calculateCAGR(
  startValue: number,    // 初始净值
  endValue: number,      // 结束净值
  years: number          // 持有年数
): number {
  return Math.pow(endValue / startValue, 1 / years) - 1;
}

// 从日期计算 CAGR
function calculateCAGRFromDates(
  startValue: number,
  endValue: number,
  startDate: Date,
  endDate: Date
): number {
  const days = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  const years = days / 365.25;
  return Math.pow(endValue / startValue, 1 / years) - 1;
}
```

**含义：** 假设每年以固定比例增长，达到实际终值所需的年化收益率，平滑化波动

**参考值范围：**
- 股票型基金 CAGR > 15%: 优秀
- 股票型基金 CAGR 8% ~ 15%: 良好
- 股票型基金 CAGR < 8%: 一般
- *债券型/货币型基金参考值更低*

---

### 3.3 Monthly Win Rate (月度胜率)

**计算公式：**
```typescript
// 月度胜率 = 正收益月数 / 总月数
function calculateMonthlyWinRate(monthlyReturns: number[]): number {
  const winningMonths = monthlyReturns.filter(r => r > 0).length;
  return winningMonths / monthlyReturns.length;
}

// 相对胜率（相对基准）
function calculateRelativeWinRate(
  portfolioReturns: number[],
  benchmarkReturns: number[]
): number {
  const outperformingMonths = portfolioReturns.filter(
    (r, i) => r > benchmarkReturns[i]
  ).length;
  return outperformingMonths / portfolioReturns.length;
}

// Hit Rate（击球率）- 包含超额收益幅度
function calculateHitRate(
  portfolioReturns: number[],
  benchmarkReturns: number[]
): {
  hitRate: number;
  avgWin: number;
  avgLoss: number;
  winLossRatio: number;
} {
  const activeReturns = portfolioReturns.map((r, i) => r - benchmarkReturns[i]);
  const wins = activeReturns.filter(r => r > 0);
  const losses = activeReturns.filter(r => r < 0);

  return {
    hitRate: wins.length / activeReturns.length,
    avgWin: wins.reduce((a, b) => a + b, 0) / wins.length,
    avgLoss: Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length),
    winLossRatio: (wins.reduce((a, b) => a + b, 0) / wins.length) /
                  Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length)
  };
}
```

**含义：** 月度收益为正的比例，或跑赢基准的月份比例，衡量稳健性

**参考值范围：**
- 绝对胜率 > 60%: 优秀（稳定盈利）
- 绝对胜率 50% ~ 60%: 良好
- 绝对胜率 < 50%: 一般
- 相对胜率（跑赢基准）> 55%: 优秀

---

## 4. 风险指标 (Risk Metrics)

### 4.1 VaR (Value at Risk / 在险价值，95% 置信度)

**计算公式：**
```typescript
// 方法1: 历史模拟法 (Historical Method)
function calculateHistoricalVaR(
  returns: number[],
  confidenceLevel: number = 0.95
): number {
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidenceLevel) * returns.length);
  return -sortedReturns[index];  // 返回正值表示损失
}

// 方法2: 参数法 (Parametric Method / Variance-Covariance)
function calculateParametricVaR(
  returns: number[],
  confidenceLevel: number = 0.95
): number {
  // 计算均值和标准差
  const mean = returns.reduce((a, b) => a + b) / returns.length;
  const variance = returns.reduce((sum, r) =>
    sum + Math.pow(r - mean, 2), 0
  ) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  // 95% 置信度对应 z-score = 1.645 (单边)
  const zScore = 1.645;

  // VaR = μ - z × σ (假设正态分布)
  return -(mean - zScore * stdDev);
}

// 方法3: 蒙特卡洛模拟法 (Monte Carlo Method)
function calculateMonteCarloVaR(
  currentValue: number,
  expectedReturn: number,
  volatility: number,
  timeHorizon: number,        // 时间跨度（天）
  simulations: number = 10000,
  confidenceLevel: number = 0.95
): number {
  const simulatedReturns: number[] = [];

  for (let i = 0; i < simulations; i++) {
    // 生成正态分布随机数
    const randomReturn = expectedReturn * timeHorizon +
                        volatility * Math.sqrt(timeHorizon) * randomNormal();
    simulatedReturns.push(randomReturn);
  }

  return calculateHistoricalVaR(simulatedReturns, confidenceLevel);
}

// 辅助函数：生成标准正态分布随机数
function randomNormal(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
```

**含义：** 在给定置信度下，某一时期内投资组合可能遭受的最大损失

**参考值范围（95% 置信度，1天）：**
- 日 VaR < 2%: 低风险
- 日 VaR 2% ~ 4%: 中等风险
- 日 VaR > 4%: 高风险

---

### 4.2 CVaR / Expected Shortfall (条件风险价值 / 预期损失)

**计算公式：**
```typescript
// CVaR = 超过 VaR 的所有损失的平均值
function calculateCVaR(
  returns: number[],
  confidenceLevel: number = 0.95
): number {
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const varIndex = Math.floor((1 - confidenceLevel) * returns.length);

  // 取所有小于 VaR 临界值的收益率（即最差的 5%）
  const tailReturns = sortedReturns.slice(0, varIndex);
  const cvar = -tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length;

  return cvar;
}

// 也称为 Expected Shortfall (ES)
function calculateExpectedShortfall(
  returns: number[],
  confidenceLevel: number = 0.95
): number {
  return calculateCVaR(returns, confidenceLevel);
}
```

**含义：** 当损失超过 VaR 时的平均损失，更关注尾部风险，是一致性风险度量

**参考值范围：**
- CVaR 通常比 VaR 大 20% ~ 50%
- CVaR 是 VaR 的改进指标，能更好地捕捉极端风险

---

### 4.3 Downside Capture Ratio (下行捕获比率)

**计算公式：**
```typescript
// Downside Capture Ratio = Fund Downside CAGR / Benchmark Downside CAGR
function calculateDownsideCaptureRatio(
  portfolioReturns: number[],
  benchmarkReturns: number[]
): number {
  // 筛选基准下跌的月份
  const downsideIndices = benchmarkReturns
    .map((r, i) => r < 0 ? i : -1)
    .filter(i => i >= 0);

  if (downsideIndices.length === 0) return 0;

  // 计算下跌期间的 CAGR
  const portfolioDownsideReturns = downsideIndices.map(i => portfolioReturns[i]);
  const benchmarkDownsideReturns = downsideIndices.map(i => benchmarkReturns[i]);

  const portfolioDownsideCAGR = calculateAverageReturn(portfolioDownsideReturns);
  const benchmarkDownsideCAGR = calculateAverageReturn(benchmarkDownsideReturns);

  return portfolioDownsideCAGR / benchmarkDownsideCAGR;
}

// 辅助函数：计算几何平均收益率
function calculateAverageReturn(returns: number[]): number {
  const product = returns.reduce((prod, r) => prod * (1 + r), 1);
  return Math.pow(product, 1 / returns.length) - 1;
}

// 配套指标：上行捕获比率
function calculateUpsideCaptureRatio(
  portfolioReturns: number[],
  benchmarkReturns: number[]
): number {
  const upsideIndices = benchmarkReturns
    .map((r, i) => r > 0 ? i : -1)
    .filter(i => i >= 0);

  if (upsideIndices.length === 0) return 0;

  const portfolioUpsideReturns = upsideIndices.map(i => portfolioReturns[i]);
  const benchmarkUpsideReturns = upsideIndices.map(i => benchmarkReturns[i]);

  const portfolioUpsideCAGR = calculateAverageReturn(portfolioUpsideReturns);
  const benchmarkUpsideCAGR = calculateAverageReturn(benchmarkUpsideReturns);

  return portfolioUpsideCAGR / benchmarkUpsideCAGR;
}
```

**含义：** 市场下跌时基金相对基准的跌幅比例，数值越低表示下行保护越好

**参考值范围：**
- Downside Capture < 80%: 优秀（下跌时损失小）
- Downside Capture 80% ~ 100%: 良好
- Downside Capture > 100%: 较差（下跌时跌得更多）
- 配合 Upside Capture 使用：理想情况是 Upside > 100%, Downside < 100%

---

## 5. 回测方法 (Backtesting Methods)

### 5.1 历史净值回测 (Historical NAV Backtesting)

**计算公式：**
```typescript
interface BacktestResult {
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  volatility: number;
}

function backtestHistoricalNAV(
  navSeries: number[],
  dates: Date[],
  riskFreeRate: number = 0.03
): BacktestResult {
  // 计算日收益率
  const dailyReturns = navSeries.slice(1).map((nav, i) =>
    (nav - navSeries[i]) / navSeries[i]
  );

  // 总收益
  const totalReturn = (navSeries[navSeries.length - 1] - navSeries[0]) / navSeries[0];

  // 年化收益
  const years = (dates[dates.length - 1].getTime() - dates[0].getTime()) /
                (365.25 * 24 * 60 * 60 * 1000);
  const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;

  // 最大回撤
  const maxDrawdown = calculateMaxDrawdown(navSeries);

  // 波动率（年化）
  const volatility = calculateVolatility(dailyReturns) * Math.sqrt(252);

  // 夏普比率
  const sharpeRatio = (annualizedReturn - riskFreeRate) / volatility;

  // 胜率
  const winRate = dailyReturns.filter(r => r > 0).length / dailyReturns.length;

  return {
    totalReturn,
    annualizedReturn,
    maxDrawdown,
    sharpeRatio,
    winRate,
    volatility
  };
}

function calculateMaxDrawdown(navSeries: number[]): number {
  let maxDrawdown = 0;
  let peak = navSeries[0];

  for (const nav of navSeries) {
    if (nav > peak) peak = nav;
    const drawdown = (peak - nav) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

function calculateVolatility(returns: number[]): number {
  const mean = returns.reduce((a, b) => a + b) / returns.length;
  const variance = returns.reduce((sum, r) =>
    sum + Math.pow(r - mean, 2), 0
  ) / (returns.length - 1);
  return Math.sqrt(variance);
}
```

**含义：** 基于历史净值数据，模拟一次性投资的收益表现和风险特征

---

### 5.2 定投回测 (Dollar Cost Averaging Backtesting)

**计算公式：**
```typescript
interface DCABacktestResult {
  totalInvested: number;
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  avgCost: number;
}

function backtestDCA(
  navSeries: number[],
  dates: Date[],
  investmentAmount: number,    // 每期定投金额
  frequency: 'daily' | 'weekly' | 'monthly' = 'monthly'
): DCABacktestResult {
  let totalShares = 0;
  let totalInvested = 0;
  const investmentDates: number[] = [];

  // 根据频率选择定投日期
  const step = frequency === 'daily' ? 1 :
               frequency === 'weekly' ? 7 : 30;

  for (let i = 0; i < navSeries.length; i += step) {
    const nav = navSeries[i];
    const shares = investmentAmount / nav;
    totalShares += shares;
    totalInvested += investmentAmount;
    investmentDates.push(i);
  }

  // 最终市值
  const finalNAV = navSeries[navSeries.length - 1];
  const finalValue = totalShares * finalNAV;

  // 总收益率
  const totalReturn = (finalValue - totalInvested) / totalInvested;

  // 年化收益率（使用 IRR 更精确，这里简化为 XIRR）
  const years = (dates[dates.length - 1].getTime() - dates[0].getTime()) /
                (365.25 * 24 * 60 * 60 * 1000);
  const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;

  // 平均成本
  const avgCost = totalInvested / totalShares;

  return {
    totalInvested,
    finalValue,
    totalReturn,
    annualizedReturn,
    avgCost
  };
}
```

**含义：** 模拟定期定额投资策略，评估平均成本法的效果和长期收益

---

### 5.3 不同持有期收益分布 (Holding Period Return Distribution)

**计算公式：**
```typescript
interface HoldingPeriodAnalysis {
  period: number;              // 持有期（天）
  avgReturn: number;
  medianReturn: number;
  minReturn: number;
  maxReturn: number;
  positiveRatio: number;
  returnDistribution: number[];
}

function analyzeHoldingPeriodReturns(
  navSeries: number[],
  holdingPeriods: number[] = [30, 90, 180, 365, 730, 1095]  // 1月/3月/6月/1年/2年/3年
): HoldingPeriodAnalysis[] {
  return holdingPeriods.map(period => {
    const returns: number[] = [];

    // 滚动计算所有可能的持有期收益
    for (let i = 0; i + period < navSeries.length; i++) {
      const startNAV = navSeries[i];
      const endNAV = navSeries[i + period];
      const return_ = (endNAV - startNAV) / startNAV;
      returns.push(return_);
    }

    // 统计分析
    const sortedReturns = [...returns].sort((a, b) => a - b);

    return {
      period,
      avgReturn: returns.reduce((a, b) => a + b) / returns.length,
      medianReturn: sortedReturns[Math.floor(sortedReturns.length / 2)],
      minReturn: Math.min(...returns),
      maxReturn: Math.max(...returns),
      positiveRatio: returns.filter(r => r > 0).length / returns.length,
      returnDistribution: calculatePercentiles(sortedReturns)
    };
  });
}

// 计算分位数分布
function calculatePercentiles(sortedReturns: number[]): number[] {
  const percentiles = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
  return percentiles.map(p => {
    const index = Math.floor(p * sortedReturns.length);
    return sortedReturns[index];
  });
}

// 可视化收益分布
function visualizeReturnDistribution(returns: number[]): string {
  const bins = 20;
  const min = Math.min(...returns);
  const max = Math.max(...returns);
  const binSize = (max - min) / bins;

  const histogram = new Array(bins).fill(0);
  returns.forEach(r => {
    const binIndex = Math.min(Math.floor((r - min) / binSize), bins - 1);
    histogram[binIndex]++;
  });

  // 生成 ASCII 直方图
  const maxCount = Math.max(...histogram);
  return histogram.map((count, i) => {
    const bar = '█'.repeat(Math.round(count / maxCount * 50));
    const rangeStart = (min + i * binSize).toFixed(2);
    const rangeEnd = (min + (i + 1) * binSize).toFixed(2);
    return `${rangeStart}% ~ ${rangeEnd}%: ${bar} (${count})`;
  }).join('\n');
}
```

**含义：** 分析不同持有期限下的收益率分布，评估投资者在不同时间点买入的盈利概率

**参考应用：**
- 持有1年正收益概率 > 70%: 短期稳定性好
- 持有3年正收益概率 > 90%: 长期稳定性优秀
- 可用于向投资者展示"持有时间越长，盈利概率越高"

---

## 6. 综合评分模型示例 (Composite Scoring Model Example)

```typescript
interface FundMetrics {
  alpha: number;
  beta: number;
  sharpeRatio: number;
  informationRatio: number;
  maxDrawdown: number;
  volatility: number;
  winRate: number;
  downsideCaptureRatio: number;
}

function calculateFundScore(metrics: FundMetrics): number {
  // 各指标权重（示例）
  const weights = {
    alpha: 0.15,
    sharpe: 0.20,
    informationRatio: 0.15,
    maxDrawdown: 0.15,
    volatility: 0.10,
    winRate: 0.10,
    downsideCapture: 0.15
  };

  // 归一化处理（将指标转换为 0-100 分）
  const alphaScore = normalizeAlpha(metrics.alpha);
  const sharpeScore = normalizeSharpe(metrics.sharpeRatio);
  const irScore = normalizeIR(metrics.informationRatio);
  const drawdownScore = 100 * (1 - Math.min(metrics.maxDrawdown, 0.5) / 0.5);
  const volatilityScore = 100 * (1 - Math.min(metrics.volatility, 0.4) / 0.4);
  const winRateScore = metrics.winRate * 100;
  const downsideScore = 100 * (1 - Math.min(metrics.downsideCaptureRatio, 1));

  // 加权求和
  return (
    weights.alpha * alphaScore +
    weights.sharpe * sharpeScore +
    weights.informationRatio * irScore +
    weights.maxDrawdown * drawdownScore +
    weights.volatility * volatilityScore +
    weights.winRate * winRateScore +
    weights.downsideCapture * downsideScore
  );
}

function normalizeAlpha(alpha: number): number {
  // Alpha 通常在 -5% ~ 5% 范围
  return Math.max(0, Math.min(100, (alpha + 0.05) / 0.10 * 100));
}

function normalizeSharpe(sharpe: number): number {
  // Sharpe 通常在 -1 ~ 3 范围
  return Math.max(0, Math.min(100, (sharpe + 1) / 4 * 100));
}

function normalizeIR(ir: number): number {
  // IR 通常在 -1 ~ 1 范围
  return Math.max(0, Math.min(100, (ir + 1) / 2 * 100));
}
```

---

## 参考资料 (References)

- CFA Institute: *CFA Program Curriculum - Portfolio Management*
- GARP: *FRM Handbook - Market Risk Measurement and Management*
- Morningstar: *Fund Analysis and Rating Methodology*
- BlackRock: *Portfolio Analytics and Risk Management*

---

**注意事项：**

1. **数据质量**：所有指标计算依赖准确的历史数据，需确保净值数据的准确性和连续性
2. **基准选择**：相对指标（Alpha、IR、捕获比率）依赖合理的基准选择
3. **时间跨度**：短期数据计算的指标可能不稳定，建议使用 3 年以上数据
4. **市场环境**：不同市场环境下指标的参考值可能不同，需结合市场背景分析
5. **综合评估**：单一指标无法全面评价基金，需结合多个维度综合判断

---

*生成日期：2026-02-14*
*版本：v1.0*
