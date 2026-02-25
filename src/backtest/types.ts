/** 回测评分系统类型定义 */

/** 历史时点计算出的指标 */
export interface HistoricalMetrics {
  returnYear1: number;       // 近1年收益率 %
  returnYear3: number;       // 近3年收益率 %
  sharpeRatio: number;       // 夏普比率（年化）
  maxDrawdown: number;       // 最大回撤 %
  volatility: number;        // 年化波动率 %
  sortinoRatio: number;      // 索提诺比率
}

/** 单次回测结果：某基金在某时点的评分 + 后续实际表现 */
export interface ScoringBacktestResult {
  fundCode: string;
  fundName: string;
  fundType: string;
  evalDate: string;          // 评估日期 YYYY-MM-DD
  score: number;             // 评分（总分100）
  scoreDetails: { item: string; score: number; maxScore: number }[];
  metrics: HistoricalMetrics; // 评估时点的指标
  forwardReturns: {           // 评估后的实际收益
    period: string;           // 如 "1y", "2y"
    return: number;           // 实际收益率 %
    annualized: number;       // 年化收益率 %
  }[];
}

/** 相关性分析结果 */
export interface CorrelationResult {
  pearson: number;            // Pearson 相关系数
  spearman: number;           // Spearman 等级相关系数
  sampleSize: number;         // 样本量
}

/** 批量回测统计报告 */
export interface ScoringBacktestReport {
  results: ScoringBacktestResult[];
  correlation: Record<string, CorrelationResult>; // key: forward period (如 "1y")
  scoreQuintileReturns: {      // 按评分五分位的平均收益
    period: string;
    quintiles: {
      label: string;           // 如 "Q1(最高分)", "Q5(最低分)"
      avgScore: number;
      avgReturn: number;
      count: number;
    }[];
  }[];
  summary: {
    totalSamples: number;
    dateRange: string;
    fundCount: number;
  };
}
